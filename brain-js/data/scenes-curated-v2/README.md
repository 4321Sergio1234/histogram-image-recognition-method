# Curated scene dataset v2

Native originals, one per source-photo group. See protocol.md for criteria and limitations.

```json
{
  "train": {
    "sea": 765,
    "forest": 1407,
    "desert": 108
  },
  "validation": {
    "sea": 303,
    "forest": 473,
    "desert": 103
  },
  "test": {
    "sea": 350,
    "forest": 651,
    "desert": 85
  }
}
```

Folders: split / original extension / resolution / class. Select root or several training subfolders via the CLI. All admitted training images are used. Validation and test stay separate. No generated or upscaled images.

Sources and original paths are recorded in manifest.json. GeoScene aliases Intel/Landscape; deduplication prevents counting these aliases as independent data. Existing holdouts were inspected previously, so these are conditional, reused test results.
