"""Describe frozen before/after training distributions; diagnostic only."""

import json
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt

repo = Path(__file__).resolve().parents[1]
root = repo.parent / "docs/lab2"
data = root / "data/model-diagnostics"
audit = json.loads((repo / "brain-js/artifacts/audit.json").read_text())
indices = {row["path"]: row["featureIndex"] for row in audit["images"]}
hist = (
    np.fromfile(repo / "brain-js/artifacts/histograms.bin", dtype="<u4")
    .reshape(-1, 256)
    .astype(float)
)
sahara = np.array(
    json.loads((data / "histogram-centroids.json").read_text())["sahara"]["histogram"], dtype=float
)
labels = ["sea", "forest", "desert"]
colours = ["#286f9e", "#34864a", "#b46c2e"]
result = {
    "scope": "Frozen training data only. Before = retained production 3.0.0; after = rejected 3.1.0 candidate. Distances do not determine ANN decisions."
}
fig, axes = plt.subplots(2, 2, figsize=(12, 7), constrained_layout=True)
for column, (name, path, sqrt) in enumerate(
    [
        ("before", data / "baseline-3.0.0/splits.json", False),
        ("after", repo / "brain-js/artifacts/splits.json", True),
    ]
):
    split = json.loads(path.read_text())

    def quantize(h):
        ratio = h / h.max(axis=-1, keepdims=True)
        return np.floor(15 * (np.sqrt(ratio) if sqrt else ratio) + 0.5)

    def bits(q):
        return (
            ((q.astype(np.uint8)[..., None] >> np.array([3, 2, 1, 0])) & 1)
            .reshape(q.shape[:-1] + (1024,))
            .astype(float)
        )

    def distances(a, b):
        return {
            "euclidean": float(np.linalg.norm(a - b)),
            "cosineSimilarity": float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))),
            "l1": float(abs(a - b).sum()),
        }

    centroids = []
    for label, colour in zip(labels, colours):
        rows = [row for row in split["train"] if row["label"] == label]
        raw = hist[[indices[row["path"]] for row in rows]]
        share = raw / raw.sum(axis=1, keepdims=True)
        q = quantize(raw)
        encoded = bits(q)
        c = {"id": label, "count": len(rows)}
        for key, values in [("Raw", raw), ("Share", share), ("Quantized", q), ("Bits", encoded)]:
            c["mean" + key] = values.mean(axis=0).tolist()
            c["std" + key] = values.std(axis=0).tolist()
        centroids.append(c)
        for row, values in enumerate([share, q]):
            axes[row, column].plot(values.mean(axis=0), label=label.title(), color=colour)
    comparison = []
    for i, a in enumerate(centroids):
        for b in centroids[i + 1 :]:
            comparison.append(
                {
                    "pair": [a["id"], b["id"]],
                    **{
                        key: distances(np.array(a["mean" + key]), np.array(b["mean" + key]))
                        for key in ["Raw", "Share", "Quantized", "Bits"]
                    },
                }
            )
    features = {
        "Raw": sahara,
        "Share": sahara / sahara.sum(),
        "Quantized": quantize(sahara),
        "Bits": bits(quantize(sahara)),
    }
    result[name] = {
        "normalization": "sqrt-max15" if sqrt else "max15",
        "centroids": centroids,
        "distances": comparison,
        "sahara": {
            "features": {key: value.tolist() for key, value in features.items()},
            "distances": [
                {
                    "id": c["id"],
                    **{
                        key: distances(value, np.array(c["mean" + key]))
                        for key, value in features.items()
                    },
                }
                for c in centroids
            ],
        },
    }
    axes[0, column].set_title(
        ("Retained 3.0.0" if not sqrt else "Rejected 3.1.0") + " training histograms"
    )
    axes[1, column].set_title("Square-root max-bin Q" if sqrt else "Linear max-bin Q")
for ax in axes.flat:
    ax.legend()
    ax.grid(alpha=0.2)
    ax.set_xlim(0, 255)
    ax.set_xlabel("Luminance bin")
axes[0, 0].set_ylabel("Mean H / N")
axes[1, 0].set_ylabel("Mean Q (0–15)")
fig.savefig(root / "figures/model-diagnostics/before-after-histograms.svg")
fig.savefig(root / "figures/model-diagnostics/before-after-histograms.png", dpi=130)
(data / "before-after-centroids.json").write_text(json.dumps(result, indent=2))
for name in ["before", "after"]:
    print(name, json.dumps(result[name]["distances"][1]))
