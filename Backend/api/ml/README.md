# Adaptive Notification Timing — ML System

## Problem Statement

Predict the **optimal hour (0-23) to send a payment reminder notification** to each tenant, maximizing the likelihood they see it and pay promptly. The system learns from each tenant's actual payment timing patterns.

## Architecture

**Model**: `RandomForestRegressor` (scikit-learn)
- 100 estimators, max_depth=15, min_samples_split=10, min_samples_leaf=5
- Regression target: `payment_hour` (continuous, 0-23)
- Output is rounded to nearest integer hour

**Why Random Forest?**
- Handles mixed feature types (categorical encoded + continuous) without much preprocessing
- Built-in feature importance for interpretability
- Ensemble variance provides a natural **confidence score** without needing calibration
- Robust to the noisy, small-dataset regime during early deployment

## File Structure

```
api/ml/
├── README.md                        # This file
├── generate_synthetic_data.py       # Synthetic data generator (7 tenant profiles)
├── train_notification_model.py      # Model class: train, predict, save, load
├── run_all.py                       # Full pipeline: generate → train → test
├── use_model_example.py             # Django integration examples
├── synthetic_notification_data.csv  # Generated synthetic training data
├── models/
│   ├── latest_model.pkl             # Current production model
│   └── previous_model.pkl           # Backup (auto-rotated on retrain)
└── __pycache__/

Management commands:
├── api/management/commands/
│   ├── retrain_ml_model.py          # Weekly retrain using real + synthetic data
│   └── update_ml_schedules.py       # Daily: predict & auto-apply schedules
```

## Confidence Estimation

Confidence is derived from **inter-tree disagreement** (ensemble variance):

```python
tree_predictions = [tree.predict(X) for tree in model.estimators_]  # 100 predictions
prediction_std = std(tree_predictions)
confidence = clip(1 - (prediction_std / 6.0), 0, 1)
```

- `max_std = 6` is a normalization constant (hours). If trees disagree by 6+ hours, confidence = 0.
- A tenant with consistent 10 PM payments → trees agree → low std → high confidence (~75%+).
- A tenant with scattered payment times → trees disagree → high std → low confidence.
- **Auto-apply threshold**: confidence >= 50% triggers automatic schedule update.

## Feature Vector (17 features)

| Feature | Type | Description |
|---|---|---|
| `payment_hour_mean` | Aggregated | Mean payment hour across all tenant transactions |
| `payment_hour_std` | Aggregated | Std dev of payment hours (consistency measure) |
| `payment_day_of_week_mean` | Aggregated | Average weekday of payments |
| `days_from_due_date_mean/std` | Aggregated | How early/late tenant typically pays |
| `is_on_time_mean` | Aggregated | Fraction of on-time payments |
| `is_early_mean` | Aggregated | Fraction of early payments |
| `is_late_mean` | Aggregated | Fraction of late payments |
| `hours_notification_to_payment_mean` | Aggregated | Avg response delay after notification |
| `days_before_due` | Per-event | Days remaining before due date |
| `preferred_payment_day` | Context | Owner-configured due day of month |
| `warning_flag` | Context | Whether tenant has a warning flag |
| `monthly_rent` | Context | Rent amount (behavioral proxy) |
| `month_of_year` | Temporal | Current month (seasonality) |
| `quarter` | Temporal | Current quarter |
| `profile_type_encoded` | Categorical | Label-encoded tenant profile type |
| `property_id` | Categorical | Property identifier |

**Most important feature**: `payment_hour_mean` dominates at ~64% importance. The best predictor of when someone will pay is when they've historically paid. The model learns to trust this feature heavily while using std, on-time rate, and temporal features for refinement.

## Data Pipeline

### Phase 1 — Cold Start (Synthetic Data)

`generate_synthetic_data.py` creates training data with 7 behavioral archetypes:

| Profile | Weight | Payment Hours | On-time Rate |
|---|---|---|---|
| early_morning_person | 15% | 6-9 | 85% |
| afternoon_person | 18% | 12-16 | 75% |
| evening_person | 20% | 18-22 | 65% |
| late_night_person | 22% | 22-1 | 50% |
| weekend_payer | 10% | 10-15 (weekends) | 70% |
| inconsistent_payer | 10% | 8-22 (uniform) | 55% |
| prompt_payer | 5% | 9-11 | 95% |

Each synthetic tenant generates **~18 months x ~3 notification events/month = ~54 rows**. Total: 200 tenants x ~54 = ~10,800 training rows.

The format is one row per notification-payment event, not one row per tenant.

### Phase 2 — Real Data Extraction

`retrain_ml_model.py` extracts real training data from `Property.layouts` JSON:

1. For each occupied room with >= 3 rent transactions:
   - **First pass**: Parse all transactions, compute tenant-level aggregates (mean hour, std, late rate, etc.).
   - **Second pass**: Generate **one training row per transaction** with:
     - `payment_hour` = that transaction's actual hour (TARGET)
     - Aggregated features as context (same across all rows for that tenant)
   - This matches the synthetic data format (multiple rows per tenant).

