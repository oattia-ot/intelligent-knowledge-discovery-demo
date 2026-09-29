# Fix: item click does nothing + badge total not resetting

File: `apps/web/src/app/shared/components/nifi-ai-modal/nifi-ai-modal.component.ts`

Both bugs come from the same root cause: the integration script only fully
"adopts" objects that were created *in this browser session* (via Add /
Import). Anything that was already sitting in the embedded UI when the page
loaded gets decorated with Edit/Export/Delete controls, but is never wired up
for anything else.

## 1. Clicking an item does nothing

`bindObjectClick()` refuses to run unless the element is flagged
`kdCreated === '1'`:

```ts
el.addEventListener('click', (ev) => {
  ...
  if (el.dataset['kdCreated'] !== '1') {
    return;   // <-- silently does nothing
  }
  ...
});
```

That flag is only ever set inside `makeSideBtn()` (i.e. for items you just
added or imported). Items that were already present in the embedded UI on
page load go through `ensureAddButtons()` → `enhanceObject(entry, kind)`,
which adds the Edit/Export/Delete icons but **never calls
`bindObjectClick()` and never sets `kdCreated`**. So those items get action
icons but the card itself has no click listener at all — clicking it is a
no-op.

**Fix applied:** in the `ensureAddButtons()` loop, right after
`enhanceObject(entry, kind)`, the entry is now flagged `kdCreated = '1'` and
passed to `bindObjectClick(entry, kind)` as well, so every recognized object
— not just ones created this session — is runnable.

## 2. The badge/counter total doesn't reset

`updateKindCounts()` keeps the section heading in sync ("Actions 3") by
walking the heading's text nodes with a regex that matches the
ACTIONS/SKILLS/TEMPLATES word plus a trailing number, and rewriting that
node. If the "total" you're seeing is a separate small round badge element
next to the heading (its own DOM node, whose text is *just* the digits, with
no "Actions"/"Skills"/"Templates" word in it), the regex never matches it —
it has no label word to key off — so it's left showing the last real count
forever, even after Clear all / Delete / Import.

**Fix applied:** added `updateHeadingBadge()`, called at the end of each
heading's `updateKindCounts()` pass. It looks inside the heading/toggle and
at its sibling elements in the same row for any leaf element whose entire
text content is a bare integer, and sets it directly to the current count.

## Verify

```bash
cd apps/web
node scripts/verify-nifi-ai-refactor.mjs   # dependency-free structural checks — should all PASS
npm run build                               # full Angular build, needs npm install first
```

Then in the running app: add/delete a couple of Actions/Skills/Templates and
confirm both the heading text *and* the round badge update, and click a card
that was already present before you touched anything this session — it
should now open the Run dialog / execute instead of doing nothing.

## If the badge still doesn't move

`updateHeadingBadge()` only looks at the heading's own subtree and its
immediate row siblings. If the real badge lives somewhere further away in
the embedded UI's markup (e.g. a global total across all three sections,
rendered elsewhere in the page), right-click it → **Inspect** in the browser,
grab its class name or a unique attribute, and that selector can be targeted
directly instead of the generic "bare integer leaf" heuristic — happy to
wire that in if you paste the element's outer HTML.

## 3. Import all must restore only the JSON items

`importPayloads()` already removed and tombstoned every entry it could see at
import time, but the embedded UI can redraw its own default entries later.
Those were never seen by the one-time sweep, so they were never tombstoned and
came back alongside the imported items.

**Fix:** after an import, each imported kind is locked to the exact names in the
file (`kd-nifi-import-lock`). `ensureAddButtons()` strips any entry of a locked
kind that is not on the list, on every pass. Adding or editing an item extends
the list, deleting one shrinks it, and **Refresh** or **Clear all** lift the
lock. Kinds that are not in the file are left untouched.

## 4. Inline popup messages instead of browser dialogs

Every `window.alert()` / `window.confirm()` now goes through `showMessage()`,
an in-page modal styled like the parameter dialog. Confirmations (Delete item,
Clear all) use Cancel plus a red action button.

## 5. Templates: native Add button and label cleanup

The Templates add control is now `<button type="button" class="ghost" id="addTpl">+ Add template</button>`
(`makeAddButton('template')`). The labels `actions`, `ingest`, `idol nifi2`,
`stages` and `custom` are deleted from the Templates section by
`pruneTemplateLabels()`; to change the list, edit `TEMPLATE_LABELS_TO_REMOVE`.

## 6. Imported items did nothing on click

Imported items are recreated as new cards, so they don't have the embedded
page's own click handling. They run by filling the page's prompt box and
clicking its Send button (`fillComposerAndSend`). That step failed silently when
Send was still disabled at click time (the page enables it only after
re-rendering on the input event), when Send had a different label, or when the
composer was `contenteditable`.

Fix: wait for Send to enable, broader Send detection, Enter-key fallback, and
an inline popup when the prompt box can't be found. If a click still does
nothing, right-click the prompt box and the Send button in the NiFi AI page,
choose Inspect, and send the outer HTML of both.
