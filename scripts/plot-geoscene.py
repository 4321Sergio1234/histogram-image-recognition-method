"""Scientific figures from frozen training-only diagnostics; never changes selection."""

import json
from pathlib import Path

import matplotlib
import numpy as np

matplotlib.use("Agg")
import matplotlib.pyplot as plt

root = Path(__file__).resolve().parents[2] / "docs/lab2"
data = root / "data/geoscene-palette"
out = root / "figures/geoscene-palette"
out.mkdir(exist_ok=True)
x = json.loads((data / "feature-separability.json").read_text())
colours = {"sea": "#2477ab", "forest": "#237c43", "desert": "#c58024"}
fig, axes = plt.subplots(2, 3, figsize=(15, 8), constrained_layout=True)
for col, (key, title) in enumerate(
    [
        ("unfilteredTrain", "Unfiltered training groups"),
        ("manualPaletteTrain", "Manual palette selection"),
        ("filteredBalancedTrain", "Histogram filter + balance"),
    ]
):
    for item in x["stages"][key]["perClass"]:
        for row, mean, sd in [
            (0, item["centroid"], item["stdShare"]),
            (1, item["meanQuantized"], item["stdQuantized"]),
        ]:
            axes[row, col].plot(
                mean, color=colours[item["id"]], label=f"{item['id'].title()} n={item['count']}"
            )
            if row == 0:
                mean = np.array(mean)
                sd = np.array(sd)
                axes[row, col].fill_between(
                    np.arange(256),
                    np.maximum(0, mean - sd),
                    mean + sd,
                    color=colours[item["id"]],
                    alpha=0.06,
                )
    for ax in axes[:, col]:
        ax.set_xlim(0, 255)
        ax.grid(alpha=0.2)
        ax.legend(fontsize=9)
        ax.set_xlabel("Luminance bin")
    axes[0, col].set_title(title)
axes[0, 0].set_ylabel("Mean H/N (shading ±1 SD)")
axes[1, 0].set_ylabel("Mean linear max15 Q")
fig.suptitle("GeoSceneNet16K — training curation changes the intended domain", fontsize=16)
fig.savefig(out / "training-histograms.svg")
fig.savefig(out / "training-histograms.png", dpi=120)
print("Saved training histograms (SVG/PNG).")
