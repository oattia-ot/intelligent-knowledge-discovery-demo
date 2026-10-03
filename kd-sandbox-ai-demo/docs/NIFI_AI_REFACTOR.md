# NiFi AI integration refactor

The NiFi AI integration keeps the existing embedded NiFi behavior while consolidating object lifecycle handling.

## Canonical lifecycle

`upsertObject(payload)` is the single creation pipeline for:

- Manual Action, Skill, and Template creation
- JSON import
- Reload restoration when a saved object is missing

It normalizes the object name, removes matching DOM duplicates, updates the in-memory catalog, updates localStorage, creates one card, and binds the card once.

`removeObject(kind, name)` is the single deletion pipeline. It removes matching DOM entries, catalog entries, and persistent entries using the same normalized identity key.

Edit keeps the existing native DOM element in place. It updates the element and persists the edited payload without replacing native NiFi markup.

## Click handling

`bindObjectClick()` is the single idempotent click binder for created objects. The previous `bindRunIfCreated()` path is removed.

Object action controls stop propagation, so Edit, Export, and Delete cannot also trigger Run.

## Identity and deduplication

Object identity uses:

`kind + normalized name`

Normalization collapses repeated whitespace, trims the name, and compares case-insensitively. The same identity rule is used by persistence, duplicate validation, DOM lookup, import, restore, and export.

## Add controls

Add Action, Add Skill, and Add Template controls now live inside their corresponding sections. The integration no longer creates a root-level Actions, Skills, and Templates Add toolbar.

A compatibility cleanup removes the old `#kd-nifi-add-group` if an older embedded UI leaves it behind.

## Verification

Run:

`npm run verify:nifi-ai`

This performs dependency-free structural checks against the integration source. A full Angular build still requires the project's npm dependencies and the real embedded NiFi AI UI for browser-level verification.
