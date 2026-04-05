"""
Property-Specific Occupancy Forecasting Model  (Gradient Boosting)
==================================================================
Builds a monthly occupancy time-series from tenant move-in / move-out records
and forecasts the expected occupancy rate for the next 12 months using a
Gradient Boosting Regressor with engineered lag, rolling, and seasonal
features plus time-series cross-validated hyperparameter tuning.

Training data
-------------
Reads from ``occupancy_training_data.csv`` which contains only the five columns
needed for occupancy forecasting:

    Property ID, Move-In Date, Move-Out Date, Section, Room

Pipeline overview
-----------------
1. Load ``occupancy_training_data.csv`` (pre-cleaned, 5 columns only)
1b. Filter ultra-short stays (< MIN_STAY_DAYS) that distort occupancy
2. Filter by property_id
3. Reconstruct monthly occupancy rate from move-in / move-out intervals
3b. Stationarity check (ADF test) with optional differencing
4. Adaptively engineer lag / rolling / seasonal features based on data length
5. Evaluate naïve & seasonal naïve baselines on hold-out
6. Tune GradientBoostingRegressor via TimeSeriesSplit cross-validation
7. Train quantile models for 80% prediction intervals
8. Compare GBR vs baselines; warn if GBR doesn't outperform
9. Forecast 12 months ahead with confidence bands
10. Drift / staleness detection for cached models
11. Save model artefacts + plot

Usage
-----
    # Command line
    python occupancy_forecast.py                       # default property_id=1
    python occupancy_forecast.py --property_id 1

    # Programmatic
    from occupancy_forecast import OccupancyForecaster
    fc = OccupancyForecaster(property_id=1)
    fc.run()
    print(fc.forecast_df)
"""

from __future__ import annotations

import argparse
import os
import time
import warnings
from dataclasses import dataclass, field
from typing import Optional

import joblib
import matplotlib
matplotlib.use("Agg")  # non-interactive backend
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error
from sklearn.model_selection import TimeSeriesSplit

try:
    from statsmodels.tsa.stattools import adfuller as _adfuller
    HAS_STATSMODELS = True
except ImportError:
    HAS_STATSMODELS = False

warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=FutureWarning)

# ────────────────────────────────────────────────────────────────
# Configuration
# ────────────────────────────────────────────────────────────────

CSV_FILENAME = "occupancy_training_data.csv"
MODEL_DIR = "models"
CACHE_VERSION = 5  # bumped: differencing, adaptive blend, feature importances, ETS baseline

# Minimum tenancy duration (days) — shorter stays are treated as anomalous
# bookings / data-entry errors and excluded from occupancy reconstruction.
MIN_STAY_DAYS = 14

# Maximum model age in seconds before it is considered stale (7 days).
MODEL_STALENESS_SECONDS = 7 * 24 * 3600

REQUIRED_COLUMNS = [
    "Property ID",
    "Move-In Date",
    "Move-Out Date",
    "Section",
    "Room",
]


# ────────────────────────────────────────────────────────────────
# § 1  DATA LOADING & PREPROCESSING
# ────────────────────────────────────────────────────────────────

def _csv_path() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), CSV_FILENAME)


def load_and_clean(csv_path: Optional[str] = None) -> pd.DataFrame:
    """Load the trimmed CSV (5 columns) and validate / parse dates."""
    path = csv_path or _csv_path()
    df = pd.read_csv(path)

    # Validate expected columns are present
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"CSV is missing required columns: {missing}")

    # Keep only the required columns (safety net if extra cols sneak in)
    df = df[REQUIRED_COLUMNS].copy()

    # Parse dates
    df["Move-In Date"] = pd.to_datetime(df["Move-In Date"], errors="coerce")
    df["Move-Out Date"] = pd.to_datetime(df["Move-Out Date"], errors="coerce")

    # Drop rows with invalid move-in date
    before = len(df)
    df.dropna(subset=["Move-In Date"], inplace=True)
    if (dropped := before - len(df)) > 0:
        print(f"  [WARN] Dropped {dropped} rows with invalid move-in dates.")

    # Treat missing move-out as still active through today
    today = pd.Timestamp.today().normalize()
    missing_move_out = df["Move-Out Date"].isna().sum()
    if missing_move_out:
        df["Move-Out Date"] = df["Move-Out Date"].fillna(today)

    # Ensure move-out >= move-in
    df = df[df["Move-Out Date"] >= df["Move-In Date"]].copy()

    # Filter ultra-short stays that distort monthly occupancy counts.
    # These are typically data-entry errors or transient bookings, not real
    # tenancies.  The threshold is configurable via MIN_STAY_DAYS.
    stay_days = (df["Move-Out Date"] - df["Move-In Date"]).dt.days
    short_mask = stay_days < MIN_STAY_DAYS
    n_short = int(short_mask.sum())
    if n_short > 0:
        print(
            f"  [CLEAN] Removed {n_short} ultra-short stays "
            f"(< {MIN_STAY_DAYS} days) that would distort occupancy."
        )
        df = df[~short_mask].copy()

    return df


def filter_by_property(df: pd.DataFrame, property_id: int) -> pd.DataFrame:
    """Return only rows matching the given property."""
    subset = df[df["Property ID"] == property_id].copy()
    if subset.empty:
        raise ValueError(
            f"No data found for property_id={property_id}. "
            f"Available IDs: {sorted(df['Property ID'].unique())}"
        )
    return subset


def compute_total_units(df_property: pd.DataFrame, property_id: Optional[int] = None) -> int:
    """Resolve total rentable units from canonical property data, fallback to training rows."""
    observed_count = int(df_property.groupby(["Section", "Room"]).ngroups)

    if property_id is not None:
        # Prefer Unit table as source of truth when available.
        try:
            from api.models import Unit

            count = int(Unit.objects.filter(property_id=property_id).count())
            if count > 0:
                return max(count, observed_count)
        except Exception:
            pass

        # Fallback to Property.layouts room definitions.
        try:
            from api.models import Property
            from api.views.utils import _iter_layout_boxes

            prop = Property.objects.only("id", "layouts").get(pk=property_id)
            seen = set()
            for box, _variant in _iter_layout_boxes(prop.layouts or {}):
                room_no = str(box.get("number", "")).strip()
                room_type = str(box.get("type", "room")).strip().lower()
                if not room_no:
                    continue
                if room_type in {"room", "commercial"}:
                    section = str(box.get("section", "")).strip()
                    seen.add((section, room_no))
            if seen:
                return max(len(seen), observed_count)
        except Exception:
            pass

    return observed_count


