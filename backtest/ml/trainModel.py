"""
═══ BTC 15-min ML Training Pipeline ═══

Uses XGBoost (gradient boosting) — best algorithm for tabular data.
Exports model to JSON format for browser inference.

Prerequisites:
    pip install scikit-learn xgboost numpy

Usage:
    python backtest/ml/trainModel.py backtest/ml/data/features_TIMESTAMP.json

Output:
    backtest/ml/models/xgboost_model.json     (model weights for browser)
    backtest/ml/models/normalization.json       (feature normalization)
    backtest/ml/models/training_report.json     (metrics & analysis)
"""

import json
import sys
import os
import time
import numpy as np
from datetime import datetime

# ═══ Install check ═══
try:
    import xgboost as xgb
    from sklearn.metrics import (
        accuracy_score, precision_score, recall_score, f1_score,
        confusion_matrix, classification_report, roc_auc_score
    )
    from sklearn.model_selection import cross_val_score
    from sklearn.preprocessing import StandardScaler
except ImportError as e:
    print(f"❌ Missing package: {e}")
    print("   Run: pip install scikit-learn xgboost numpy")
    sys.exit(1)


FEATURE_NAMES = [
    'ptb_distance_pct', 'rsi', 'rsi_slope', 'macd_histogram', 'macd_line',
    'vwap_distance_pct', 'vwap_slope', 'ha_consecutive', 'delta_1m_pct',
    'delta_3m_pct', 'volume_ratio', 'minutes_left', 'rule_prob_up',
    'rule_confidence', 'vwap_cross_count', 'edge_best',
    'regime_trending', 'regime_choppy', 'regime_mean_rev', 'regime_moderate',
    'session_asia', 'session_europe', 'session_us', 'session_overlap', 'session_off',
    'ha_color_green', 'multi_tf_agree', 'failed_vwap',
]


def load_dataset(filepath):
    """Load feature dataset from JSON."""
    print(f"📂 Loading: {filepath}")
    with open(filepath, 'r') as f:
        data = json.load(f)

    X_train = np.array(data['trainFeatures'], dtype=np.float64)
    y_train = np.array(data['trainLabels'], dtype=np.float64)
    X_test = np.array(data['testFeatures'], dtype=np.float64)
    y_test = np.array(data['testLabels'], dtype=np.float64)

    print(f"   Train: {X_train.shape[0]} samples, {X_train.shape[1]} features")
    print(f"   Test:  {X_test.shape[0]} samples")
    print(f"   Class balance (train): UP={y_train.sum():.0f} ({y_train.mean()*100:.1f}%), "
          f"DOWN={len(y_train)-y_train.sum():.0f} ({(1-y_train.mean())*100:.1f}%)")

    return X_train, y_train, X_test, y_test, data


def normalize_data(X_train, X_test):
    """Z-score normalization using training statistics."""
    scaler = StandardScaler()
    X_train_norm = scaler.fit_transform(X_train)
    X_test_norm = scaler.transform(X_test)
    return X_train_norm, X_test_norm, scaler


def train_xgboost(X_train, y_train, X_test, y_test):
    """Train XGBoost with optimized hyperparameters."""
    print("\n🚀 Training XGBoost...")

    # Class weight
    n_pos = y_train.sum()
    n_neg = len(y_train) - n_pos
    scale_pos_weight = n_neg / n_pos if n_pos > 0 else 1.0

    model = xgb.XGBClassifier(
        n_estimators=500,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        gamma=0.1,
        reg_alpha=0.1,       # L1 regularization
        reg_lambda=1.0,      # L2 regularization
        scale_pos_weight=scale_pos_weight,
        eval_metric='logloss',
        early_stopping_rounds=30,
        random_state=42,
        n_jobs=-1,
        tree_method='hist',  # Fast histogram method
    )

    # Train with early stopping
    start = time.time()
    model.fit(
        X_train, y_train,
        eval_set=[(X_train, y_train), (X_test, y_test)],
        verbose=50,  # Print every 50 rounds
    )
    elapsed = time.time() - start

    print(f"\n⏱️  Training time: {elapsed:.1f}s")
    print(f"   Best iteration: {model.best_iteration}")
    print(f"   Best score: {model.best_score:.4f}")

    return model


