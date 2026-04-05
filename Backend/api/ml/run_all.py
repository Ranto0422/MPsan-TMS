"""
Quick Start Script - Run All ML Pipeline Steps

This script runs the complete ML pipeline:
1. Generate synthetic training data
2. Train the model
3. Save the trained model

Usage:
    py run_all.py
"""

import os
import sys
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

print("=" * 70)
print(" ADAPTIVE NOTIFICATION TIMING - COMPLETE ML PIPELINE")
print("=" * 70)

print("\n📊 STEP 1: Generating Synthetic Training Data")
print("-" * 70)

from generate_synthetic_data import SyntheticDataGenerator

# Generate synthetic data
generator = SyntheticDataGenerator(
    n_tenants=200,  # 200 unique tenant profiles for broader coverage
    n_months=18,    # 18 months of payment history per tenant
    seed=42         # Reproducible results
)

df = generator.generate_and_save('synthetic_notification_data.csv')

print("\n✓ Synthetic data generated successfully!")
print(f"  File: synthetic_notification_data.csv")
print(f"  Records: {len(df):,}")

print("\n" + "=" * 70)
print("\n🤖 STEP 2: Training ML Model")
print("-" * 70)

from train_notification_model import NotificationTimingModel, analyze_notification_effectiveness

# Analyze notification patterns
analyze_notification_effectiveness(df)

# Train model
model = NotificationTimingModel()
metadata = model.train(df, target_col='payment_hour')

# Save model
model_path = model.save_model('models')

print("\n✓ Model trained and saved successfully!")
print(f"  Model file: {model_path}")
print(f"  Test MAE: {metadata['performance_metrics']['test_mae']:.2f} hours")
print(f"  Test R²: {metadata['performance_metrics']['test_r2']:.4f}")

print("\n" + "=" * 70)
print("\n🧪 STEP 3: Testing Model Predictions")
print("-" * 70)

# Load the saved model to verify it works
loaded_model = NotificationTimingModel.load_model('models/latest_model.pkl')

# Test predictions on sample tenants
import pandas as pd

sample_tenants = df.groupby('tenant_id').first().sample(min(5, df['tenant_id'].nunique())).reset_index()
predicted_hours, confidence = loaded_model.predict_optimal_hour(sample_tenants)

print("\nSample Predictions:")
print("-" * 70)
for i, (idx, row) in enumerate(sample_tenants.iterrows()):
    print(f"\n🎯 Tenant {row['tenant_id']} ({row['profile_type']})")
    print(f"   Historical avg payment hour: {row['payment_hour_mean']:.1f}")
    print(f"   Predicted optimal hour: {predicted_hours[i]:02d}:00")
    print(f"   Confidence: {confidence[i]:.1%}")

print("\n" + "=" * 70)
print("\n✅ PIPELINE COMPLETE!")
print("=" * 70)

print("\n📋 Summary:")
print(f"  ✓ Generated {len(df):,} training samples")
print(f"  ✓ Trained model with {metadata['n_features']} features")
print(f"  ✓ Model accuracy: ±{metadata['performance_metrics']['test_mae']:.1f} hours")
print(f"  ✓ Saved to: {model_path}")

print("\n📖 Next Steps:")
print("  1. Review the README.md for integration instructions")
print("  2. See use_model_example.py for Django integration code")
print("  3. Start collecting real payment data for retraining")
print("  4. Deploy model in production after testing")

print("\n" + "=" * 70)
