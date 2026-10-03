# IDOL / NiFi NAR compatibility

This project treats five version spaces as distinct:

| Kind | Meaning | Example |
|---|---|---|
| OpenText IDOL version | Knowledge Discovery product train | `26.2`, `26.3` |
| OpenText IDOL NiFi product version | NiFi Ingest bundle that ships with that IDOL train | `26.2`, `26.3` |
| Apache NiFi version | Upstream NiFi inside the image | `2.9.0` for the 26.3 demo image |
| IDOL NiFi NAR version | Filename/version of the `.nar` artifacts | `26.2.0-nifi2`, `26.3.0-nifi2` |
| Generated flow definition version | Schema of the JSON this MCP server emits | `1.0` |

They are not assumed to be identical. The resolver only accepts combinations listed in `nars/compatibility-matrix.json`.

## Supported matrix (shipped)

| Profile | IDOL | NiFi product | NAR | Apache NiFi | Docker image |
|---|---|---|---|---|---|
| `idol-26.2-nifi-26.2` | 26.2 | 26.2 | 26.2.0-nifi2 | 2.0–2.4 (nifi2 pack) | `microfocusidolserver/nifi-ver2-full:26.2` |
| `idol-26.3-nifi-26.3` | 26.3 | 26.3 | 26.3.0-nifi2 | 2.9.0 (this project's documented 26.3 image) | `microfocusidolserver/nifi-ver2-full:26.3` |

A 26.2 request never receives 26.3 NARs. A 26.3 request never receives 26.2 NARs. There is no `latest` profile.

## Artifact names

Filenames follow the OpenText NiFi Ingest documented pattern (`idol-nifi-*-nar-<version>.nar`) plus the `nifi2` qualifier required for NiFi 2.x. This repository does **not** vendor the proprietary binaries.

```
nars/
  compatibility-matrix.json
  26.2/manifest.json
  26.3/manifest.json
```

Place the matching `.nar` files next to the manifest when you want local install mode. SHA-256 is computed from the file when present; a declared hash that does not match blocks resolution.

## How MCP resolves NARs

1. Parse the requested version from tool arguments, the prompt, or `IDOL_VERSION` / `NIFI_VERSION`.
2. Decide whether the token is an IDOL product version, an OpenText NiFi product version, or an Apache NiFi version (`2.x`).
3. Look up an exact profile in the matrix.
4. Filter requested processors against that profile.
5. Optionally require the `.nar` files to exist on disk.
6. Return `PASS` or `BLOCKED`. No other minor version is substituted.

Apache NiFi `2.9.0` maps only to the 26.3 profile because that is what this project's 26.3 image documents. It will not select 26.2 NARs.

## Register a new IDOL / NiFi version

1. Create `nars/<major.minor>/`.
2. Add `manifest.json` with `idolVersion`, `nifiVersion`, `narVersion`, `apacheNifiVersions`, artifacts, processors, and controller services.
3. Append a profile entry to `nars/compatibility-matrix.json`.
4. Drop the real `.nar` files into that folder. Do not copy another version's files.
5. Set `IDOL_VERSION` / `NIFI_IMAGE` to the new train when running local NiFi.
6. Run `python -m unittest mcp-server/tests/test_nar_resolution.py`.

Do not add a `latest/` directory.

## Local vs external NiFi

| Mode | `NIFI_DEPLOYMENT_MODE` | NAR install |
|---|---|---|
| Local compose NiFi | `local` | `install_idol_nars` may copy files into `NIFI_EXTENSIONS_DIR` |
| External / remote NiFi | `external` (default) | Installation is a prerequisite. The server reports the exact artifacts and does not push NARs |

## Troubleshooting

**BLOCKED: no compatible package**  
The requested pair is not in the matrix. Check `list_idol_nar_versions`.

**BLOCKED: NAR files missing**  
The profile exists but `require_files` is on and `nars/<ver>/*.nar` is empty. Add the correct package or point at an IDOL image that already contains those NARs.

**BLOCKED: checksum mismatch**  
The file on disk is not the hash recorded in the manifest.

**Wrong processors on the canvas**  
`diagnose_idol_nifi_environment` compares live `/flow/processor-types` with the selected profile.

**26.2 flow showing 26.3 artifacts**  
That is a bug. File it. The tests in `mcp-server/tests/test_nar_resolution.py` exist specifically to forbid that.