def evaluate_model(model, X_test, y_test):
    """Comprehensive evaluation of the trained model."""
    # Predictions
    y_pred = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    # Core metrics
    acc = accuracy_score(y_test, y_pred)
    precision = precision_score(y_test, y_pred, zero_division=0)
    recall = recall_score(y_test, y_pred, zero_division=0)
    f1 = f1_score(y_test, y_pred, zero_division=0)
    auc = roc_auc_score(y_test, y_proba)
    cm = confusion_matrix(y_test, y_pred)

    print("\n╔══════════════════════════════════════╗")
    print("║        TEST SET EVALUATION           ║")
    print("╠══════════════════════════════════════╣")
    print(f"║  Accuracy:  {acc*100:.2f}%")
    print(f"║  Precision: {precision*100:.2f}%")
    print(f"║  Recall:    {recall*100:.2f}%")
    print(f"║  F1 Score:  {f1*100:.2f}%")
    print(f"║  AUC-ROC:   {auc:.4f}")
    print("╠══════════════════════════════════════╣")
    print("║  Confusion Matrix:")
    print(f"║    Pred UP   → TP: {cm[1][1]}, FP: {cm[0][1]}")
    print(f"║    Pred DOWN → TN: {cm[0][0]}, FN: {cm[1][0]}")
    print("╚══════════════════════════════════════╝")

    # Confidence-bucketed accuracy
    print("\n📊 ACCURACY BY ML CONFIDENCE:")
    buckets = [
        ('50-55%', 0.50, 0.55),
        ('55-60%', 0.55, 0.60),
        ('60-65%', 0.60, 0.65),
        ('65-70%', 0.65, 0.70),
        ('70-80%', 0.70, 0.80),
        ('80-90%', 0.80, 0.90),
        ('90%+  ', 0.90, 1.01),
    ]

    calibration_data = []
    for label, lo, hi in buckets:
        prob_max = np.maximum(y_proba, 1 - y_proba)
        mask = (prob_max >= lo) & (prob_max < hi)
        total = mask.sum()
        if total > 0:
            correct = (y_pred[mask] == y_test[mask]).sum()
            pct = correct / total * 100
            bar = '█' * round(pct / 5)
            print(f"   {label}: {correct:>5}/{total:>5} = {pct:>5.1f}% {bar}")
            calibration_data.append({'range': label, 'total': int(total), 'correct': int(correct), 'accuracy': pct})

    # Simulated trading
    print("\n🎯 SIMULATED TRADING (only trade when ML confident):")
    trading_results = []
    for threshold in [0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90]:
        prob_max = np.maximum(y_proba, 1 - y_proba)
        mask = prob_max >= threshold
        total = mask.sum()
        if total > 0:
            correct = (y_pred[mask] == y_test[mask]).sum()
            pct = correct / total * 100
            coverage = total / len(y_test) * 100
            print(f"   Threshold {threshold*100:.0f}%: {correct}/{total} = {pct:.1f}% "
                  f"({coverage:.0f}% of opportunities)")
            trading_results.append({
                'threshold': threshold,
                'trades': int(total),
                'wins': int(correct),
                'accuracy': pct,
                'coverage': coverage,
            })

    # Feature importance
    print("\n📊 TOP 10 FEATURE IMPORTANCE:")
    importance = model.feature_importances_
    indices = np.argsort(importance)[::-1]
    feature_importance = []
    for rank, idx in enumerate(indices[:10]):
        print(f"   {rank+1:>2}. {FEATURE_NAMES[idx]:.<25} {importance[idx]:.4f}")
        feature_importance.append({'name': FEATURE_NAMES[idx], 'importance': float(importance[idx])})

    return {
        'accuracy': float(acc),
        'precision': float(precision),
        'recall': float(recall),
        'f1': float(f1),
        'auc_roc': float(auc),
        'confusion_matrix': cm.tolist(),
        'calibration': calibration_data,
        'trading_simulation': trading_results,
        'feature_importance': feature_importance,
    }


def export_xgboost_to_json(model, output_path):
    """
    Export XGBoost model to JSON for browser inference.
    Exports the raw tree structure that can be evaluated in pure JS.
    """
    # Get the booster and dump trees as JSON
    booster = model.get_booster()
    trees_json = booster.get_dump(dump_format='json')

    # Parse each tree
    trees = [json.loads(t) for t in trees_json]

    # Export config
    model_export = {
        'type': 'xgboost',
        'version': 1,
        'num_trees': len(trees),
        'num_features': model.n_features_in_,
        'base_score': float(model.get_params().get('base_score') or 0.5),
        'learning_rate': float(model.get_params()['learning_rate']),
        'trees': trees,
        'feature_names': FEATURE_NAMES,
        'exported_at': datetime.now().isoformat(),
    }

    with open(output_path, 'w') as f:
        json.dump(model_export, f)

    size_mb = os.path.getsize(output_path) / 1024 / 1024
    print(f"\n💾 Model exported: {output_path} ({size_mb:.1f} MB)")
    return model_export