def build_monthly_occupancy(
    df_property: pd.DataFrame,
    total_units: int,
    start: Optional[pd.Timestamp] = None,
    end: Optional[pd.Timestamp] = None,
) -> pd.DataFrame:
    """
    Reconstruct a monthly occupancy time-series from per-tenant records.

    For every month we count how many distinct rooms are occupied (a tenant's
    [move_in, move_out] interval overlaps that calendar month) and divide by
    total_units to get the occupancy rate.

    Returns
    -------
    DataFrame indexed by month (freq='MS') with columns:
        occupied_units, total_units, occupancy_rate
    """
    if start is None:
        start = df_property["Move-In Date"].min()
    if end is None:
        end = df_property["Move-Out Date"].max()

    today = pd.Timestamp.today().normalize()

    months = pd.date_range(
        start=start.to_period("M").to_timestamp(),
        end=min(end, today + pd.DateOffset(months=1)).to_period("M").to_timestamp(),
        freq="MS",
    )

    records = []
    for month_start in months:
        month_end = month_start + pd.offsets.MonthEnd(0)

        occupied = df_property[
            (df_property["Move-In Date"] <= month_end)
            & (df_property["Move-Out Date"] >= month_start)
        ]
        occupied_units = occupied.groupby(["Section", "Room"]).ngroups

        records.append(
            {
                "month": month_start,
                "occupied_units": occupied_units,
                "total_units": total_units,
                "occupancy_rate": occupied_units / total_units if total_units else 0,
            }
        )

    ts = pd.DataFrame(records)
    ts["month"] = pd.to_datetime(ts["month"])
    ts.set_index("month", inplace=True)
    ts.index.freq = "MS"
    return ts


# ────────────────────────────────────────────────────────────────
# § 1b  STATIONARITY CHECK & DIFFERENCING
# ────────────────────────────────────────────────────────────────

@dataclass
class StationarityResult:
    """Result of the ADF stationarity test."""
    is_stationary: bool
    adf_statistic: float
    p_value: float
    critical_values: dict = field(default_factory=dict)
    used_differencing: bool = False
    diff_order: int = 0


def check_stationarity(
    series: pd.Series,
    significance: float = 0.05,
    max_diff: int = 2,
) -> StationarityResult:
    """Run augmented Dickey-Fuller test and optionally difference the series.

    Parameters
    ----------
    series : pd.Series
        The occupancy_rate time-series.
    significance : float
        p-value threshold below which we consider the series stationary.
    max_diff : int
        Maximum differencing order to try if the raw series is non-stationary.

    Returns
    -------
    StationarityResult with test statistics and whether differencing was needed.
    """
    if not HAS_STATSMODELS or len(series.dropna()) < 8:
        # Not enough data or statsmodels unavailable — skip test
        return StationarityResult(
            is_stationary=True,  # assume OK so pipeline continues
            adf_statistic=float("nan"),
            p_value=float("nan"),
        )

    for d in range(0, max_diff + 1):
        s = series.dropna()
        for _ in range(d):
            s = s.diff().dropna()
        if len(s) < 8:
            break
        result = _adfuller(s, autolag="AIC")
        adf_stat, p_val = result[0], result[1]
        crit = result[4]  # dict of critical values
        if p_val < significance:
            return StationarityResult(
                is_stationary=True,
                adf_statistic=float(adf_stat),
                p_value=float(p_val),
                critical_values={k: float(v) for k, v in crit.items()},
                used_differencing=d > 0,
                diff_order=d,
            )

    # Non-stationary even after max_diff — return last test result
    return StationarityResult(
        is_stationary=False,
        adf_statistic=float(adf_stat),
        p_value=float(p_val),
        critical_values={k: float(v) for k, v in crit.items()},
        used_differencing=False,
        diff_order=0,
    )


# ────────────────────────────────────────────────────────────────
# § 2  FEATURE ENGINEERING
# ────────────────────────────────────────────────────────────────

def add_time_features(ts: pd.DataFrame) -> pd.DataFrame:
    """Add calendar, lag, rolling, and momentum features.

    Features are added *adaptively* based on the available data length so that
    long-lag features (e.g. lag_12, diff_12) are only created when the series
    is long enough that they won't consume most of the training rows after
    NaN dropping.  Rolling statistics use ``min_periods`` to further reduce
    unnecessary NaN rows.
    """
    df = ts.copy()
    n = len(df)
    # Minimum usable rows we want to keep after NaN drop
    MIN_USABLE = 6

    # ── Calendar (cyclical encoding + raw) — always available ──
    df["month_num"] = df.index.month
    df["quarter"] = df.index.quarter
    df["year"] = df.index.year
    df["month_sin"] = np.sin(2 * np.pi * df["month_num"] / 12)
    df["month_cos"] = np.cos(2 * np.pi * df["month_num"] / 12)

    # ── Lag features — only add lags that leave enough training rows ──
    for lag in [1, 2, 3, 6, 12]:
        if n - lag >= MIN_USABLE:
            df[f"lag_{lag}"] = df["occupancy_rate"].shift(lag)

    # ── Rolling statistics (shifted by 1 to avoid data leakage) ──
    shifted = df["occupancy_rate"].shift(1)
    if n >= MIN_USABLE + 1:
        df["rolling_3_mean"] = shifted.rolling(3, min_periods=1).mean()
        df["rolling_3_std"] = shifted.rolling(3, min_periods=1).std().fillna(0)
    if n >= MIN_USABLE + 3:
        df["rolling_6_mean"] = shifted.rolling(6, min_periods=3).mean()
        df["rolling_6_std"] = shifted.rolling(6, min_periods=3).std().fillna(0)

    # ── Differencing / momentum (shifted by 1 month to avoid target leakage) ──
    occ_prev = df["occupancy_rate"].shift(1)
    if n >= MIN_USABLE + 2:
        df["diff_1"] = occ_prev.diff(1)
    if n - 13 >= MIN_USABLE:
        df["diff_12"] = occ_prev.diff(12)

    return df


