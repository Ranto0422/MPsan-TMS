"""
ML Model Training for Adaptive Notification Timing

Trains a model to predict the optimal notification send time for each tenant
based on their historical payment behavior patterns.
"""

import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.ensemble import RandomForestRegressor, GradientBoostingRegressor
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import joblib
import json
from datetime import datetime
import os


class NotificationTimingModel:
    """
    Predicts optimal notification send hour based on tenant behavior.
    
    Target: Best notification hour (0-23) that minimizes time to payment
    """
    
    def __init__(self):
        self.model = None
        self.scaler = StandardScaler()
        self.label_encoders = {}
        self.feature_columns = []
        self.metadata = {
            'trained_at': None,
            'n_samples': 0,
            'model_type': 'RandomForest',
            'performance_metrics': {}
        }
    
    def prepare_features(self, df, is_training=True):
        """
        Prepare features for model training/prediction
        
        Features:
        - Tenant behavior: avg payment hour, consistency, on-time rate
        - Temporal: day of week preferences, time patterns
        - Historical: notification hours tried, response times
        """
        
        df = df.copy()
        
        # Encode categorical variables
        categorical_cols = ['profile_type', 'room_number']
        for col in categorical_cols:
            if col in df.columns:
                if is_training:
                    self.label_encoders[col] = LabelEncoder()
                    df[f'{col}_encoded'] = self.label_encoders[col].fit_transform(df[col].astype(str))
                else:
                    if col in self.label_encoders:
                        # Handle unseen categories
                        le = self.label_encoders[col]
                        df[f'{col}_encoded'] = df[col].astype(str).map(
                            lambda x: le.transform([x])[0] if x in le.classes_ else -1
                        )
        
        # Select features for training
        feature_cols = [
            # Tenant aggregated behavior
            'payment_hour_mean',
            'payment_hour_std',
            'payment_day_of_week_mean',
            'days_from_due_date_mean',
            'days_from_due_date_std',
            'is_on_time_mean',
            'is_early_mean',
            'is_late_mean',
            'hours_notification_to_payment_mean',
            
            # Current context
            'days_before_due',
            'preferred_payment_day',
            'warning_flag',
            'monthly_rent',
            
            # Temporal features
            'month_of_year',
            'quarter',
            
            # Encoded categoricals
            'profile_type_encoded',
            'property_id',
        ]
        
        # Filter to available columns
        feature_cols = [col for col in feature_cols if col in df.columns]
        
        if is_training:
            self.feature_columns = feature_cols
        
        X = df[self.feature_columns].fillna(0)
        
        return X
    
    def train(self, df, target_col='payment_hour', test_size=0.2, random_state=42):
        """
        Train the notification timing model
        
        Args:
            df: Training dataframe
            target_col: Target column (payment_hour or optimal notification hour)
            test_size: Test set size
            random_state: Random seed
        """
        
        print("=" * 60)
        print("TRAINING ADAPTIVE NOTIFICATION TIMING MODEL")
        print("=" * 60)
        
        # Prepare features
        print("\n1. Preparing features...")
        X = self.prepare_features(df, is_training=True)
        y = df[target_col].values
        
        print(f"   Features: {len(self.feature_columns)}")
        print(f"   Samples: {len(X)}")
        print(f"   Target: {target_col}")
        
        # Split data
        print("\n2. Splitting data...")
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=test_size, random_state=random_state
        )
        print(f"   Training samples: {len(X_train)}")
        print(f"   Test samples: {len(X_test)}")
        
        # Scale features
        print("\n3. Scaling features...")
        X_train_scaled = self.scaler.fit_transform(X_train)
        X_test_scaled = self.scaler.transform(X_test)
        
        # Train model
        print("\n4. Training Random Forest model...")
        self.model = RandomForestRegressor(
            n_estimators=100,
            max_depth=15,
            min_samples_split=10,
            min_samples_leaf=5,
            random_state=random_state,
            n_jobs=-1
        )
        
        self.model.fit(X_train_scaled, y_train)
        
        # Evaluate
        print("\n5. Evaluating model...")
        train_pred = self.model.predict(X_train_scaled)
        test_pred = self.model.predict(X_test_scaled)
        
        # Calculate metrics
        train_mae = mean_absolute_error(y_train, train_pred)
        test_mae = mean_absolute_error(y_test, test_pred)
        train_rmse = np.sqrt(mean_squared_error(y_train, train_pred))
        test_rmse = np.sqrt(mean_squared_error(y_test, test_pred))
        train_r2 = r2_score(y_train, train_pred)
        test_r2 = r2_score(y_test, test_pred)
        
        print("\n" + "=" * 60)
        print("MODEL PERFORMANCE")
        print("=" * 60)
        print(f"\nTraining Set:")
        print(f"  MAE:  {train_mae:.2f} hours")
        print(f"  RMSE: {train_rmse:.2f} hours")
        print(f"  R²:   {train_r2:.4f}")
        
        print(f"\nTest Set:")
        print(f"  MAE:  {test_mae:.2f} hours")
        print(f"  RMSE: {test_rmse:.2f} hours")
        print(f"  R²:   {test_r2:.4f}")
        
        # Feature importance
        print("\n" + "=" * 60)
        print("TOP 10 FEATURE IMPORTANCE")
        print("=" * 60)
        feature_importance = pd.DataFrame({
            'feature': self.feature_columns,
            'importance': self.model.feature_importances_
        }).sort_values('importance', ascending=False)
        
        print(feature_importance.head(10).to_string(index=False))
        
        # Store metadata
        self.metadata = {
            'trained_at': datetime.now().isoformat(),
            'n_samples': len(X),
            'n_features': len(self.feature_columns),
            'model_type': 'RandomForestRegressor',
            'performance_metrics': {
                'train_mae': float(train_mae),
                'test_mae': float(test_mae),
                'train_rmse': float(train_rmse),
                'test_rmse': float(test_rmse),
                'train_r2': float(train_r2),
                'test_r2': float(test_r2),
            },
            'feature_importance': feature_importance.head(10).to_dict('records')
        }
        
        return self.metadata
    
    def predict_optimal_hour(self, tenant_features):
        """
        Predict optimal notification send hour for a tenant
        
        Args:
            tenant_features: DataFrame with tenant features
        
        Returns:
            Predicted hour (0-23) and confidence score
        """
        if self.model is None:
            raise ValueError("Model not trained. Call train() first.")
        
        X = self.prepare_features(tenant_features, is_training=False)
        X_scaled = self.scaler.transform(X)
        
        # Predict
        predictions = self.model.predict(X_scaled)
        
        # Round to nearest hour and clip to valid range
        predicted_hours = np.clip(np.round(predictions), 0, 23).astype(int)
        
        # Calculate confidence using ensemble variance
        # Lower variance = higher confidence
        tree_predictions = np.array([tree.predict(X_scaled) for tree in self.model.estimators_])
        prediction_std = np.std(tree_predictions, axis=0)
        
        # Normalize to 0-1 confidence score (inverse of std)
        max_std = 6  # Max expected std for hour prediction
        confidence = np.clip(1 - (prediction_std / max_std), 0, 1)
        
        return predicted_hours, confidence
    
    def save_model(self, model_dir='ml/models'):
        """Save trained model and metadata. Keeps at most 2 .pkl files:
        latest_model.pkl (current) and previous_model.pkl (backup)."""
        import glob
        os.makedirs(model_dir, exist_ok=True)

        latest_path = os.path.join(model_dir, 'latest_model.pkl')
        previous_path = os.path.join(model_dir, 'previous_model.pkl')

        # Rotate: current latest → previous (overwrite old previous)
        if os.path.exists(latest_path):
            if os.path.exists(previous_path):
                os.remove(previous_path)
            os.rename(latest_path, previous_path)
            print("Previous model backed up to previous_model.pkl")

        # Save new latest
        model_data = {
            'model': self.model,
            'scaler': self.scaler,
            'label_encoders': self.label_encoders,
            'feature_columns': self.feature_columns,
            'metadata': self.metadata
        }
        joblib.dump(model_data, latest_path)
        print(f"Model saved to: {latest_path}")

        # Save metadata as JSON alongside
        metadata_path = os.path.join(model_dir, 'latest_metadata.json')
        with open(metadata_path, 'w') as f:
            json.dump(self.metadata, f, indent=2)

        # Clean up any old timestamped files
        for pattern in ['notification_timing_model_*.pkl', 'model_metadata_*.json']:
            for old_file in glob.glob(os.path.join(model_dir, pattern)):
                os.remove(old_file)

        return latest_path
    
    @classmethod
    def load_model(cls, model_path='ml/models/latest_model.pkl'):
        """Load a trained model"""
        instance = cls()
        
        saved_data = joblib.load(model_path)
        instance.model = saved_data['model']
        instance.scaler = saved_data['scaler']
        instance.label_encoders = saved_data['label_encoders']
        instance.feature_columns = saved_data['feature_columns']
        instance.metadata = saved_data['metadata']
        
        print(f"Model loaded from: {model_path}")
        print(f"  Trained at: {instance.metadata['trained_at']}")
        print(f"  Test MAE: {instance.metadata['performance_metrics']['test_mae']:.2f} hours")
        
        return instance


def analyze_notification_effectiveness(df):
    """
    Analyze which notification timings are most effective
    for different tenant profiles
    """
    print("\n" + "=" * 60)
    print("NOTIFICATION EFFECTIVENESS ANALYSIS")
    print("=" * 60)
    
    # Overall effectiveness by notification hour
    print("\n1. Effectiveness by Notification Hour:")
    effectiveness = df.groupby('notification_hour').agg({
        'notification_effective': 'mean',
        'hours_notification_to_payment': 'mean',
        'tenant_id': 'count'
    }).round(3)
    effectiveness.columns = ['Effectiveness Rate', 'Avg Hours to Payment', 'Count']
    print(effectiveness.sort_values('Effectiveness Rate', ascending=False))
    
    # By profile type
    print("\n2. Best Notification Hour by Profile Type:")
    profile_best = df.groupby(['profile_type', 'notification_hour']).agg({
        'notification_effective': 'mean'
    }).reset_index()
    
    best_by_profile = profile_best.loc[
        profile_best.groupby('profile_type')['notification_effective'].idxmax()
    ]
    print(best_by_profile.to_string(index=False))
    
    # Days before due analysis
    print("\n3. Effectiveness by Days Before Due:")
    days_effectiveness = df.groupby('days_before_due').agg({
        'notification_effective': 'mean',
        'hours_notification_to_payment': 'mean',
        'tenant_id': 'count'
    }).round(3)
    days_effectiveness.columns = ['Effectiveness Rate', 'Avg Hours to Payment', 'Count']
    print(days_effectiveness.sort_index())


