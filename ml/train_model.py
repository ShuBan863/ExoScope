"""
ExoScope ML Training Pipeline v3.0

Key change from v2: derived features (duty_cycle, depth_per_hr) are computed
using the same duration-fraction method as the browser BLS, not the raw NASA
koi_duration value. This closes the train/inference gap that caused wrong predictions.

duty_cycle = koi_duration / (koi_period * 24)   ← same as durationFrac in BLS
depth_per_hr = koi_depth / koi_duration           ← same formula as JS
"""

import os, json, requests
import numpy as np
import pandas as pd
from io import StringIO

from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score, roc_auc_score, confusion_matrix
from sklearn.pipeline import Pipeline
from sklearn.impute import SimpleImputer

import skl2onnx
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType

import warnings
warnings.filterwarnings("ignore")

OUTPUT_ONNX     = "exoscope_model.onnx"
OUTPUT_FEATURES = "feature_config.json"
OUTPUT_REPORT   = "training_report.txt"

KOI_URL = (
    "https://exoplanetarchive.ipac.caltech.edu/cgi-bin/nstedAPI/nph-nstedAPI"
    "?table=cumulative&select=*&format=csv"
)

# These match exactly what exoplanetFeatures.ts computes and sends
FEATURE_SPEC = [
    ("koi_period",   "period_days",         "Orbital period (days)"),
    ("koi_depth",    "transit_depth_ppm",   "Transit depth (ppm)"),
    ("koi_duration", "transit_duration_hr", "Transit duration (hours)"),
    ("koi_steff",    "stellar_teff_k",      "Stellar effective temperature (K)"),
    ("koi_slogg",    "stellar_logg",        "Stellar surface gravity (log g)"),
    ("koi_srad",     "stellar_radius_rsun", "Stellar radius (solar radii)"),
]

KOI_COLS  = [s[0] for s in FEATURE_SPEC]
JS_NAMES  = [s[1] for s in FEATURE_SPEC]
FEAT_DESC = [s[2] for s in FEATURE_SPEC]
LABEL_MAP = {"CONFIRMED": 1, "FALSE POSITIVE": 0}


def download_koi_table():
    cache = "koi_cumulative.csv"
    if os.path.exists(cache):
        print("[✓] Using cached KOI table")
        df = pd.read_csv(cache, comment="#", low_memory=False)
    else:
        print("[↓] Downloading KOI table from NASA …")
        r = requests.get(KOI_URL, timeout=120)
        r.raise_for_status()
        lines = [l for l in r.text.splitlines() if not l.startswith("#")]
        df = pd.read_csv(StringIO("\n".join(lines)), low_memory=False)
        df.to_csv(cache, index=False)
        print(f"[✓] Saved")
    print(f"    Rows: {len(df):,}  Cols: {df.shape[1]}")
    return df