# ────────────────────────────────────────────────────────────────
# § 3  FORECAST RESULT CONTAINER
# ────────────────────────────────────────────────────────────────

@dataclass
class BaselineMetrics:
    """Metrics for a naïve baseline forecast."""
    name: str
    mae: float
    rmse: float
    mape: float


@dataclass
class ForecastResult:
    """Container for a trained forecast and its evaluation metrics."""
    forecast_df: pd.DataFrame = field(default_factory=pd.DataFrame)
    mae: float = 0.0
    rmse: float = 0.0
    mape: float = 0.0
    params: dict = field(default_factory=dict)
    model_object: object = None
    baselines: list = field(default_factory=list)  # list[BaselineMetrics]
    stationarity: object = None  # StationarityResult | None
    gbr_beats_baselines: bool = True
    feature_importances: dict = field(default_factory=dict)


def _mape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    """Mean Absolute Percentage Error (handles zero values)."""
    mask = y_true != 0
    if mask.sum() == 0:
        return 0.0
    return float(np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100)


# ────────────────────────────────────────────────────────────────
# § 3b  NAÏVE / SEASONAL NAÏVE BASELINES
# ────────────────────────────────────────────────────────────────

def _naive_forecast(y_train: np.ndarray, n_test: int) -> np.ndarray:
    """Naïve baseline: repeat the last observed value."""
    return np.full(n_test, y_train[-1])


def _seasonal_naive_forecast(
    y_train: np.ndarray, n_test: int, season: int = 12,
) -> np.ndarray:
    """Seasonal naïve: repeat the value from the same month last year.

    Falls back to the naïve forecast when there is less than one full
    season of training data.
    """
    if len(y_train) < season:
        return _naive_forecast(y_train, n_test)
    preds = []
    for i in range(n_test):
        idx = len(y_train) - season + (i % season)
        if idx < 0:
            idx = len(y_train) - 1
        preds.append(y_train[idx])
    return np.array(preds)


def _ets_forecast(
    y_train: np.ndarray,
    n_test: int,
    seasonal_periods: int = 12,
) -> Optional[np.ndarray]:
    """Exponential smoothing (ETS) baseline forecast.

    Uses Holt-Winters additive model when enough data is available.
    Returns *None* when statsmodels is unavailable or the series is
    too short for the chosen seasonal period.
    """
    if not HAS_STATSMODELS:
        return None
    try:
        from statsmodels.tsa.holtwinters import ExponentialSmoothing

        # ETS with seasonality needs >= 2 full cycles
        if len(y_train) >= 2 * seasonal_periods:
            ets_model = ExponentialSmoothing(
                y_train,
                seasonal_periods=seasonal_periods,
                trend="add",
                seasonal="add",
                initialization_method="estimated",
            ).fit(optimized=True, use_brute=False)
        elif len(y_train) >= 4:
            # Trend-only (no seasonality) for short series
            ets_model = ExponentialSmoothing(
                y_train,
                trend="add",
                seasonal=None,
                initialization_method="estimated",
            ).fit(optimized=True, use_brute=False)
        else:
            return None

        return ets_model.forecast(n_test)
    except Exception:
        return None


def _evaluate_baselines(
    y_train: np.ndarray,
    y_test: np.ndarray,
) -> list[BaselineMetrics]:
    """Evaluate naïve, seasonal naïve, and ETS baselines on a hold-out set."""
    results: list[BaselineMetrics] = []
    n = len(y_test)
    for name, pred_fn in [
        ("naive", lambda: _naive_forecast(y_train, n)),
        ("seasonal_naive", lambda: _seasonal_naive_forecast(y_train, n)),
    ]:
        pred = np.clip(pred_fn(), 0, 1)
        results.append(
            BaselineMetrics(
                name=name,
                mae=float(mean_absolute_error(y_test, pred)),
                rmse=float(np.sqrt(mean_squared_error(y_test, pred))),
                mape=_mape(y_test, pred),
            )
        )

    # Exponential smoothing (ETS) baseline
    ets_pred = _ets_forecast(y_train, n)
    if ets_pred is not None:
        ets_pred = np.clip(ets_pred, 0, 1)
        results.append(
            BaselineMetrics(
                name="ets",
                mae=float(mean_absolute_error(y_test, ets_pred)),
                rmse=float(np.sqrt(mean_squared_error(y_test, ets_pred))),
                mape=_mape(y_test, ets_pred),
            )
        )

    return results


def _compute_volatility_cap(
    occupancy_series: np.ndarray, sigma_multiplier: float = 2.0,
) -> float:
    """Derive a data-driven upper-bound offset from historical volatility.

    Instead of an arbitrary constant like ``max_uplift=0.10`` we measure how
    much occupancy actually fluctuates month-to-month and set the cap at
    ``sigma_multiplier`` standard deviations of those changes.  The result is
    clamped to a sensible [0.05, 0.30] corridor so truly flat series don't
    produce a zero cap and extremely noisy ones don't remove all constraints.
    """
    if len(occupancy_series) < 3:
        return 0.15  # safe default when almost no history
    diffs = np.diff(occupancy_series)
    vol = float(np.std(diffs))
    cap = vol * sigma_multiplier
    return float(np.clip(cap, 0.05, 0.30))


def _adaptive_calibration_blend(n_months: int) -> float:
    """Compute calibration blend weight based on available data length.

    More historical data → trust the model more (lower blend toward baseline).
    Less data → trust the trailing-average baseline more (higher blend).

    Returns a value between 0.15 (≥60 months) and 0.50 (≤12 months),
    linearly interpolated in between.
    """
    if n_months <= 12:
        return 0.50
    if n_months >= 60:
        return 0.15
    return 0.50 - (n_months - 12) * (0.50 - 0.15) / (60 - 12)


def _tune_gbr_params(
    df: pd.DataFrame,
    feature_cols: list[str],
    n_splits: int = 3,
) -> dict:
    """Select the best GBR hyper-parameters via TimeSeriesSplit CV.

    A deliberately compact grid keeps runtime reasonable on small data while
    still covering the dimensions that matter most (depth, learning rate,
    number of trees, and leaf size).
    """
    param_grid = [
        {"n_estimators": 80,  "max_depth": 2, "learning_rate": 0.05, "min_samples_leaf": 3},
        {"n_estimators": 120, "max_depth": 3, "learning_rate": 0.05, "min_samples_leaf": 3},
        {"n_estimators": 100, "max_depth": 3, "learning_rate": 0.10, "min_samples_leaf": 3},
        {"n_estimators": 150, "max_depth": 3, "learning_rate": 0.05, "min_samples_leaf": 5},
        {"n_estimators": 100, "max_depth": 4, "learning_rate": 0.05, "min_samples_leaf": 5},
        {"n_estimators": 200, "max_depth": 2, "learning_rate": 0.05, "min_samples_leaf": 5},
    ]

    X = df[feature_cols].values
    y = df["occupancy_rate"].values

    # TimeSeriesSplit respects temporal ordering
    effective_splits = min(n_splits, len(df) // 4)
    if effective_splits < 2:
        # Too little data for CV — return a safe default
        return {"n_estimators": 100, "max_depth": 3, "learning_rate": 0.05, "min_samples_leaf": 5}

    tscv = TimeSeriesSplit(n_splits=effective_splits)
    best_score = float("inf")
    best_params = param_grid[0]

    for params in param_grid:
        fold_errors: list[float] = []
        for train_idx, val_idx in tscv.split(X):
            model = GradientBoostingRegressor(
                loss="squared_error",
                random_state=42,
                **params,
            )
            model.fit(X[train_idx], y[train_idx])
            pred = model.predict(X[val_idx]).clip(0, 1)
            fold_errors.append(float(mean_absolute_error(y[val_idx], pred)))

        avg_mae = float(np.mean(fold_errors))
        if avg_mae < best_score:
            best_score = avg_mae
            best_params = params

    return best_params


def _rolling_backtest(
    df: pd.DataFrame,
    feature_cols: list[str],
    gbr_params: dict,
    min_train_size: int = 18,
    max_splits: int = 12,
) -> dict:
    """Expanding-window 1-step backtest diagnostics for stability checking."""
    n = len(df)
    if n < min_train_size + 1:
        return {"splits": 0, "mae_mean": float("nan"), "rmse_mean": float("nan")}

    start = max(min_train_size, n - max_splits)
    maes: list[float] = []
    rmses: list[float] = []

    for i in range(start, n):
        train_slice = df.iloc[:i]
        test_slice = df.iloc[i : i + 1]
        if train_slice.empty or test_slice.empty:
            continue

        X_train = train_slice[feature_cols].values
        y_train = train_slice["occupancy_rate"].values
        X_test = test_slice[feature_cols].values
        y_test = test_slice["occupancy_rate"].values

        model_bt = GradientBoostingRegressor(
            loss="squared_error",
            random_state=42,
            **gbr_params,
        )
        model_bt.fit(X_train, y_train)
        pred = model_bt.predict(X_test).clip(0, 1)

        maes.append(float(mean_absolute_error(y_test, pred)))
        rmses.append(float(np.sqrt(mean_squared_error(y_test, pred))))

    if not maes:
        return {"splits": 0, "mae_mean": float("nan"), "rmse_mean": float("nan")}

    return {
        "splits": len(maes),
        "mae_mean": float(np.mean(maes)),
        "rmse_mean": float(np.mean(rmses)),
    }


# ────────────────────────────────────────────────────────────────
# § 4  GRADIENT BOOSTING MODEL — TRAIN & FORECAST
# ────────────────────────────────────────────────────────────────

def train_gbr(
    ts_featured: pd.DataFrame,
    forecast_horizon: int = 12,
    test_months: int = 6,
    calibration_blend: Optional[float] = None,
    diff_order: int = 0,
) -> ForecastResult:
    """
    Train a Gradient Boosting Regressor on the engineered feature set
    and produce a multi-step iterative forecast with 80 % prediction
    intervals.

    Parameters
    ----------
    ts_featured : DataFrame with occupancy_rate + engineered features
    forecast_horizon : months to predict into the future
    test_months : months to hold out for evaluation
    calibration_blend : blend weight with trailing baseline during iterative
        forecast.  *None* (default) activates adaptive blending based on
        data length.
    diff_order : int
        Differencing order from the stationarity check.  When > 0 the target
        variable is differenced before training and predictions are
        re-integrated (cumulative sum) during forecasting.
    """
    feature_cols = [
        c
        for c in ts_featured.columns
        if c not in ("occupancy_rate", "occupied_units", "total_units")
    ]

    df = ts_featured.dropna(subset=feature_cols).copy()
    if len(df) < 6:
        raise ValueError(
            f"Not enough data rows ({len(df)}) after dropping NaN lags. "
            "Need at least 6 complete months."
        )

    # ── Adaptive calibration blend ──
    if calibration_blend is None:
        calibration_blend = _adaptive_calibration_blend(len(ts_featured))

    # ── Apply differencing to target if non-stationary ──
    # Features (lags, rolling stats) were built on the *level* series in
    # add_time_features and stay unchanged.  Only the target is differenced
    # so the model learns: level-based context → predict the CHANGE.
    original_levels = None
    if diff_order > 0:
        original_levels = df["occupancy_rate"].copy()
        for _ in range(diff_order):
            df["occupancy_rate"] = df["occupancy_rate"].diff()
        df = df.dropna(subset=["occupancy_rate"]).copy()
        if len(df) < 6:
            # Not enough data after differencing — fall back to level training
            print(
                f"  [WARN] Only {len(df)} rows after d={diff_order} differencing; "
                "falling back to level-based training."
            )
            df = ts_featured.dropna(subset=feature_cols).copy()
            original_levels = None
            diff_order = 0
        else:
            original_levels = original_levels.loc[df.index]

    X = df[feature_cols].values
    y = df["occupancy_rate"].values

    # ── Hyper-parameter tuning via TimeSeriesSplit ──
    best_params = _tune_gbr_params(df, feature_cols)

    # ── Data-driven volatility cap (replaces fixed max_uplift) ──
    vol_cap = _compute_volatility_cap(y)

    # Adjust test window if data is too short
    if len(df) <= test_months + 3:
        test_months = 0

    # ── Evaluate on hold-out ──
    baselines: list[BaselineMetrics] = []
    gbr_beats_baselines = True

    if test_months > 0:
        X_train, X_test = X[:-test_months], X[-test_months:]
        y_train, y_test = y[:-test_months], y[-test_months:]

        # --- Baselines (naïve / seasonal naïve / ETS) ---
        # Baselines always operate in *level* space, so use original
        # levels when the target has been differenced.
        if diff_order > 0 and original_levels is not None:
            orig_vals = original_levels.values
            y_train_levels = orig_vals[:-test_months]
            y_test_levels = orig_vals[-test_months:]
            baselines = _evaluate_baselines(y_train_levels, y_test_levels)
        else:
            y_test_levels = y_test
            baselines = _evaluate_baselines(y_train, y_test)

        model_eval = GradientBoostingRegressor(
            loss="squared_error", random_state=42, **best_params,
        )
        model_eval.fit(X_train, y_train)

        pred_raw = model_eval.predict(X_test)
        if diff_order > 0 and original_levels is not None:
            # Undifference GBR predictions so evaluation is in level space
            pred_levels = []
            last_lev = original_levels.values[-(test_months + 1)]
            for pd_ in pred_raw:
                last_lev = float(np.clip(last_lev + pd_, 0, 1))
                pred_levels.append(last_lev)
            pred = np.array(pred_levels)
        else:
            pred = pred_raw.clip(0, 1)

        mae = mean_absolute_error(y_test_levels, pred)
        rmse = float(np.sqrt(mean_squared_error(y_test_levels, pred)))
        mape = _mape(y_test_levels, pred)

        # --- Compare GBR vs baselines ---
        best_baseline_mae = min(b.mae for b in baselines) if baselines else float("inf")
        gbr_beats_baselines = mae < best_baseline_mae
        if not gbr_beats_baselines:
            print(
                f"  [WARN] GBR (MAE={mae:.4f}) does NOT beat the best "
                f"baseline (MAE={best_baseline_mae:.4f}). Consider using "
                f"a simpler model or collecting more data."
            )
    else:
        mae = rmse = mape = float("nan")

    # ── Rolling diagnostics on expanding windows ──
    rolling_diag = _rolling_backtest(df, feature_cols, gbr_params=best_params)

    # ── Final models on ALL data ──
    model = GradientBoostingRegressor(
        loss="squared_error", random_state=42, **best_params,
    )
    model.fit(X, y)

    # Quantile models for 80 % prediction interval
    model_lo = GradientBoostingRegressor(
        loss="quantile", alpha=0.10, random_state=42, **best_params,
    )
    model_hi = GradientBoostingRegressor(
        loss="quantile", alpha=0.90, random_state=42, **best_params,
    )
    model_lo.fit(X, y)
    model_hi.fit(X, y)

    # ── Feature importances ──
    importances = model.feature_importances_
    feature_importances = {
        name: round(float(imp), 4)
        for name, imp in sorted(
            zip(feature_cols, importances), key=lambda x: x[1], reverse=True
        )
    }

    # ── Iterative multi-step forecast ──
    last_row = df.iloc[-1].copy()
    preds: list[float] = []
    preds_lo: list[float] = []
    preds_hi: list[float] = []
    last_idx = df.index[-1]

    # Build the level-space history for feature computation during forecast.
    # Features (lags, rolling stats) were engineered on levels, so the
    # extended series used to compute them must also be in level space.
    if diff_order > 0 and original_levels is not None:
        _history_levels = list(original_levels.values)
    else:
        _history_levels = list(df["occupancy_rate"].values)

    for step in range(1, forecast_horizon + 1):
        next_month = last_idx + pd.DateOffset(months=step)
        row = last_row.copy()

        # Calendar features
        row["month_num"] = next_month.month
        row["quarter"] = (next_month.month - 1) // 3 + 1
        row["year"] = next_month.year
        row["month_sin"] = np.sin(2 * np.pi * next_month.month / 12)
        row["month_cos"] = np.cos(2 * np.pi * next_month.month / 12)

        # Lag features — use actual history where available, else own predictions
        # (always in *level* space to match training features)
        extended = _history_levels + preds
        ext_n = len(extended)
        for lag in [1, 2, 3, 6, 12]:
            col = f"lag_{lag}"
            if col in feature_cols:
                idx = ext_n - lag
                row[col] = extended[idx] if idx >= 0 else 0.0

        # Rolling statistics from extended series (ddof=1 to match
        # pandas .rolling().std() used during training)
        recent = extended[-6:] if len(extended) >= 6 else extended
        if "rolling_3_mean" in feature_cols:
            row["rolling_3_mean"] = np.mean(extended[-3:]) if len(extended) >= 3 else np.mean(extended)
        if "rolling_6_mean" in feature_cols:
            row["rolling_6_mean"] = np.mean(recent)
        if "rolling_3_std" in feature_cols:
            row["rolling_3_std"] = float(np.std(extended[-3:], ddof=1)) if len(extended) >= 3 else 0.0
        if "rolling_6_std" in feature_cols:
            row["rolling_6_std"] = float(np.std(recent, ddof=1))

        # Diff features (level-space diffs)
        if "diff_1" in feature_cols:
            row["diff_1"] = extended[-1] - extended[-2] if len(extended) >= 2 else 0.0
        if "diff_12" in feature_cols:
            row["diff_12"] = extended[-1] - extended[-13] if len(extended) >= 13 else 0.0

        x_new = row[feature_cols].values.reshape(1, -1).astype(float)
        raw_pred = float(model.predict(x_new)[0])
        raw_lo = float(model_lo.predict(x_new)[0])
        raw_hi = float(model_hi.predict(x_new)[0])

        # When the target was differenced the model outputs a *change*;
        # convert back to a level before blending / capping.
        if diff_order > 0:
            last_level = extended[-1]
            raw_pred = float(np.clip(last_level + raw_pred, 0, 1))
            raw_lo = float(np.clip(last_level + raw_lo, 0, 1))
            raw_hi = float(np.clip(last_level + raw_hi, 0, 1))
        else:
            raw_pred = float(np.clip(raw_pred, 0, 1))
            raw_lo = float(np.clip(raw_lo, 0, 1))
            raw_hi = float(np.clip(raw_hi, 0, 1))

        baseline_window = extended[-12:] if len(extended) >= 12 else extended
        baseline = float(np.mean(baseline_window)) if baseline_window else 0.0
        blended = (1.0 - calibration_blend) * raw_pred + calibration_blend * baseline
        upper_bound = min(1.0, baseline + vol_cap)
        pred_val = float(np.clip(blended, 0.0, upper_bound))

        lo_val = float(np.clip(raw_lo, 0.0, pred_val))
        hi_val = float(np.clip(raw_hi, pred_val, 1.0))

        preds.append(pred_val)
        preds_lo.append(lo_val)
        preds_hi.append(hi_val)

    future_months = pd.date_range(
        start=last_idx + pd.DateOffset(months=1),
        periods=forecast_horizon,
        freq="MS",
    )
    forecast_df = pd.DataFrame(
        {
            "predicted_occupancy": preds,
            "ci_lower": preds_lo,
            "ci_upper": preds_hi,
        },
        index=future_months,
    )
    forecast_df.index.name = "month"

    return ForecastResult(
        forecast_df=forecast_df,
        mae=mae,
        rmse=rmse,
        mape=mape,
        params={
            "gbr_params": best_params,
            "calibration_blend": calibration_blend,
            "volatility_cap": vol_cap,
            "rolling_backtest": rolling_diag,
            "diff_order": diff_order,
        },
        model_object={
            "model": model,
            "model_lo": model_lo,
            "model_hi": model_hi,
            "feature_cols": feature_cols,
        },
        baselines=baselines,
        gbr_beats_baselines=gbr_beats_baselines,
        feature_importances=feature_importances,
    )


# ────────────────────────────────────────────────────────────────
# § 5  VISUALISATION
# ────────────────────────────────────────────────────────────────

def plot_forecast(
    ts: pd.DataFrame,
    result: ForecastResult,
    property_id: int,
    save_path: Optional[str] = None,
):
    """Save a plot of historical occupancy + forecast with confidence band."""
    fig, ax = plt.subplots(figsize=(14, 5))

    ax.plot(ts.index, ts["occupancy_rate"], "b-o", markersize=3, label="Historical")
    fc = result.forecast_df
    ax.plot(fc.index, fc["predicted_occupancy"], "r--s", markersize=4, label="Forecast (GBR)")

    # Shade the 80 % prediction interval if available
    if "ci_lower" in fc.columns and "ci_upper" in fc.columns:
        ax.fill_between(
            fc.index, fc["ci_lower"], fc["ci_upper"],
            color="red", alpha=0.12, label="80 % CI",
        )

    ax.set_title(f"Property {property_id} \u2014 12-Month Occupancy Forecast (Gradient Boosting)")
    ax.set_xlabel("Month")
    ax.set_ylabel("Occupancy Rate")
    ax.set_ylim(-0.05, 1.15)
    ax.legend()
    ax.grid(True, alpha=0.3)
    fig.tight_layout()

    if save_path is None:
        save_path = os.path.join(
            os.path.dirname(os.path.abspath(__file__)),
            MODEL_DIR,
            f"occupancy_forecast_property_{property_id}.png",
        )
    os.makedirs(os.path.dirname(save_path), exist_ok=True)
    fig.savefig(save_path, dpi=150)
    plt.close(fig)
    print(f"  [PLOT] Plot saved -> {save_path}")


# ────────────────────────────────────────────────────────────────
# § 6  PERSISTENCE
# ────────────────────────────────────────────────────────────────

def save_model(result: ForecastResult, property_id: int, directory: Optional[str] = None) -> str:
    """Persist the trained model + forecast to disk."""
    if directory is None:
        directory = os.path.join(os.path.dirname(os.path.abspath(__file__)), MODEL_DIR)
    os.makedirs(directory, exist_ok=True)

    path = os.path.join(directory, f"occupancy_model_property_{property_id}.pkl")
    payload = {
        "cache_version": CACHE_VERSION,
        "model_name": "GradientBoosting",
        "forecast_df": result.forecast_df,
        "mae": result.mae,
        "rmse": result.rmse,
        "mape": result.mape,
        "params": result.params,
        "model_object": result.model_object,
        "property_id": property_id,
        "trained_at": time.time(),
        "baselines": [
            {"name": b.name, "mae": b.mae, "rmse": b.rmse, "mape": b.mape}
            for b in (result.baselines or [])
        ],
        "gbr_beats_baselines": result.gbr_beats_baselines,
        "feature_importances": result.feature_importances,
        "stationarity": (
            {
                "is_stationary": result.stationarity.is_stationary,
                "p_value": result.stationarity.p_value,
                "diff_order": result.stationarity.diff_order,
            }
            if result.stationarity
            else None
        ),
    }
    joblib.dump(payload, path)
    print(f"  [SAVE] Model saved -> {path}")
    return path


def load_model(property_id: int, directory: Optional[str] = None) -> dict:
    """Load a previously saved occupancy model."""
    if directory is None:
        directory = os.path.join(os.path.dirname(os.path.abspath(__file__)), MODEL_DIR)
    path = os.path.join(directory, f"occupancy_model_property_{property_id}.pkl")
    return joblib.load(path)


def is_model_stale(
    property_id: int,
    directory: Optional[str] = None,
    max_age_seconds: int = MODEL_STALENESS_SECONDS,
) -> bool:
    """Return *True* if the cached model is older than *max_age_seconds*.

    Also returns True if no model file exists or if the ``trained_at``
    timestamp is missing (pre-v4 models).
    """
    if directory is None:
        directory = os.path.join(os.path.dirname(os.path.abspath(__file__)), MODEL_DIR)
    path = os.path.join(directory, f"occupancy_model_property_{property_id}.pkl")
    if not os.path.exists(path):
        return True
    try:
        payload = joblib.load(path)
        trained_at = payload.get("trained_at")
        if trained_at is None:
            return True  # legacy model without timestamp
        return (time.time() - trained_at) > max_age_seconds
    except Exception:
        return True


def detect_drift(
    property_id: int,
    csv_path: Optional[str] = None,
    directory: Optional[str] = None,
    tolerance: float = 0.10,
) -> dict:
    """Compare forecast predictions against newly available actuals.

    Loads the cached model's forecast DataFrame and compares any months
    that now have actual occupancy data.  If the mean absolute deviation
    exceeds *tolerance*, the model is flagged as drifted.

    Returns
    -------
    dict with keys:
        - ``drifted`` (bool): True if drift detected
        - ``overlap_months``: number of months compared
        - ``mean_abs_deviation``: MAD between forecast and actuals
        - ``tolerance``: threshold used
    """
    if directory is None:
        directory = os.path.join(os.path.dirname(os.path.abspath(__file__)), MODEL_DIR)
    path = os.path.join(directory, f"occupancy_model_property_{property_id}.pkl")
    result = {"drifted": False, "overlap_months": 0, "mean_abs_deviation": 0.0, "tolerance": tolerance}

    if not os.path.exists(path):
        return result
    try:
        payload = joblib.load(path)
        forecast_df: pd.DataFrame = payload.get("forecast_df")
        if forecast_df is None or forecast_df.empty:
            return result

        # Rebuild actuals from current data
        csv_p = csv_path or _csv_path()
        raw = load_and_clean(csv_p)
        prop_df = filter_by_property(raw, property_id)
        total_units = compute_total_units(prop_df, property_id=property_id)
        ts = build_monthly_occupancy(prop_df, total_units)

        # Find overlapping months
        overlap_idx = forecast_df.index.intersection(ts.index)
        if overlap_idx.empty:
            return result

        actual = ts.loc[overlap_idx, "occupancy_rate"].values
        predicted = forecast_df.loc[overlap_idx, "predicted_occupancy"].values
        mad = float(np.mean(np.abs(actual - predicted)))

        result["overlap_months"] = len(overlap_idx)
        result["mean_abs_deviation"] = round(mad, 4)
        result["drifted"] = mad > tolerance
        return result
    except Exception:
        return result


def needs_retraining(
    property_id: int,
    csv_path: Optional[str] = None,
    directory: Optional[str] = None,
) -> tuple[bool, str]:
    """High-level check: should we retrain for this property?

    Returns ``(should_retrain, reason)``.
    """
    if is_model_stale(property_id, directory):
        return True, "model_stale"

    drift = detect_drift(property_id, csv_path, directory)
    if drift["drifted"]:
        return True, f"drift_detected (MAD={drift['mean_abs_deviation']:.4f})"

    # Check cache_version
    if directory is None:
        directory = os.path.join(os.path.dirname(os.path.abspath(__file__)), MODEL_DIR)
    path = os.path.join(directory, f"occupancy_model_property_{property_id}.pkl")
    if os.path.exists(path):
        try:
            payload = joblib.load(path)
            if payload.get("cache_version") != CACHE_VERSION:
                return True, "cache_version_mismatch"
        except Exception:
            return True, "corrupt_model_file"

    return False, "up_to_date"


# ────────────────────────────────────────────────────────────────
# § 7  ORCHESTRATOR
# ────────────────────────────────────────────────────────────────

class OccupancyForecaster:
    """
    High-level API: load → preprocess → train → evaluate → forecast → save.

    Example
    -------
    >>> fc = OccupancyForecaster(property_id=1)
    >>> fc.run()
    >>> fc.forecast_df
    """

    def __init__(
        self,
        property_id: int = 1,
        csv_path: Optional[str] = None,
        forecast_horizon: int = 12,
        test_months: int = 6,
    ):
        self.property_id = property_id
        self.csv_path = csv_path
        self.forecast_horizon = forecast_horizon
        self.test_months = test_months

        # Populated during run()
        self.raw_df: Optional[pd.DataFrame] = None
        self.ts: Optional[pd.DataFrame] = None
        self.ts_featured: Optional[pd.DataFrame] = None
        self.result: Optional[ForecastResult] = None
        self.forecast_df: Optional[pd.DataFrame] = None

    def _step_load(self):
        print("\n" + "=" * 65)
        print(f" OCCUPANCY FORECAST - Property {self.property_id}")
        print("=" * 65)

        print("\n§ 1  Loading & cleaning training data ...")
        df = load_and_clean(self.csv_path)
        df = filter_by_property(df, self.property_id)
        self.raw_df = df
        total_units = compute_total_units(df, property_id=self.property_id)
        print(f"  Records : {len(df)}")
        print(f"  Units   : {total_units}")

        print("\n§ 2  Building monthly occupancy time-series ...")
        self.ts = build_monthly_occupancy(df, total_units)
        print(f"  Months  : {len(self.ts)}")
        print(f"  Range   : {self.ts.index.min().strftime('%Y-%m')} -> {self.ts.index.max().strftime('%Y-%m')}")
        print(f"  Rate    : mean={self.ts['occupancy_rate'].mean():.3f}  "
              f"min={self.ts['occupancy_rate'].min():.3f}  "
              f"max={self.ts['occupancy_rate'].max():.3f}")

    def _step_stationarity(self):
        print("\n§ 2b Stationarity check (ADF) ...")
        sr = check_stationarity(self.ts["occupancy_rate"])
        self._stationarity = sr
        if np.isnan(sr.p_value):
            print("  Skipped (insufficient data or statsmodels unavailable)")
        else:
            status_str = "STATIONARY" if sr.is_stationary else "NON-STATIONARY"
            print(f"  ADF stat : {sr.adf_statistic:.4f}")
            print(f"  p-value  : {sr.p_value:.4f}")
            print(f"  Status   : {status_str}")
            if sr.used_differencing:
                print(f"  Note     : became stationary after d={sr.diff_order} differencing")
            elif not sr.is_stationary:
                print(
                    "  [WARN] Series is non-stationary. Forecasts may be unreliable "
                    "for this property."
                )

    def _step_features(self):
        print("\n§ 3  Feature engineering ...")
        self.ts_featured = add_time_features(self.ts)
        feat_cols = [
            c for c in self.ts_featured.columns
            if c not in ("occupancy_rate", "occupied_units", "total_units")
        ]
        print(f"  {len(feat_cols)} features: {feat_cols}")

    def _step_train(self):
        print("\n\u00a7 4  Tuning & training GradientBoosting model ...")
        diff_order = (
            getattr(self._stationarity, "diff_order", 0)
            if hasattr(self, "_stationarity")
            else 0
        )
        self.result = train_gbr(
            self.ts_featured,
            forecast_horizon=self.forecast_horizon,
            test_months=self.test_months,
            diff_order=diff_order,
        )
        self.forecast_df = self.result.forecast_df

    def _step_evaluate(self):
        print("\n§ 5  Evaluation ...")
        r = self.result
        if not np.isnan(r.mae):
            print(f"  MAE  : {r.mae:.4f}")
            print(f"  RMSE : {r.rmse:.4f}")
            print(f"  MAPE : {r.mape:.2f}%")
            gbr_p = r.params.get("gbr_params", {}) if r.params else {}
            if gbr_p:
                print(f"  GBR   : {gbr_p}")
            vol = r.params.get("volatility_cap") if r.params else None
            if vol is not None:
                print(f"  VolCap: {vol:.4f}")
            rolling = r.params.get("rolling_backtest", {}) if r.params else {}
            if rolling.get("splits", 0) > 0:
                print(
                    "  Roll  : "
                    f"splits={rolling['splits']} "
                    f"mae={rolling['mae_mean']:.4f} "
                    f"rmse={rolling['rmse_mean']:.4f}"
                )

            # --- Baseline comparison ---
            if r.baselines:
                print("\n  Baseline comparison (hold-out):")
                print(f"    {'Model':<20} {'MAE':>8} {'RMSE':>8} {'MAPE':>8}")
                print("    " + "-" * 48)
                for b in r.baselines:
                    print(f"    {b.name:<20} {b.mae:>8.4f} {b.rmse:>8.4f} {b.mape:>7.2f}%")
                print(f"    {'GBR':<20} {r.mae:>8.4f} {r.rmse:>8.4f} {r.mape:>7.2f}%")
                if r.gbr_beats_baselines:
                    print("    [OK] GBR outperforms all baselines.")
                else:
                    print("    [!!] GBR does NOT beat the best baseline.")

            # --- Feature importances ---
            if r.feature_importances:
                print("\n  Top feature importances:")
                for i, (feat, imp) in enumerate(r.feature_importances.items()):
                    if i >= 5:
                        break
                    print(f"    {feat:<20} {imp:.4f}")
        else:
            print("  (insufficient data for hold-out evaluation)")

    def _step_forecast_table(self):
        print(f"\n§ 6  12-Month Forecast ...")
        has_ci = "ci_lower" in self.forecast_df.columns
        if has_ci:
            print(f"  {'Month':<12} {'Predicted':>10} {'CI Low':>10} {'CI High':>10}")
            print("  " + "-" * 46)
        else:
            print(f"  {'Month':<12} {'Predicted':>10}")
            print("  " + "-" * 24)
        for idx, row in self.forecast_df.iterrows():
            m = idx.strftime("%Y-%m")
            pred = f"{row['predicted_occupancy']:.4f}"
            if has_ci:
                lo = f"{row['ci_lower']:.4f}"
                hi = f"{row['ci_upper']:.4f}"
                print(f"  {m:<12} {pred:>10} {lo:>10} {hi:>10}")
            else:
                print(f"  {m:<12} {pred:>10}")

    def _step_save(self):
        print("\n§ 7  Saving artefacts ...")
        save_model(self.result, self.property_id)
        plot_forecast(self.ts, self.result, self.property_id)

    def run(self) -> ForecastResult:
        """Execute the full pipeline."""
        self._step_load()
        self._step_stationarity()
        self._step_features()
        self._step_train()
        # Attach stationarity result to the ForecastResult
        if self.result is not None and hasattr(self, "_stationarity"):
            self.result.stationarity = self._stationarity
        self._step_evaluate()
        self._step_forecast_table()
        self._step_save()
        print("\n[OK] Pipeline complete.\n")
        return self.result


# ────────────────────────────────────────────────────────────────
# CLI
# ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Occupancy forecasting per property (Ridge)")
    parser.add_argument("--property_id", type=int, default=1, help="Property ID to forecast")
    parser.add_argument("--horizon", type=int, default=12, help="Months to forecast")
    parser.add_argument("--test_months", type=int, default=6, help="Hold-out months for evaluation")
    args = parser.parse_args()

    forecaster = OccupancyForecaster(
        property_id=args.property_id,
        forecast_horizon=args.horizon,
        test_months=args.test_months,
    )
    forecaster.run()
