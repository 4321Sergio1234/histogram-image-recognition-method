"""Static diagnostic plots; never modifies training features or model selection."""

import json
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parents[2] / "docs/lab2"
data = root / "data/model-diagnostics"
figures = root / "figures/model-diagnostics"
centroids = json.loads((data / "histogram-centroids.json").read_text())
rows = json.loads((data / "image-statistics.json").read_text())
histograms = {
    x["path"]: x["histogram"] for x in json.loads((data / "histogram-cache.json").read_text())
}
colours = {"sea": "#286f9e", "forest": "#34864a", "desert": "#b46c2e"}
fig, axes = plt.subplots(3, 1, figsize=(11, 10), constrained_layout=True)
for item in centroids["centroids"]:
    selected = [
        x
        for x in rows
        if x["split"] == "train"
        and x["label"] == item["id"]
        and (x["source"] == "intel" if item["id"] != "desert" else x["source"] == "landscape")
    ]
    raw = np.array([histograms[x["path"]] for x in selected], dtype=float)
    share = raw / raw.sum(axis=1, keepdims=True)
    q = np.floor((raw / raw.max(axis=1, keepdims=True)) * 15 + 0.5)
    item["stdRaw"] = raw.std(axis=0).tolist()
    item["stdQuantized"] = q.std(axis=0).tolist()
    for ax, values, title in zip(
        axes,
        [raw, share, q],
        [
            "Mean raw counts (native resolution; source sizes differ)",
            "Mean histogram share with ±1 SD across images",
            "Mean quantized histogram with ±1 SD across images",
        ],
    ):
        mean = values.mean(axis=0)
        sd = values.std(axis=0)
        ax.plot(
            mean, color=colours[item["id"]], label=f"{item['id'].title()} (n={len(raw)})", lw=1.7
        )
        if ax is not axes[0]:
            ax.fill_between(
                np.arange(256),
                np.maximum(0, mean - sd),
                mean + sd,
                color=colours[item["id"]],
                alpha=0.10,
            )
        ax.set_title(title, loc="left")
        ax.set_xlim(0, 255)
        ax.grid(alpha=0.2)
        ax.legend(loc="upper left", ncol=3)
axes[0].set_ylabel("Pixels / bin")
axes[1].set_ylabel("Share / bin")
axes[2].set_ylabel("Q (0–15)")
axes[2].set_ylim(0, 15)
axes[2].set_xlabel("Y′ luminance bin")
fig.suptitle("Frozen 3.0.0 training distributions — overlap is substantial", fontsize=15)
fig.savefig(figures / "desert-sea-forest-average-histograms.svg")
fig.savefig(figures / "desert-sea-forest-average-histograms.png", dpi=130)
plt.close(fig)
fig, axes = plt.subplots(3, 1, figsize=(11, 10), constrained_layout=True)
sahara = centroids["sahara"]
sh = np.array(sahara["histogram"], dtype=float)
sh /= sh.sum()
for item in centroids["centroids"]:
    for ax, values in zip(axes, [item["meanShare"], item["meanQuantized"], item["bitCentroid"]]):
        ax.plot(values, color=colours[item["id"]], label=item["id"].title(), lw=1.2, alpha=0.8)
for ax, values, title in zip(
    axes,
    [sh, sahara["quantized"], sahara["features"]],
    [
        "Normalized brightness histogram H / N",
        "Quantized histogram Q (0–15)",
        "Required 1,024 bits versus class mean bit values",
    ],
):
    ax.plot(
        values,
        color="#292323",
        label="Sahara example",
        lw=1.4 if ax is not axes[2] else 0.5,
        alpha=0.9,
    )
    ax.set_title(title, loc="left")
    ax.grid(alpha=0.2)
    ax.legend(ncol=4, loc="upper left")
axes[2].set_xlabel("Feature index (bit order MSB first)")
fig.suptitle("Sahara diagnosis — no colour or spatial information reaches the ANN", fontsize=15)
fig.savefig(figures / "sahara-feature-comparison.svg")
fig.savefig(figures / "sahara-feature-comparison.png", dpi=130)
(data / "histogram-centroids.json").write_text(json.dumps(centroids, indent=2))
print("Four standalone plots written; raw/Q per-bin SD added.")
