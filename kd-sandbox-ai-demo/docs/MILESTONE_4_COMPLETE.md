# Milestone 4 — Facets complete

## Behaviour

- Left panel **Refine by** sections under database filters.
- Facet definitions: `config/parametric-filters.json`.
- Values: Content `GetQueryTagValues` (`FieldName=*`, filtered to config fields).
- Selection applies IDOL **FieldText** on Query, e.g.  
  `MATCH{APPLICATION/PDF}:PART_MIMETYPE`  
  Multiple facets: `… AND MATCH{…}:OTHER_FIELD`.
- Counts refresh after each search (scoped by databases + active FieldText).

## Parametric fields on this Content engine

Live GetQueryTagValues returns values for:

| idolField | Typical values |
|-----------|----------------|
| `DOCUMENT/PART_MIMETYPE` | APPLICATION/PDF, IMAGE/PNG, … |
| `DOCUMENT/NAME_VALUE` | person names |

Other config entries (connector group, language) appear only if Content exposes them as parametric.

## Files

- `config/parametric-filters.json`
- `SearchService.getFacetValues` / `buildFieldText` / `FieldText` on Query
- Search left panel UI