2. A tenant with 25 transactions generates 25 training rows — not 1 aggregated row.

### Phase 3 — Mixing Strategy

Real and synthetic data are mixed based on real data volume:

| Real Rows | Mix Ratio | Rationale |
|---|---|---|
| < 50 | 30% real / 70% synthetic | Limited signal, synthetic provides structure |
| 50-200 | 60% real / 40% synthetic | Enough real data to dominate |
| 200-500 | 85% real / 15% synthetic | Synthetic as regularizer only |
| 500+ | 100% real | Fully data-driven |

Synthetic rows are randomly sampled down to achieve the target ratio. Only columns present in both datasets are kept.

## Training & Deployment

### Initial Training

```bash
cd Backend/api/ml
py run_all.py
```

Generates synthetic data → trains model → saves to `models/latest_model.pkl`.

### Weekly Auto-Retrain (Every Sunday)

Background daemon thread in `apps.py` calls `retrain_ml_model` management command:
- Extracts real data from `Property.layouts` transactions
- Mixes with synthetic data based on volume thresholds
- Retrains and saves (latest → previous rotation)

```bash
# Manual retrain
py manage.py retrain_ml_model
py manage.py retrain_ml_model --dry-run        # Preview without saving
py manage.py retrain_ml_model --min-real-tenants 3
```

### Daily Schedule Update

Background thread calls `update_ml_schedules` command. For each tenant:
1. Extract real transaction features
2. Run prediction
3. If confidence >= 50% → auto-apply to `TenantMessageSchedule.send_hour`

```bash
# Manual update
py manage.py update_ml_schedules --all-properties
py manage.py update_ml_schedules --all-properties --force  # Bypass daily throttle
```

### Model Rotation

Only 2 pkl files kept:
- `latest_model.pkl` — current production model
- `previous_model.pkl` — backup for rollback

On save: latest → previous (overwrite), new → latest.

**Rollback**: Rename `previous_model.pkl` → `latest_model.pkl` and restart.

## Inference Flow

```
Tenant pays at 10 PM consistently (5 transactions at hours 21, 22, 22, 23, 22)
    ↓
Feature extraction: payment_hour_mean=22.0, payment_hour_std=0.63
    ↓
Random Forest: 100 trees each predict ~21-23
    ↓
Mean prediction: 22.0, tree std: 0.8
    ↓
Confidence: 1 - (0.8/6.0) = 0.87 (87%)
    ↓
Rounded prediction: 22:00, confidence: 87% (>50% threshold)
    ↓
Auto-applied: notification will be sent at 22:00
```

## Django Integration

### Predict for a Single Tenant

```python
from api.ml.train_notification_model import NotificationTimingModel
import pandas as pd

model = NotificationTimingModel.load_model('api/ml/models/latest_model.pkl')

features = pd.DataFrame([{
    'payment_hour_mean': 22.0,
    'payment_hour_std': 0.63,
    'payment_day_of_week_mean': 3.0,
    'days_from_due_date_mean': 0.0,
    'days_from_due_date_std': 1.0,
    'is_on_time_mean': 0.80,
    'is_early_mean': 0.20,
    'is_late_mean': 0.20,
    'hours_notification_to_payment_mean': 24.0,
    'days_before_due': 2,
    'preferred_payment_day': 5,
    'warning_flag': False,
    'monthly_rent': 10000,
    'month_of_year': 2,
    'quarter': 1,
    'profile_type_encoded': 0,
    'property_id': 1,
    'tenant_id': 1,
    'room_number': 'A1',
    'profile_type': 'real',
}])

optimal_hour, confidence = model.predict_optimal_hour(features)
print(f"Send at {optimal_hour[0]:02d}:00 ({confidence[0]:.0%} confidence)")
```

### API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/ml/predict-notification-time/` | POST | Predict for a single tenant |
| `/api/ml/batch-update-schedules/` | POST | Apply predictions to all tenants in a property |

## Known Limitations & Trade-offs

1. **One global model, not per-tenant**: A single Random Forest serves all tenants. Per-tenant features provide personalization. Works because `payment_hour_mean` is so dominant — the model learns "predict near the mean payment hour, adjusted by consistency and temporal context."

2. **Notification-payment causal link is approximated**: For real data, we don't track which notification triggered which payment. We estimate `notification_hour = payment_hour - 2`. Synthetic data has proper causal simulation.

3. **Cold start**: New tenants with < 3 transactions get default features (`payment_hour_mean=9.0`) → low confidence → fall back to owner's configured time. No bad predictions are applied.

4. **Feature leakage by design**: `payment_hour_mean` is both derived from the target distribution and used as a feature. This is intentional — we're building a behavior-matching system, not a causal model. The mean is the strongest signal available.

## Monitoring

Track these metrics after deployment:
- **Prediction Accuracy**: Compare predicted vs actual payment hours
- **Confidence Distribution**: % of tenants above/below 50% threshold
- **Notification Effectiveness**: % of tenants paying within 48h of notification
- **Data Growth**: Real rows extracted per retrain cycle

## License

Part of MP-SAN Tenant Management System
