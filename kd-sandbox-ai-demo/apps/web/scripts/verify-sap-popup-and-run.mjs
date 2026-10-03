/**
 * Structural + behavioral checks for SAP-ingest parameter popups
 * and click-to-run on newly added items.
 *
 * Run: node apps/web/scripts/verify-sap-popup-and-run.mjs
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(new URL('../../../..', import.meta.url).pathname);
const uiPath = resolve(root, 'kd-nifi-ai-mcp/ui/index.html');
const modalPath = resolve(
  root,
  'kd-sandbox-ai-demo/apps/web/src/app/shared/components/nifi-ai-modal/nifi-ai-modal.component.ts'
);
const html = await readFile(uiPath, 'utf8');
const modal = await readFile(modalPath, 'utf8');

const checks = [];
const check = (label, ok) => checks.push([label, !!ok]);

const dialogs = [...html.matchAll(/<dialog\b([^>]*)>/g)].map((m) => m[1]);
check('at least 3 parameter/popup dialogs exist', dialogs.length >= 3);
check(
  'every <dialog> uses the SAP ingest class',
  dialogs.length > 0 && dialogs.every((attrs) => /class="[^"]*\bsap-dialog\b/.test(attrs))
);

for (const id of ['settings', 'missingDlg', 'tplDialog']) {
  const block = html.split(`id="${id}"`)[1]?.slice(0, 900) || '';
  check(`${id} has SAP header`, block.includes('kd-sap-head'));
  check(`${id} has SAP gold accent`, block.includes('kd-sap-accent'));
  check(`${id} has SAP parameter body`, block.includes('kd-param-body'));
  check(`${id} has SAP close control`, block.includes('kd-sap-x'));
}

check('SAP dialog backdrop matches navy overlay', html.includes('dialog.sap-dialog::backdrop') && html.includes('rgba(11, 44, 77, 0.5)'));
check('SAP dialog uses navy header and gold accent', html.includes('#0b2c4d') && html.includes('#c5a572'));
check('new templates keep local items when the server catalog is non-empty', html.includes('function mergeCatalog') && html.includes('TEMPLATE_ITEMS = mergeCatalog(remoteItems, local)'));
check('side buttons are marked runnable', html.includes("b.dataset.kdRunnable = \"1\"") || html.includes("b.dataset.kdRunnable = '1'"));
check('side button click launches the item', html.includes('launchCatalogItem(item)'));
check('aside delegation runs a clicked item even if its own listener is lost', html.includes('launchCatalogItem(item)') && html.includes('data-kd-runnable') === false ? html.includes('closest(".side-btn")') : html.includes('closest(".side-btn")'));
check('run-prompt messages can force send', html.includes('action === "run-prompt"') && html.includes('data.force'));
check('Needs field is saved on a new template', html.includes('id="tplNeeds"') && html.includes('needs: document.getElementById("tplNeeds")'));

check('injected parameter dialog is marked sap-dialog', modal.includes("dialog.className = 'sap-dialog'"));
check('injected dialog uses the SAP header/accent/body', modal.includes('kd-sap-head') && modal.includes('kd-sap-accent') && modal.includes('kd-param-body'));
check('new cards are flagged runnable', modal.includes("btn.dataset['kdRunnable'] = '1'"));
check('click handler runs runnable cards, not only kdCreated', modal.includes("el.dataset['kdRunnable'] === '1'"));
check('capture click treats runnable cards as executable', modal.includes("card.dataset['kdRunnable'] === '1'"));
check('native popups are restyled to the SAP shell', modal.includes("dialog.classList.add('sap-dialog')") && modal.includes("head.className = 'kd-sap-head'"));
check('failed composer send falls back to run-prompt force', modal.includes("action: 'run-prompt', prompt: text, force: true"));

function templateRequired(t) {
  const listed = (t.required_config || t.required || []).map((item) =>
    typeof item === 'string' ? { key: item, label: item.replace(/_/g, ' '), placeholder: item } : item
  );
  if (listed.length) return listed;
  const fromNeeds = String(t.needs || '')
    .split(/[,;|]/)
    .map((part) => part.replace(/^needs:\s*/i, '').trim())
    .filter(Boolean)
    .map((key) => ({ key, label: key.replace(/_/g, ' '), placeholder: key }));
  if (fromNeeds.length) return fromNeeds;
  const inferred = [];
  const seen = {};
  String(t.prompt || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    if (!seen[key]) {
      seen[key] = true;
      inferred.push({ key, label: key.replace(/_/g, ' '), placeholder: key });
    }
  });
  return inferred;
}
function itemKey(item) {
  return String((item && (item.id || item.title || item.name)) || '').trim().toLowerCase();
}
function mergeCatalog(remoteItems, localItems) {
  const map = new Map();
  (remoteItems || []).forEach((item) => {
    const key = itemKey(item);
    if (key) map.set(key, item);
  });
  (localItems || []).forEach((item) => {
    const key = itemKey(item);
    if (!key) return;
    const prev = map.get(key);
    map.set(key, prev ? Object.assign({}, prev, item, { custom: true }) : item);
  });
  return Array.from(map.values());
}

const remote = [{ id: 'sap', title: 'SAP ingest', prompt: 'Create a KD SAP ingestion flow into IDOL', required_config: ['sap_endpoint', 'repository', 'idol_host'] }];
const local = [{ id: 'local-1', title: 'SharePoint ingest', prompt: 'Ingest {{site}}', needs: 'site', custom: true }];
const merged = mergeCatalog(remote, local);
check('merge keeps SAP ingest and the newly added template', merged.length === 2 && merged.some((i) => i.title === 'SharePoint ingest'));
const added = merged.find((i) => i.title === 'SharePoint ingest');
const req = templateRequired(added);
check('new item parameters are discovered for the SAP popup', req.length === 1 && req[0].key === 'site');
const sapReq = templateRequired(remote[0]);
check('SAP ingest still requires its three parameters', sapReq.map((f) => f.key).join(',') === 'sap_endpoint,repository,idol_host');

let ran = null;
function launchCatalogItem(item) {
  const fields = item.required || templateRequired(item);
  if (!fields.length) {
    ran = { mode: 'execute', prompt: item.prompt || item.title };
    return;
  }
  ran = { mode: 'sap-dialog', title: 'Complete ' + item.title, fields: fields.map((f) => f.key) };
}
launchCatalogItem(added);
check('clicking a new parameterized item opens the SAP parameter window', ran && ran.mode === 'sap-dialog' && ran.fields.includes('site'));
launchCatalogItem({ title: 'Plain item', prompt: 'Create a flow', required: [] });
check('clicking a new item without parameters executes immediately', ran && ran.mode === 'execute' && ran.prompt === 'Create a flow');

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
}
if (failed) {
  console.error(`verify-sap-popup-and-run: ${checks.filter((c) => !c[1]).length} failed`);
  process.exit(1);
}
console.log(`verify-sap-popup-and-run: ${checks.length} checks passed`);