def main():
    """Main training pipeline"""
    
    # Load synthetic data
    print("Loading synthetic dataset...")
    df = pd.read_csv('synthetic_notification_data.csv')
    print(f"Loaded {len(df)} records")
    
    # Analyze notification effectiveness
    analyze_notification_effectiveness(df)
    
    # Initialize and train model
    print("\n")
    model = NotificationTimingModel()
    metadata = model.train(df, target_col='payment_hour')
    
    # Save model
    model_path = model.save_model()
    
    # Test prediction on sample tenants
    print("\n" + "=" * 60)
    print("SAMPLE PREDICTIONS")
    print("=" * 60)
    
    # Get unique tenants and sample a few
    sample_tenants = df.groupby('tenant_id').first().sample(5).reset_index()
    
    predicted_hours, confidence = model.predict_optimal_hour(sample_tenants)
    
    print("\nOptimal notification hours for sample tenants:")
    for i, (idx, row) in enumerate(sample_tenants.iterrows()):
        print(f"\nTenant {row['tenant_id']} ({row['profile_type']}):")
        print(f"  Historical avg payment hour: {row['payment_hour_mean']:.1f}")
        print(f"  Predicted optimal notification hour: {predicted_hours[i]}")
        print(f"  Confidence: {confidence[i]:.2%}")
    
    print("\n" + "=" * 60)
    print("TRAINING COMPLETE!")
    print("=" * 60)
    print(f"\nModel ready for deployment.")
    print(f"Use this model to predict optimal notification times for tenants.")
    

if __name__ == '__main__':
    main()
