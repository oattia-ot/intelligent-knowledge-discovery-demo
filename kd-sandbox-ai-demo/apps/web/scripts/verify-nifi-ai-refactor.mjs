import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const file = resolve(new URL('../src/app/shared/components/nifi-ai-modal/nifi-ai-modal.component.ts', import.meta.url).pathname);
const source = await readFile(file, 'utf8');

const checks = [
  ['canonical upsertObject exists exactly once', (source.match(/const upsertObject\s*=\s*/g) || []).length === 1],
  ['canonical removeObject exists exactly once', (source.match(/const removeObject\s*=\s*/g) || []).length === 1],
  ['canonical bindObjectClick exists exactly once', (source.match(/const bindObjectClick\s*=\s*/g) || []).length === 1],
  ['legacy bindRunIfCreated is gone', !source.includes('bindRunIfCreated')],
  ['normalized object identity exists', source.includes('const normKey =') && source.includes('const objectKey =')],
  ['section-local add entries exist', source.includes('.kd-nifi-add-entry') && source.includes('ensureKindAddControl(host, kind)')],
  ['root add toolbar is cleanup-only', source.includes("doc.getElementById('kd-nifi-add-group')?.remove()")],
  ['create path uses canonical upsert', source.includes('const created = upsertObject(payload);')],
  ['import path uses canonical upsert', source.includes('wanted.forEach((payload) => upsertObject(payload));')],
  ['reload restore uses canonical upsert when absent', source.includes('// Reload restore uses the same canonical creation pipeline')],
  ['delete path uses canonical remove', source.includes('removeObject(kind, name);')],
  ['clear all uses canonical removeObject pipeline', source.includes('names.forEach((name) => removeObject(kind, name));')],
  ['clear all skips DOM snapshot restore', source.includes('skipDomSnapshot = true;') && source.includes('setUiCleared(true)')],
  ['clear all notifies the server', source.includes("method: 'clearAllObjects'") && source.includes('/api/admin/nifi-ai/clear-all')],
  ['clear all button is rebound by data attribute', source.includes("dataset['kdIo'] = 'clear-all'")],
  ['run click reports an MCP runObject request', source.includes("notifyServerMcp('runObject'") && source.includes('/api/admin/nifi-ai/mcp')],
  ['refresh click reports an MCP refreshObjects request', source.includes("notifyServerMcp('refreshObjects'") && source.includes('runRefresh')],
  ['add/edit persists via MCP addObject', source.includes("notifyServerMcp('addObject'")],
  ['delete persists via MCP deleteObject', source.includes("notifyServerMcp('deleteObject'")],
  ['all add buttons use class ghost with ids', source.includes("btn.className = 'ghost';") && source.includes("'addAct'") && source.includes("'addSkill'") && source.includes("'addTpl'")],
  ['heading label carries no count', source.includes("TEMPLATE FLOWS)\\b(\\s*\\d+)?/gi, title)") && !source.includes('`${title} ${count}`')],
  ['server has an MCP route', (await readFile(new URL('../admin-config-api.mjs', import.meta.url), 'utf8')).includes("'/api/admin/nifi-ai/mcp'")],
  ['empty needs is derived from prompt tokens', source.includes('const derivedNeeds =') && (source.match(/derivedNeeds\(/g) || []).length >= 3 /* 3 call sites */],
  ['run never sends unresolved tokens', source.includes('const unresolved = placeholders(prompt);') && source.includes('const sourcePromptFor =')],
];

let failed = false;
for (const [label, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
  if (!ok) failed = true;
}

if (failed) process.exit(1);
console.log('NiFi AI structural refactor checks passed.');
