# Versioned IDOL NiFi NAR registry

Each subdirectory is one compatibility profile. Never put two minor versions in the same folder.

```
nars/
  compatibility-matrix.json
  26.2/manifest.json   + optional *.nar
  26.3/manifest.json   + optional *.nar
```

Add a NAR package:

1. Confirm the filename matches the manifest exactly.
2. Copy it into the matching version directory.
3. Re-run `resolve_idol_nars`. The registry hashes the file and marks it `present`.

Register a new version: see `docs/NAR-COMPATIBILITY.md`.
