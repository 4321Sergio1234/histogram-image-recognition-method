"""Restore missing frozen sanity inputs from recorded URLs; never search or alter eligibility.

The source search and visual eligibility audit are preserved in sources.json.
A changed remote file fails its SHA check instead of silently changing the sanity set.
"""

import hashlib
import json
import urllib.request
from pathlib import Path

root = Path(__file__).resolve().parents[2] / "docs/lab2/data/model-diagnostics/external-sanity"
manifest = json.loads((root / "frozen-set.json").read_text())
images = manifest["images"]
for item in images:
    target = root / item["file"]
    if target.exists():
        data = target.read_bytes()
    else:
        url = item.get("downloadUrl")
        if not url:
            raise FileNotFoundError(f"Restore the user-supplied local file manually: {target}")
        request = urllib.request.Request(url, headers={"User-Agent": "HorizonAcademicAudit/1.0"})
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read()
    if hashlib.sha256(data).hexdigest() != item["sha256"]:
        raise ValueError(f"Frozen sanity input hash mismatch: {item['file']}")
    if not target.exists():
        target.write_bytes(data)
print(f"Verified {len(images)} frozen files; no new examples or model inference.")
