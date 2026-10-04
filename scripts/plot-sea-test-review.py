"""Plot frozen per-image distances; no threshold fitting or model updates."""

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

root = Path(__file__).resolve().parents[2] / "docs/lab2"
data = root / "data/geoscene-palette/sea-test-error-review"
output = root / "figures/geoscene-palette/sea-test-error-review"
rows = json.loads((data / "histogram-analysis.json").read_text())["rows"]
fig, ax = plt.subplots(figsize=(9, 5.8), constrained_layout=True)
ax.add_patch(
    Rectangle(
        (0.45, 0.935),
        0.5,
        0.015,
        facecolor="#daeadb",
        alpha=0.8,
        label="Eligible: both ratios ≤0.95",
    )
)
for correct, label, color, marker in [
    (False, "36 failed Sea images", "#ba5a36", "x"),
    (True, "14 correct Sea controls", "#2d6d96", "o"),
]:
    group = [row for row in rows if row["correct"] == correct]
    ax.scatter(
        [row["ownToForeignRatio"]["share"] for row in group],
        [row["ownToForeignRatio"]["bits"] for row in group],
        c=color,
        marker=marker,
        s=45,
        linewidths=1.5,
        label=label,
    )
for row in rows:
    if row["strictOwnClassEligible"]:
        offset = (-24, -17) if row["reviewId"] == 253 else (5, -17)
        ax.annotate(
            str(row["reviewId"]),
            (row["ownToForeignRatio"]["share"], row["ownToForeignRatio"]["bits"]),
            xytext=offset,
            textcoords="offset points",
            fontsize=9,
        )
ax.axvline(0.95, color="#555", ls="--", lw=1)
ax.axhline(0.95, color="#555", ls="--", lw=1)
ax.set(
    xlim=(0.45, 2.02),
    ylim=(0.935, 1.18),
    xlabel="H/N: distance to Sea / distance to nearest other class",
    ylabel="Linear max15 bits: distance to Sea / nearest other class",
    title="The training eligibility rule rejects all 36 Sea failures\nand 12 of 14 correct Sea controls",
)
ax.grid(alpha=0.16)
ax.legend(loc="upper left", fontsize=9)
fig.savefig(output / "sea-training-rule-coverage.png", dpi=160)
fig.savefig(output / "sea-training-rule-coverage.svg")