def main():
    if len(sys.argv) < 2:
        print("Usage: python backtest/ml/trainModel.py <features-file.json>")
        sys.exit(1)

    features_file = sys.argv[1]
    print("\n═══ BTC 15-min ML Training (XGBoost) ═══\n")

    # Load
    X_train, y_train, X_test, y_test, raw_data = load_dataset(features_file)

    # Normalize
    print("\n📐 Normalizing features...")
    X_train_norm, X_test_norm, scaler = normalize_data(X_train, X_test)

    # Train
    model = train_xgboost(X_train_norm, y_train, X_test_norm, y_test)

    # Evaluate
    metrics = evaluate_model(model, X_test_norm, y_test)

    # Cross-validation on train set (without early stopping)
    print("\n🔄 5-Fold Cross-Validation on training set...")
    cv_model = xgb.XGBClassifier(
        n_estimators=model.best_iteration + 1 if hasattr(model, 'best_iteration') else 300,
        max_depth=6, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8,
        min_child_weight=5, gamma=0.1, reg_alpha=0.1, reg_lambda=1.0,
        random_state=42, n_jobs=-1, tree_method='hist',
    )
    cv_scores = cross_val_score(cv_model, X_train_norm, y_train, cv=5, scoring='accuracy', n_jobs=-1)
    print(f"   CV Accuracy: {cv_scores.mean()*100:.2f}% ± {cv_scores.std()*100:.2f}%")

    # Save model
    models_dir = os.path.join(os.path.dirname(__file__), 'models')
    os.makedirs(models_dir, exist_ok=True)

    # Export XGBoost to JSON (for browser)
    model_path = os.path.join(models_dir, 'xgboost_model.json')
    export_xgboost_to_json(model, model_path)

    # Save normalization
    norm_path = os.path.join(models_dir, 'normalization.json')
    norm_data = {
        'means': scaler.mean_.tolist(),
        'stds': scaler.scale_.tolist(),
        'feature_names': FEATURE_NAMES,
    }
    with open(norm_path, 'w') as f:
        json.dump(norm_data, f, indent=2)
    print(f"💾 Normalization saved: {norm_path}")

    # Save browser-friendly normalization
    norm_browser_path = os.path.join(models_dir, 'norm_browser.json')
    with open(norm_browser_path, 'w') as f:
        json.dump({'means': norm_data['means'], 'stds': norm_data['stds']}, f)
    print(f"💾 Browser normalization saved: {norm_browser_path}")

    # Save training report
    report_path = os.path.join(models_dir, 'training_report.json')
    report = {
        'metrics': metrics,
        'cv_accuracy_mean': float(cv_scores.mean()),
        'cv_accuracy_std': float(cv_scores.std()),
        'train_samples': int(len(y_train)),
        'test_samples': int(len(y_test)),
        'num_features': int(X_train.shape[1]),
        'num_trees': int(model.best_iteration + 1),
        'hyperparameters': model.get_params(),
        'trained_at': datetime.now().isoformat(),
    }
    # Convert numpy types for JSON serialization
    def convert(obj):
        if isinstance(obj, (np.integer,)): return int(obj)
        if isinstance(obj, (np.floating,)): return float(obj)
        if isinstance(obj, np.ndarray): return obj.tolist()
        return obj

    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2, default=convert)
    print(f"💾 Training report saved: {report_path}")

    print("\n" + "="*50)
    print(f"✅ TRAINING COMPLETE!")
    print(f"   Test Accuracy: {metrics['accuracy']*100:.2f}%")
    print(f"   AUC-ROC: {metrics['auc_roc']:.4f}")
    print(f"   CV Accuracy: {cv_scores.mean()*100:.2f}% ± {cv_scores.std()*100:.2f}%")
    print(f"\n🚀 Next steps:")
    print(f"   1. Copy models/ to frontend/public/ml/")
    print(f"   2. Model will auto-load in browser")
    print("="*50)


if __name__ == '__main__':
    main()