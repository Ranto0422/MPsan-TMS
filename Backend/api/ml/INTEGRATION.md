# ML Model Integration with Tenant Schedules

## ✅ Integration Complete

The machine learning model is now connected to the tenant message scheduling system. You can use ML predictions to optimize notification send times for each tenant.

## What Was Implemented

### 1. API Endpoints

#### **POST /api/ml/predict-notification-time/**
Predict optimal notification time for a single tenant.

**Request:**
```json
{
  "property_id": 1,
  "room_number": "upper4",
  "tenant_layout_id": 12345
}
```

**Response:**
```json
{
  "optimal_hour": 14,
  "confidence": 0.85,
  "recommended": true,
  "message": "ML model recommends sending at 14:00 with 85.0% confidence."
}
```

#### **POST /api/ml/batch-update-schedules/**
Batch update all tenant schedules for a property using ML predictions.

**Request:**
```json
{
  "property_id": 1,
  "min_confidence": 0.5
}
```

**Response:**
```json
{
  "property_id": 1,
  "property_name": "My Property",
  "updated": 15,
  "skipped": 3,
  "min_confidence": 0.5,
  "results": [
    {
      "room_number": "upper4",
      "tenant_name": "John Doe",
      "optimal_hour": 14,
      "confidence": 0.85,
      "updated": true
    },
    ...
  ]
}
```

### 2. Django Management Command

**Command:** `py manage.py update_ml_schedules`

**Usage:**
```bash
# Update specific property
cd Backend
py manage.py update_ml_schedules --property-id 1

# Update all properties
py manage.py update_ml_schedules --all-properties

# Set minimum confidence threshold
py manage.py update_ml_schedules --property-id 1 --min-confidence 0.7

# Preview without saving (dry run)
py manage.py update_ml_schedules --property-id 1 --dry-run
```

**Example Output:**
```
============================================================
Processing: My Property (ID: 1)
============================================================
✓ upper4       | John Doe             | Hour: 14:00 | Confidence: 85.0%
✓ upper5       | Jane Smith           | Hour: 09:00 | Confidence: 72.3%
⊗ middle2      | Bob Johnson          | Hour: 16:00 | Confidence: 45.2%
============================================================
SUMMARY
============================================================
Total Updated: 15
Total Skipped: 3
Confidence Threshold: 50.0%
```

### 3. Database Integration

The ML predictions are stored in the `TenantMessageSchedule` model:
- `send_hour` - Predicted optimal hour (0-23)
- `use_custom_schedule` - Set to `True` when using ML prediction
- `tenant_name` - Cached tenant name
- `room_number` - Room identifier

## How It Works

1. **Feature Extraction**: System uses default features (since no payment history tracked yet)
   - Default payment hour: 9 AM
   - Default consistency: moderate
   - Property-specific rent amounts
   - Temporal features (month, quarter)

2. **ML Prediction**: Random Forest model predicts optimal hour
   - Returns hour (0-23) and confidence score (0-1)
   - Only updates if confidence meets threshold (default: 0.5)

3. **Database Update**: Creates/updates `TenantMessageSchedule` record
   - Sets `send_hour` to predicted value
   - Enables `use_custom_schedule`
   - Automated messaging system uses these schedules

## Current Limitations

⚠️ **Using Default Features**
- System doesn't track actual payment timestamps yet
- ML predictions based on synthetic training data + defaults
- To improve accuracy, implement payment timestamp tracking

⚠️ **No Frontend UI**
- API endpoints work, but no UI to trigger them
- Need to use API client or Django admin

## Next Steps to Improve

### 1. Track Payment Timestamps
Add `payment_datetime` field to Payment/Tenant model to capture actual payment times.

### 2. Retrain with Real Data
After collecting 3-6 months of payment data:
```bash
cd Backend/api/ml
# Export real data and retrain
py train_notification_model.py --data real_payment_data.csv
```

### 3. Build Frontend UI
Add interface to:
- View ML predictions
- Trigger batch updates
- Display confidence scores
- Override predictions manually

### 4. Schedule Automatic Updates
Use Celery/Cron to run monthly:
```bash
py manage.py update_ml_schedules --all-properties --min-confidence 0.6
```

### 5. A/B Testing
Split tenants 50/50:
- Control group: Fixed 9 AM schedule
- Treatment group: ML-predicted times
- Compare payment response times after 2-3 months

## Testing the Integration

### Test Single Prediction
```bash
curl -X POST http://localhost:8000/api/ml/predict-notification-time/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "property_id": 1,
    "room_number": "upper4",
    "tenant_layout_id": 12345
  }'
```

### Test Batch Update
```bash
curl -X POST http://localhost:8000/api/ml/batch-update-schedules/ \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "property_id": 1,
    "min_confidence": 0.5
  }'
```

### Test Management Command
```bash
cd Backend
py manage.py update_ml_schedules --property-id 1 --dry-run
```

## Files Modified

- ✅ `Backend/api/views.py` - Added ML prediction views
- ✅ `Backend/api/urls.py` - Added ML endpoints
- ✅ `Backend/api/management/commands/update_ml_schedules.py` - Created management command

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (Future)                                      │
│  - Trigger ML predictions                               │
│  - View confidence scores                               │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  API Endpoints                                          │
│  • POST /api/ml/predict-notification-time/              │
│  • POST /api/ml/batch-update-schedules/                 │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  ML Model (Backend/api/ml/)                             │
│  • NotificationTimingModel                              │
│  • Random Forest Regressor                              │
│  • Feature extraction from DB                           │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Database (TenantMessageSchedule)                       │
│  • send_hour: Predicted optimal hour                    │
│  • use_custom_schedule: True                            │
│  • confidence stored in prediction response             │
└─────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│  Automated Messaging System                             │
│  • Uses TenantMessageSchedule                           │
│  • Sends at ML-predicted times                          │
└─────────────────────────────────────────────────────────┘
```

## Support

For issues or questions:
1. Check ML model is trained: `Backend/api/ml/models/latest_model.pkl`
2. Review model performance: `Backend/api/ml/models/model_metadata_*.json`
3. Check API errors in Django logs
4. Verify tenant data exists in Property.layouts JSON

## Summary

🎉 **The ML model is now fully integrated with the tenant scheduling system!**

You can now use API endpoints or the management command to apply ML predictions to optimize notification send times for your tenants.
