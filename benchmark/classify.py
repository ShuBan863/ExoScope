import json
import numpy as np
from sklearn.ensemble import RandomForestClassifier, HistGradientBoostingClassifier
from sklearn.impute import SimpleImputer
from sklearn.model_selection import RepeatedStratifiedKFold, cross_validate
from sklearn.pipeline import make_pipeline

res = {}
for l in open("benchmark/results_v2.jsonl"):
    r = json.loads(l)
    if "error" not in r:
        res[r["target"]] = r
vet = {}
for l in open("benchmark/vetted_v2.jsonl"):
    r = json.loads(l)
    if "vet_error" not in r:
        vet[r["target"]] = r
labels = {"KIC " + s["kepid"]: s["label"] for s in json.load(open("benchmark/sample.json"))}

skip = {"target", "t0", "runtime_s", "rank", "peaks", "vet_error"}
def nums(d, prefix):
    return {prefix + k: float(v) for k, v in d.items()
            if k not in skip and isinstance(v, (int, float)) and not isinstance(v, bool)}

stars = [t for t in labels if t in res and t in vet]
print(f"{len(stars)} stars with search + vetting + label "
      f"({sum(labels[t] for t in stars)} planets, {sum(1 - labels[t] for t in stars)} false positives)")
assert len(stars) > 40, "too few stars matched; check that target names agree between files"

feats = [{**nums(res[t], "s_"), **nums(vet[t], "v_")} for t in stars]
names = sorted({k for f in feats for k in f})
X = np.array([[f.get(n, np.nan) for n in names] for f in feats], float)
X[~np.isfinite(X)] = np.nan
y = np.array([labels[t] for t in stars])

def run(title, cols, model):
    idx = [names.index(n) for n in cols]
    cv = RepeatedStratifiedKFold(n_splits=5, n_repeats=5, random_state=0)
    r = cross_validate(model, X[:, idx], y, cv=cv, scoring=("accuracy", "roc_auc"))
    print(f"{title:34s} acc {r['test_accuracy'].mean():.3f} +/- {r['test_accuracy'].std():.3f}   "
          f"AUC {r['test_roc_auc'].mean():.3f}")

rf = lambda: make_pipeline(SimpleImputer(strategy="median"),
                           RandomForestClassifier(300, min_samples_leaf=2, random_state=0))
gb = lambda: HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=150,
                                            min_samples_leaf=5, random_state=0)
s_cols = [n for n in names if n.startswith("s_")]
v_cols = [n for n in names if n.startswith("v_")]
print("\n5-fold CV, repeated 5 times (web model baseline: 0.735)")
for title, cols in (("search features only", s_cols), ("vetting features only", v_cols),
                    ("all features", names)):
    run(title + " / forest", cols, rf())
    run(title + " / boosting", cols, gb())

m = rf().fit(X, y)
imp = m[-1].feature_importances_
print("\ntop features (forest, fit on all stars):")
for i in np.argsort(imp)[::-1][:10]:
    print(f"  {names[i]:24s} {imp[i]:.3f}")
