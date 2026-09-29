# apps/web CHANGELOG

See the root [CHANGELOG.md](../../CHANGELOG.md) for the full tracing log of UI improvements, protocol/host changes, language support, runtime fixes, and packaging history.

This file is retained for convenience inside the Angular workspace.

## 2026-09-27 — Native item click + badge counter fix

- `ensureAddButtons()` now flags pre-existing (not created-this-session) Action/Skill/Template entries as `kdCreated` and binds them with `bindObjectClick()`, alongside the existing `enhanceObject()` call. Previously those entries only got Edit/Export/Delete controls; clicking the card itself did nothing because `bindObjectClick()`'s click handler silently returns for anything not flagged `kdCreated`.
- Added `updateHeadingBadge()`, run at the end of every `updateKindCounts()` pass. It resets any bare-number badge element sitting next to a section heading directly, since the existing regex-based heading rewrite only matches text nodes that contain the ACTIONS/SKILLS/TEMPLATES label word and so never touched a separate numeric badge/counter element.
- See `docs/NIFI_AI_CLICK_AND_COUNTER_FIX.md` for the full root-cause writeup.

## 2026-09-28 — Imported items now run reliably on click

- `fillComposerAndSend()` no longer clicks Send synchronously. It re-resolves the Send control and waits (up to ~1s) for it to become enabled, because the page often enables Send only after re-rendering in response to the input event; a click on the still-disabled button did nothing and failed silently.
- New `findSendControl()`: exact "Send" label, then any control whose label/aria-label/title/id/class mentions send/submit/run, then the form's submit button, then the last enabled button in the composer's container. Our own buttons and left-rail items are excluded.
- Fallback when no Send control exists: full Enter key sequence (keydown/keypress/keyup) plus `form.requestSubmit()`. `contenteditable` composers are supported.
- If the prompt box cannot be found, the item now shows an inline popup instead of failing silently (previously the per-item click handler ignored the failure).

## 2026-09-28 — Native Add template button + template label cleanup

- The generated `.kd-nifi-add-btn` in the Templates list is replaced by `<button type="button" class="ghost" id="addTpl">+ Add template</button>`. It is still recognised as ours (click opens the create dialog, excluded from entry scans, kept by the stray-button cleanup). Actions and Skills keep their existing add buttons.
- `pruneTemplateLabels()` now deletes the labels `actions`, `ingest`, `idol nifi2`, `stages` and `custom` from the Templates section on every scan. Objects saved or imported with those names are left alone.

## 2026-09-28 — Import is authoritative + inline popup messages

- **Import all** now sets a per-kind import lock (`kd-nifi-import-lock` in localStorage) holding exactly the names in the JSON. `ensureAddButtons()` removes any entry of a locked kind whose name is not on the list, on every pass, so default/native entries the embedded UI redraws after import no longer come back next to the imported items. Manual Add/Edit extends the lock, per-item Delete shrinks it, and **Refresh** / **Clear all** lift it.
- All native `window.alert()` / `window.confirm()` calls (delete item, clear all, nothing to clear, bad JSON file, empty import, no prompt to run) were replaced with an in-page modal (`showMessage()`, `#kd-nifi-msg-overlay`) styled like the existing parameter dialog. Confirm dialogs use Cancel + a danger-styled action button; Esc, the X, or clicking the backdrop dismisses.

## 2026-09-27 — Clear all lock + server method log

- Clear all keeps Actions, Skills, and Templates empty (tombstones + `kd-nifi-ui-cleared`).
- Clear all posts `method=clearAllObjects` to `/api/admin/nifi-ai/clear-all`.
- admin-config-api logs `[KD][NiFi AI] calling method=clearAllObjects` and forwards to NiFi ports.
- The Clear all control is rebound via `data-kd-io="clear-all"` on every toolbar refresh.
- Refresh rescans embedded lists; Import / Add lift the clear lock.

## 2026-09-27

- Added a canonical Clear all action for the NiFi AI object lists.
- Clear all removes Actions, Skills, and Templates through the existing `removeObject()` pipeline.
- Clear all synchronizes the embedded DOM, in-memory catalog, and localStorage, then refreshes from the synchronized empty state without taking a stale DOM snapshot.
- Added confirmation before bulk deletion and ensured the control appears even when an older IO toolbar already exists.