def build_features(df):
    df = df[df["koi_disposition"].isin(LABEL_MAP)].copy()
    df["label"] = df["koi_disposition"].map(LABEL_MAP)

    missing = [c for c in KOI_COLS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns: {missing}")

    X = df[KOI_COLS].copy().astype(np.float32)
    period   = X["koi_period"].values
    depth    = X["koi_depth"].values
    duration = X["koi_duration"].values  # NASA measured hours

    # Derived features — MUST match exoplanetFeatures.ts exactly
    # duty_cycle = duration_hr / (period_days * 24)  — same as durationFrac in BLS
    X["depth_per_hr"] = np.where(duration > 0, depth / duration, 0).astype(np.float32)
    X["duty_cycle"]   = np.minimum(np.where(period > 0, duration / (period * 24), 0), 0.12).astype(np.float32)
    X["log_depth"]    = np.log10(np.clip(depth,  1,   None)).astype(np.float32)
    X["log_period"]   = np.log10(np.clip(period, 0.1, None)).astype(np.float32)

    all_js   = JS_NAMES  + ["depth_per_hr", "duty_cycle", "log_depth", "log_period"]
    all_koi  = KOI_COLS  + ["depth_per_hr", "duty_cycle", "log_depth", "log_period"]
    all_desc = FEAT_DESC + [
        "Transit depth per hour (ppm/hr)",
        "Transit duty cycle (duration/period)",
        "Log10 transit depth",
        "Log10 orbital period",
    ]

    y    = df["label"].values
    Xmat = X[all_koi].values.astype(np.float32)

    n, np_ = len(y), int(y.sum())
    print(f"\n[Dataset]  total={n:,}  planets={np_:,}  FP={n-np_:,}")
    print(f"  duty_cycle  — planets: {Xmat[y==1, all_koi.index('duty_cycle')].mean():.4f}  FP: {Xmat[y==0, all_koi.index('duty_cycle')].mean():.4f}")
    print(f"  depth_ppm   — planets: {depth[y==1].mean():.0f}  FP: {depth[y==0].mean():.0f}")
    return Xmat, y, all_js, all_koi, all_desc, {"n_total": n, "n_planets": np_, "n_fp": n - np_}


def build_pipeline():
    return Pipeline([
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler",  StandardScaler()),
        ("clf", GradientBoostingClassifier(
            n_estimators      = 400,
            max_depth         = 5,
            learning_rate     = 0.05,
            subsample         = 0.8,
            min_samples_leaf  = 4,
            random_state      = 42,
        )),
    ])


def train_and_evaluate(X, y, js_names, all_koi):
    X_tr, X_te, y_tr, y_te = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y)

    print("\n[CV] 5-fold cross-validation …")
    skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    cv  = cross_val_score(build_pipeline(), X_tr, y_tr,
                          cv=skf, scoring="roc_auc", n_jobs=1)
    print(f"  ROC-AUC folds : {[f'{s:.4f}' for s in cv]}")
    print(f"  Mean ± Std    : {cv.mean():.4f} ± {cv.std():.4f}")

    pipe = build_pipeline()
    pipe.fit(X_tr, y_tr)

    y_pred = pipe.predict(X_te)
    y_prob = pipe.predict_proba(X_te)[:, 1]
    acc    = accuracy_score(y_te, y_pred)
    auc    = roc_auc_score(y_te, y_prob)
    cm     = confusion_matrix(y_te, y_pred)

    print(f"\n[Eval]  Accuracy={acc:.4f}  ROC-AUC={auc:.4f}")
    print(f"  Confusion matrix: TN={cm[0,0]} FP={cm[0,1]} FN={cm[1,0]} TP={cm[1,1]}")

    # Threshold calibration — find threshold for 85% recall on planets
    from sklearn.metrics import precision_recall_curve
    prec, rec, thresholds = precision_recall_curve(y_te, y_prob)
    # Find threshold where recall >= 0.85
    good = thresholds[rec[:-1] >= 0.85]
    best_thresh = float(good.max()) if len(good) > 0 else 0.5
    print(f"\n[Threshold] For 85% planet recall: {best_thresh:.3f}")

    imps = pipe.named_steps["clf"].feature_importances_
    print("\n[Feature importances]")
    for name, imp in sorted(zip(js_names, imps), key=lambda x: x[1], reverse=True):
        print(f"  {name:<30} {imp:.4f}  {'█'*int(imp*60)}")

    return pipe, best_thresh, {
        "accuracy":    float(acc),
        "roc_auc":     float(auc),
        "cv_mean_auc": float(cv.mean()),
        "cv_std_auc":  float(cv.std()),
        "best_threshold": best_thresh,
        "confusion_matrix": cm.tolist(),
        "feature_importances": {n: float(i) for n, i in zip(js_names, imps)},
    }


def main():
    print("=" * 60)
    print("  ExoScope ML Training Pipeline v3.0")
    print("=" * 60)

    df = download_koi_table()
    X, y, js_names, koi_cols, feat_descs, stats = build_features(df)
    n_features = X.shape[1]
    print(f"  Features: {n_features}  →  {js_names}")

    pipe, best_thresh, report = train_and_evaluate(X, y, js_names, koi_cols)

    print("\n[Refitting on full dataset for ONNX export …]")
    full_pipe = build_pipeline()
    full_pipe.fit(X, y)

    initial_type = [("float_input", FloatTensorType([None, n_features]))]
    onnx_model = convert_sklearn(full_pipe, initial_types=initial_type, target_opset=17, options={'zipmap': False})
    with open(OUTPUT_ONNX, "wb") as f:
        f.write(onnx_model.SerializeToString())
    kb = os.path.getsize(OUTPUT_ONNX) / 1024
    print(f"[✓] ONNX model saved → {OUTPUT_ONNX}  ({kb:.1f} KB)")

    config = {
        "model_version": "3.0.0",
        "n_features":    n_features,
        "threshold":     best_thresh,
        "features": [
            {"index": i, "js_name": js_names[i],
             "koi_column": koi_cols[i], "description": feat_descs[i]}
            for i in range(n_features)
        ],
        "labels":         {"0": "False Positive", "1": "Confirmed Planet"},
        "training_stats": {**stats, **report},
    }
    with open(OUTPUT_FEATURES, "w") as f:
        json.dump(config, f, indent=2)
    print(f"[✓] Feature config saved → {OUTPUT_FEATURES}")

    with open(OUTPUT_REPORT, "w") as f:
        f.write("ExoScope Model Training Report v3.0\n")
        f.write("=" * 36 + "\n\n")
        f.write(f"Accuracy  : {report['accuracy']:.4f}\n")
        f.write(f"ROC-AUC   : {report['roc_auc']:.4f}\n")
        f.write(f"CV AUC    : {report['cv_mean_auc']:.4f} ± {report['cv_std_auc']:.4f}\n")
        f.write(f"Threshold : {best_thresh:.3f}\n\n")
        f.write("Feature importances:\n")
        for name, imp in sorted(report["feature_importances"].items(),
                                key=lambda x: x[1], reverse=True):
            f.write(f"  {name:<30} {imp:.4f}\n")
    print(f"[✓] Report saved → {OUTPUT_REPORT}")

    print("\n" + "=" * 60)
    print("  DONE! Copy to public/model/:")
    print(f"    {OUTPUT_ONNX}")
    print(f"    {OUTPUT_FEATURES}")
    print("=" * 60)


if __name__ == "__main__":
    main()
