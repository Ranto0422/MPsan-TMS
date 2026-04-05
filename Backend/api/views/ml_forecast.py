"""
API views for the occupancy forecast ML model.
Provides endpoints to generate and retrieve 12-month occupancy forecasts
for a given property.
"""

import math
import os
import traceback

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.conf import settings


def _sanitize(obj):
    """Replace NaN / Inf floats with None so JSON serialisation never fails."""
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    return obj


class OccupancyForecastView(APIView):
    """
    GET /api/ml/occupancy-forecast/<property_id>/
    Returns a 12-month occupancy forecast for the given property.

    Response shape:
    {
        "property_id": 1,
        "model_name": "Ridge",
        "metrics": { "mae": 0.01, "rmse": 0.011, "mape": 1.36 },
        "historical": [
            { "month": "2021-04", "occupancy_rate": 0.067 }, ...
        ],
        "forecast": [
            { "month": "2026-04", "predicted_occupancy": 0.99 }, ...
        ]
    }
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, property_id):
        try:
            from api.ml.occupancy_forecast import (
                OccupancyForecaster,
                build_monthly_occupancy,
                compute_total_units,
                filter_by_property,
                load_and_clean,
                load_model,
                needs_retraining,
                CACHE_VERSION,
            )

            csv_path = os.path.join(
                settings.BASE_DIR, 'api', 'ml', 'occupancy_training_data.csv',
            )
            if not os.path.exists(csv_path):
                return Response(
                    {'detail': 'Training data file not found. Please generate occupancy_training_data.csv first.'},
                    status=status.HTTP_404_NOT_FOUND,
                )

            property_id = int(property_id)
            payload = None
            model_path = os.path.join(
                settings.BASE_DIR,
                'api',
                'ml',
                'models',
                f'occupancy_model_property_{property_id}.pkl',
            )
            if os.path.exists(model_path) and os.path.getmtime(model_path) >= os.path.getmtime(csv_path):
                # Check staleness / drift / version before trusting cache
                should_retrain, retrain_reason = needs_retraining(property_id, csv_path)
                if not should_retrain:
                    payload = load_model(property_id)
                    cached_fc = payload.get('forecast_df') if isinstance(payload, dict) else None
                    cache_version = payload.get('cache_version') if isinstance(payload, dict) else None
                    if cache_version != CACHE_VERSION or cached_fc is None or len(cached_fc) != 12:
                        payload = None
                else:
                    payload = None  # force retrain

            if payload is None:
                forecaster = OccupancyForecaster(
                    property_id=property_id,
                    csv_path=csv_path,
                    forecast_horizon=12,
                    test_months=6,
                )
                forecaster.run()
                forecast_df = forecaster.forecast_df
                result = forecaster.result
            else:
                forecast_df = payload.get('forecast_df')
                class _Result:
                    pass
                result = _Result()
                result.mae = payload.get('mae', float('nan'))
                result.rmse = payload.get('rmse', float('nan'))
                result.mape = payload.get('mape', float('nan'))
                result.params = payload.get('params', {})
                result.feature_importances = payload.get('feature_importances', {})

            # Build historical series from source data (works for cached + fresh)
            raw_df = load_and_clean(csv_path)
            property_df = filter_by_property(raw_df, property_id)
            total_units = compute_total_units(property_df, property_id=property_id)
            ts = build_monthly_occupancy(property_df, total_units)

            # Build historical series
            historical = []
            if ts is not None:
                for idx, row in ts.iterrows():
                    historical.append({
                        'month': idx.strftime('%Y-%m'),
                        'occupancy_rate': round(float(row['occupancy_rate']), 4),
                    })

            # Build forecast series
            forecast = []
            if forecast_df is not None:
                for idx, row in forecast_df.iterrows():
                    entry = {
                        'month': idx.strftime('%Y-%m'),
                        'predicted_occupancy': round(float(row['predicted_occupancy']), 4),
                    }
                    if 'ci_lower' in row.index:
                        entry['ci_lower'] = round(float(row['ci_lower']), 4)
                    if 'ci_upper' in row.index:
                        entry['ci_upper'] = round(float(row['ci_upper']), 4)
                    forecast.append(entry)

            metrics = {}
            baselines_data = []
            stationarity_data = None
            gbr_beats = True

            if result is not None:
                rolling = (result.params or {}).get('rolling_backtest', {}) if hasattr(result, 'params') else {}
                metrics = {
                    'mae': round(result.mae, 4) if not math.isnan(result.mae) else None,
                    'rmse': round(result.rmse, 4) if not math.isnan(result.rmse) else None,
                    'mape': round(result.mape, 2) if not math.isnan(result.mape) else None,
                    'rolling_splits': int(rolling.get('splits', 0)) if rolling else 0,
                    'rolling_mae': round(float(rolling.get('mae_mean')), 4) if rolling and rolling.get('mae_mean') is not None and not math.isnan(float(rolling.get('mae_mean'))) else None,
                    'rolling_rmse': round(float(rolling.get('rmse_mean')), 4) if rolling and rolling.get('rmse_mean') is not None and not math.isnan(float(rolling.get('rmse_mean'))) else None,
                }

                # Baseline data (from live result or cached payload)
                if hasattr(result, 'baselines') and result.baselines:
                    baselines_data = [
                        {'name': b.name, 'mae': round(b.mae, 4), 'rmse': round(b.rmse, 4), 'mape': round(b.mape, 2)}
                        for b in result.baselines
                    ]
                    gbr_beats = getattr(result, 'gbr_beats_baselines', True)
                elif isinstance(payload, dict) and payload.get('baselines'):
                    baselines_data = payload['baselines']
                    gbr_beats = payload.get('gbr_beats_baselines', True)

                # Stationarity data
                if hasattr(result, 'stationarity') and result.stationarity is not None:
                    sr = result.stationarity
                    stationarity_data = {
                        'is_stationary': sr.is_stationary,
                        'p_value': round(sr.p_value, 4) if not math.isnan(sr.p_value) else None,
                        'diff_order': sr.diff_order,
                    }
                elif isinstance(payload, dict) and payload.get('stationarity'):
                    stationarity_data = payload['stationarity']

                # Feature importances
                feature_importances_data = {}
                if hasattr(result, 'feature_importances') and result.feature_importances:
                    feature_importances_data = result.feature_importances
                elif isinstance(payload, dict) and payload.get('feature_importances'):
                    feature_importances_data = payload['feature_importances']

            return Response(_sanitize({
                'property_id': property_id,
                'model_name': 'GradientBoosting',
                'metrics': metrics,
                'baselines': baselines_data,
                'gbr_beats_baselines': gbr_beats,
                'stationarity': stationarity_data,
                'feature_importances': feature_importances_data,
                'historical': historical,
                'forecast': forecast,
            }))

        except ValueError as e:
            # No training data for this property yet — try on-demand backfill
            try:
                from api.ml.occupancy_data_pipeline import backfill_property_tenants
                added = backfill_property_tenants(int(property_id))
                if added > 0:
                    # Retry with newly backfilled data
                    forecaster = OccupancyForecaster(
                        property_id=int(property_id),
                        csv_path=csv_path,
                        forecast_horizon=12,
                        test_months=6,
                    )
                    forecaster.run()
                    forecast_df = forecaster.forecast_df
                    result = forecaster.result

                    raw_df = load_and_clean(csv_path)
                    property_df = filter_by_property(raw_df, int(property_id))
                    total_units = compute_total_units(property_df, property_id=int(property_id))
                    ts = build_monthly_occupancy(property_df, total_units)

                    historical = []
                    if ts is not None:
                        for idx, row in ts.iterrows():
                            historical.append({
                                'month': idx.strftime('%Y-%m'),
                                'occupancy_rate': round(float(row['occupancy_rate']), 4),
                            })

                    forecast = []
                    if forecast_df is not None:
                        for idx, row in forecast_df.iterrows():
                            entry = {
                                'month': idx.strftime('%Y-%m'),
                                'predicted_occupancy': round(float(row['predicted_occupancy']), 4),
                            }
                            if 'ci_lower' in row.index:
                                entry['ci_lower'] = round(float(row['ci_lower']), 4)
                            if 'ci_upper' in row.index:
                                entry['ci_upper'] = round(float(row['ci_upper']), 4)
                            forecast.append(entry)

                    metrics = {}
                    feature_importances_data = {}
                    if result is not None:
                        metrics = {
                            'mae': round(result.mae, 4) if not math.isnan(result.mae) else None,
                            'rmse': round(result.rmse, 4) if not math.isnan(result.rmse) else None,
                            'mape': round(result.mape, 2) if not math.isnan(result.mape) else None,
                        }
                        if hasattr(result, 'feature_importances') and result.feature_importances:
                            feature_importances_data = result.feature_importances

                    return Response(_sanitize({
                        'property_id': int(property_id),
                        'model_name': 'GradientBoosting',
                        'metrics': metrics,
                        'baselines': [],
                        'gbr_beats_baselines': True,
                        'stationarity': None,
                        'feature_importances': feature_importances_data,
                        'historical': historical,
                        'forecast': forecast,
                    }))
            except Exception:
                traceback.print_exc()

            return Response(_sanitize({
                'property_id': property_id,
                'model_name': 'GradientBoosting',
                'metrics': {},
                'baselines': [],
                'gbr_beats_baselines': True,
                'stationarity': None,
                'feature_importances': {},
                'historical': [],
                'forecast': [],
                'detail': str(e),
            }))
        except Exception as e:
            traceback.print_exc()
            return Response(
                {'detail': f'Forecast failed: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )
