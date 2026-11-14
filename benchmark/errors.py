"""Planet vs false-positive classifier: clean feature ablation and error analysis.

Search features come from results_v2.jsonl; vetting features come from vetted_v2.jsonl with the
search fields that vet.py copies into every row removed, so the three feature sets are really
disjoint. Predictions are out-of-fold (every star is scored by models that never saw it).
"""
import csv
import json

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold
from sklearn.pipeline import make_pipeline

COPIED = {"period_d", "duration_hr", "depth_ppm", "depth_snr", "sde", "n_transits",
          "odd_even_diff_pct"}                      # search fields that vet.py repeats in each row
SKIP = {"target", "t0", "runtime_s", "rank", "peaks", "vet_error"}

res, vet, vet_err = {}, {}, set()
for l in open("benchmark/results_v2.jsonl"):
    r = json.loads(l)
    if "error" not in r:
        res[r["target"]] = r
for l in open("benchmark/vetted_v2.jsonl"):
    r = json.loads(l)
    if "vet_error" in r:
        vet_err.add(r["target"])
    else:
        vet[r["target"]] = r
labels = {"KIC " + s["kepid"]: s["label"] for s in json.load(open("benchmark/sample.json"))}


def nums(d, prefix, drop=()):
    return {prefix + k: float(v) for k, v in d.items()
            if k not in SKIP and k not in drop and isinstance(v, (int, float)) and not isinstance(v, bool)}


stars = sorted(t for t in labels if t in res and t in vet)
feats = [{**nums(res[t], "s_"), **nums(vet[t], "v_", COPIED)} for t in stars]
names = sorted({k for f in feats for k in f})
X = np.array([[f.get(n, np.nan) for n in names] for f in feats], float)
X[~np.isfinite(X)] = np.nan
y = np.array([labels[t] for t in stars])
groups = {"search only": [n for n in names if n.startswith("s_")],
          "vetting only": [n for n in names if n.startswith("v_")],
          "all": names}
print(f"{len(stars)} stars ({y.sum()} planets, {(1 - y).sum()} false positives); "
      f"{len(vet_err)} more could not be vetted")
print("features: " + ", ".join(f"{k} {len(v)}" for k, v in groups.items()))

rf = lambda: make_pipeline(SimpleImputer(strategy="median"),
                           RandomForestClassifier(300, min_samples_leaf=2, random_state=0))
gb = lambda: HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=150,
                                            min_samples_leaf=5, random_state=0)


def oof(model, cols, repeats=5):
    idx = [names.index(n) for n in cols]
    P, accs, aucs = np.zeros(len(y)), [], []
    for r in range(repeats):
        p = np.zeros(len(y))
        for tr, te in StratifiedKFold(5, shuffle=True, random_state=r).split(X, y):
            p[te] = model().fit(X[tr][:, idx], y[tr]).predict_proba(X[te][:, idx])[:, 1]
        P += p / repeats
        accs.append(((p > 0.5) == y).mean())
        aucs.append(roc_auc_score(y, p))
    return P, accs, aucs


print("\n5-fold CV x5 shuffles (web model baseline: 0.735)")
keep = {}
for gname, cols in groups.items():
    for mname, model in (("forest", rf), ("boosting", gb)):
        P, accs, aucs = oof(model, cols)
        keep[(gname, mname)] = P
        print(f"{gname:13s} {mname:9s} acc {np.mean(accs):.3f} (range {min(accs):.3f}-{max(accs):.3f})"
              f"   AUC {np.mean(aucs):.3f}", flush=True)

P = keep[("all", "forest")]
pred = (P > 0.5).astype(int)
tp, tn = int(((pred == 1) & (y == 1)).sum()), int(((pred == 0) & (y == 0)).sum())
fn, fp = int(((pred == 0) & (y == 1)).sum()), int(((pred == 1) & (y == 0)).sum())
print(f"\nall features / forest, averaged out-of-fold: accuracy {(tp + tn) / len(y):.3f}")
print(f"  planets caught {tp}/{tp + fn}   false positives caught {tn}/{tn + fp}")
n_rule = len(vet_err & {t for t in labels if labels[t] == 0})
print(f"  counting the {len(vet_err)} unvettable stars as false positives (a rule chosen after looking at them): "
      f"{(tp + tn + n_rule) / (len(y) + len(vet_err)):.3f} on {len(y) + len(vet_err)} stars")

snr = np.array([vet[t].get("vet_snr") if vet[t].get("vet_snr") is not None else np.nan for t in stars])
cuts = np.nanpercentile(snr, [33.3, 66.7])
print("\naccuracy by transit signal strength (vet_snr):")
for lo, hi, nm in ((-np.inf, cuts[0], "weakest third"), (cuts[0], cuts[1], "middle third"),
                   (cuts[1], np.inf, "strongest third")):
    m = (snr > lo) & (snr <= hi)
    print(f"  {nm:15s} n={m.sum():3d}  accuracy {(pred[m] == y[m]).mean():.3f}")

wrong = [i for i in range(len(stars)) if pred[i] != y[i]]
wrong.sort(key=lambda i: -abs(P[i] - 0.5))
print(f"\n{len(wrong)} misclassified (most confident mistakes first):")
print(f"  {'star':12s} {'truth':8s} {'P(planet)':>9s} {'period':>8s} {'depth_ppm':>9s} {'vet_snr':>8s} "
      f"{'sec_snr':>8s} {'unique':>7s} {'q_chi2':>7s}")
g = lambda t, k: (vet[t].get(k) if vet[t].get(k) is not None else float("nan"))
for i in wrong:
    t = stars[i]
    print(f"  {t:12s} {'planet' if y[i] else 'FP':8s} {P[i]:9.2f} {res[t]['period_d']:8.3f} "
          f"{res[t]['depth_ppm']:9.0f} {g(t, 'vet_snr'):8.1f} {g(t, 'secondary_snr'):8.1f} "
          f"{g(t, 'uniqueness'):7.1f} {g(t, 'quarter_chi2'):7.2f}")

with open("benchmark/predictions.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["target", "label", "p_planet", "predicted"])
    for i, t in enumerate(stars):
        w.writerow([t, int(y[i]), round(float(P[i]), 4), int(pred[i])])
print("\nwrote benchmark/predictions.csv")
