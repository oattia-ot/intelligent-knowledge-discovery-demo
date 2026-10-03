import { Injectable, inject } from '@angular/core';
import { BrandingService } from './branding.service';
import { AppSettingsService } from './app-settings.service';
import {
  CONCEPT_OPERATORS,
  ConceptSearchSettingsService,
  SUMMARY_LENGTH_OPTIONS,
  SUMMARY_TYPES
} from './concept-search-settings.service';
import { ThemeDefinition, ThemeService } from './theme.service';

/**
 * Lightweight static HTML+CSS(+JS) export of the selected theme.
 * AI Chat and Settings are real pages (not dead # links).
 * Localization & Themes UI is intentionally omitted.
 */
@Injectable({ providedIn: 'root' })
export class StaticExportService {
  private readonly themes = inject(ThemeService);
  private readonly branding = inject(BrandingService);
  private readonly appSettings = inject(AppSettingsService);
  private readonly concept = inject(ConceptSearchSettingsService);

  exportSelectedTheme(pathHint: string): void {
    const theme = this.themes.current();
    const title = this.branding.title();
    const logo = this.branding.logoUrl();
    const projectName = this.sanitizeProjectName(pathHint);

    const footerPrimary = this.branding.footerPrimaryResolved();
    const footerPowered = this.branding.footerPowered();
    const files: Array<{ name: string; content: string }> = [
      { name: `${projectName}/index.html`, content: this.pageHome(title, logo, projectName, theme, footerPrimary, footerPowered) },
      { name: `${projectName}/chat.html`, content: this.pageChat(title, logo, footerPrimary, footerPowered) },
      { name: `${projectName}/settings.html`, content: this.pageSettings(title, logo, footerPrimary, footerPowered) },
      { name: `${projectName}/css/theme.css`, content: this.buildCss(theme) },
      { name: `${projectName}/js/app.js`, content: this.buildJs() },
      { name: `${projectName}/README.md`, content: this.buildReadme(projectName, pathHint, theme) }
    ];

    this.downloadBlob(this.buildZip(files), `${projectName}.zip`);
  }

  private sanitizeProjectName(pathHint: string): string {
    const raw = (pathHint || 'kd-static-export').trim();
    const segment = raw.replace(/\\/g, '/').split('/').filter(Boolean).pop() || 'kd-static-export';
    const clean = segment
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64);
    return clean || 'kd-static-export';
  }

  private shell(
    title: string,
    logo: string | null,
    active: 'home' | 'chat' | 'settings',
    body: string,
    footerPrimary: string,
    footerPowered: string
  ): string {
    const safeTitle = this.escapeHtml(title);
    const logoBlock = logo
      ? `<img class="brand__logo" src="${logo}" alt="" />`
      : `<span class="brand__mark" aria-hidden="true"></span>`;
    const nav = (id: string, href: string, label: string) => {
      const cls = ['btn', active === id ? 'btn--active' : ''].filter(Boolean).join(' ');
      return `<a class="${cls}" href="${href}">${label}</a>`;
    };
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <link rel="stylesheet" href="css/theme.css" />
</head>
<body>
  <div class="shell">
    <header class="header">
      <a class="brand" href="index.html">
        ${logoBlock}
        <span class="brand__title">${safeTitle}</span>
      </a>
      <nav class="nav" aria-label="Primary">
        ${nav('chat', 'chat.html', 'AI Chat')}
        ${nav('settings', 'settings.html', 'Settings')}
        <button type="button" class="btn btn--primary" data-action="signout">Sign out</button>
      </nav>
    </header>
    <main class="main">
      ${body}
    </main>
    <footer class="footer">
      <div>${this.escapeHtml(footerPrimary)}</div>
      <div class="footer__powered">${this.escapeHtml(footerPowered)}</div>
    </footer>
  </div>
  <script src="js/app.js"></script>
</body>
</html>
`;
  }

  private pageHome(
    title: string,
    logo: string | null,
    projectName: string,
    theme: ThemeDefinition,
    footerPrimary: string,
    footerPowered: string
  ): string {
    const safeTitle = this.escapeHtml(title);
    return this.shell(
      title,
      logo,
      'home',
      `<section class="card">
        <h1>${safeTitle}</h1>
        <p>
          Lightweight static project. Theme: <strong>${this.escapeHtml(theme.id)}</strong>.
          Folder: <strong>${this.escapeHtml(projectName)}</strong>.
        </p>
        <p class="card__actions">
          <a class="btn btn--solid" href="chat.html">Open AI Chat</a>
          <a class="btn btn--solid" href="settings.html">Open Settings</a>
        </p>
      </section>`,
      footerPrimary,
      footerPowered
    );
  }

  private pageChat(
    title: string,
    logo: string | null,
    footerPrimary: string,
    footerPowered: string
  ): string {
    return this.shell(
      title,
      logo,
      'chat',
      `<section class="card card--chat">
        <h1>AI Chat</h1>
        <p class="muted">Static demo chat — messages stay in this browser tab only.</p>
        <div id="chat-log" class="chat-log" aria-live="polite"></div>
        <form id="chat-form" class="chat-form" autocomplete="off">
          <input id="chat-input" type="text" placeholder="Type a message…" required />
          <button type="submit" class="btn btn--solid">Send</button>
        </form>
      </section>`,
      footerPrimary,
      footerPowered
    );
  }

  private pageSettings(
    title: string,
    logo: string | null,
    footerPrimary: string,
    footerPowered: string
  ): string {
    const op = this.concept.operator();
    const st = this.concept.summaryType();
    const sl = this.concept.summaryLength();
    const protocol = this.appSettings.protocol();
    const baseHost = this.appSettings.baseHost();

    const opChips = CONCEPT_OPERATORS.map(
      (o) =>
        `<button type="button" class="chip${o === op ? ' chip--active' : ''}" data-value="${o}">${o}</button>`
    ).join('\n            ');
    const stChips = SUMMARY_TYPES.map(
      (s) =>
        `<button type="button" class="chip${s === st ? ' chip--active' : ''}" data-value="${s}">${s}</button>`
    ).join('\n            ');
    const slChips = SUMMARY_LENGTH_OPTIONS.map(
      (n) =>
        `<button type="button" class="chip${n === sl ? ' chip--active' : ''}" data-value="${n}">${n}</button>`
    ).join('\n            ');

    const fields = this.appSettings.fields();
    const pathRows = fields
      .filter((f) => f.kind === 'path')
      .map((f) => {
        const effective = this.appSettings.get(f.key);
        const path = this.appSettings.pathOf(effective || f.default);
        const preview = this.appSettings.composeUrl(path, protocol, baseHost) || path;
        return `<div class="comp-row" data-key="${this.escapeHtml(f.key)}">
            <div class="comp-row__meta">
              <strong>${this.escapeHtml(f.label)}</strong>
              <span class="muted">${this.escapeHtml(f.description)}</span>
              <span class="muted">Default: <code>${this.escapeHtml(f.default)}</code></span>
            </div>
            <label class="field">
              <span>Path</span>
              <input type="text" class="comp-path" data-key="${this.escapeHtml(f.key)}" value="${this.escapeHtml(path)}" />
            </label>
            <p class="muted">Preview: <code class="comp-preview" data-key="${this.escapeHtml(f.key)}">${this.escapeHtml(preview)}</code></p>
          </div>`;
      })
      .join('\n');

    const originRows = fields
      .filter((f) => f.kind === 'origin')
      .map((f) => {
        const effective = this.appSettings.get(f.key) || f.default || '';
        return `<div class="comp-row" data-key="${this.escapeHtml(f.key)}">
            <div class="comp-row__meta">
              <strong>${this.escapeHtml(f.label)}</strong>
              <span class="muted">${this.escapeHtml(f.description)}</span>
              <span class="muted">Default: <code>${this.escapeHtml(f.default || '—')}</code></span>
            </div>
            <label class="field">
              <span>URL / origin</span>
              <input type="text" class="comp-path" data-key="${this.escapeHtml(f.key)}" value="${this.escapeHtml(effective)}" />
            </label>
          </div>`;
      })
      .join('\n');

    return this.shell(
      title,
      logo,
      'settings',
      `<section class="card">
        <h1>Settings</h1>
        <p class="muted">Business and Application configuration from the live app. Localization &amp; Themes is not included.</p>
        <div class="tabs" role="tablist">
          <button type="button" class="tab tab--active" data-tab="business" role="tab" aria-selected="true">Business Configuration</button>
          <button type="button" class="tab" data-tab="application" role="tab" aria-selected="false">Application Configuration</button>
        </div>
        <div id="panel-business" class="tab-panel">
          <h2>Join concepts with</h2>
          <div class="chip-row" data-group="operator">
            ${opChips}
          </div>
          <h2>Summary type</h2>
          <div class="chip-row" data-group="summaryType">
            ${stChips}
          </div>
          <h2>Summary length</h2>
          <div class="chip-row" data-group="summaryLength">
            ${slChips}
          </div>
          <p id="settings-status" class="status" hidden>Saved locally for this static demo.</p>
        </div>
        <div id="panel-application" class="tab-panel" hidden>
          <h2>Protocol &amp; host</h2>
          <p class="muted">Used to build generated URLs for path components.</p>
          <div class="base-row">
            <div class="protocol-toggle" role="group">
              <button type="button" class="chip${protocol === 'http' ? ' chip--active' : ''}" data-protocol="http">http</button>
              <button type="button" class="chip${protocol === 'https' ? ' chip--active' : ''}" data-protocol="https">https</button>
            </div>
            <input type="text" id="base-host" value="${this.escapeHtml(baseHost)}" placeholder="hostname or host:port (optional)" />
          </div>
          <h2>Components</h2>
          <p class="muted">All configured service paths from the application.</p>
          ${pathRows}
          <h2>Origins</h2>
          ${originRows || '<p class="muted">No origin fields.</p>'}
          <button type="button" class="btn btn--solid" data-action="save-app" style="margin-top:1rem">Save application config</button>
        </div>
      </section>`,
      footerPrimary,
      footerPowered
    );
  }

  private buildCss(theme: ThemeDefinition): string {
    const lines = Object.entries(theme.vars).map(([k, v]) => `  ${k}: ${v};`);
    return `/* Selected theme only: ${theme.id} */\n:root {\n${lines.join('\n')}\n  --kd-radius-sm: 6px;\n  --kd-radius-md: 8px;\n  --kd-radius-lg: 12px;\n  --kd-header-height: 64px;\n  --kd-font: Inter, 'Segoe UI', Roboto, Arial, sans-serif;\n}\n\n*,*::before,*::after{box-sizing:border-box}\nhtml,body{margin:0;padding:0;min-height:100%;font-family:var(--kd-font);background:var(--kd-bg);color:var(--kd-text)}\n.shell{min-height:100vh;display:flex;flex-direction:column}\n.header{display:flex;align-items:center;justify-content:space-between;gap:1rem;min-height:var(--kd-header-height);padding:.75rem 1.25rem;background:var(--kd-navy);color:#fff;box-shadow:0 2px 12px rgba(0,0,0,.15)}\n.brand{display:flex;align-items:center;gap:.75rem;min-width:0;text-decoration:none;color:inherit}\n.brand__logo{height:36px;width:auto;max-width:120px;object-fit:contain;border-radius:var(--kd-radius-sm);background:rgba(255,255,255,.08);padding:2px 4px}\n.brand__mark{width:36px;height:36px;border-radius:var(--kd-radius-sm);background:linear-gradient(145deg,var(--kd-primary-light),var(--kd-primary-dark))}\n.brand__title{font-weight:700;font-size:1.05rem;letter-spacing:.02em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.nav{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap}\n.btn{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.15rem;padding:.4rem .85rem;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.1);color:#fff;font-size:.8rem;font-weight:650;text-decoration:none;cursor:pointer;font-family:inherit;transition:background .15s,border-color .15s}\n.btn:hover{background:rgba(255,255,255,.18);border-color:rgba(255,255,255,.35);color:#fff}\n.btn--active{background:rgba(255,255,255,.22);border-color:rgba(255,255,255,.45)}\n.btn--primary{background:var(--kd-primary);border-color:var(--kd-primary-dark);color:var(--kd-navy)}\n.btn--primary:hover{background:var(--kd-primary-dark);color:#fff}\n.btn--solid{background:var(--kd-primary);border-color:var(--kd-primary-dark);color:var(--kd-navy)}\n.btn--solid:hover{background:var(--kd-primary-dark);color:#fff}\n.main{flex:1;max-width:960px;width:100%;margin:0 auto;padding:1.5rem 1.25rem 2.5rem}\n.card{background:var(--kd-surface);border:1px solid var(--kd-border);border-radius:var(--kd-radius-lg);padding:1.25rem 1.35rem;box-shadow:var(--kd-shadow,0 4px 24px rgba(0,0,0,.06))}\n.card h1{margin:0 0 .5rem;font-size:1.35rem;color:var(--kd-navy)}\n.card h2{margin:1rem 0 .45rem;font-size:.95rem;color:var(--kd-navy)}\n.card p{margin:0;line-height:1.5;font-size:.92rem}\n.muted{color:var(--kd-text-muted)!important}\n.card__actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}\n.footer{padding:.85rem 1.25rem;text-align:center;font-size:.75rem;color:var(--kd-text-muted);border-top:1px solid var(--kd-border)}\n.tabs{display:flex;gap:.35rem;margin:1rem 0;flex-wrap:wrap}\n.tab{border:1px solid var(--kd-border);background:var(--kd-bg);color:var(--kd-text-muted);border-radius:999px;padding:.4rem .85rem;font-size:.8rem;font-weight:650;cursor:pointer}\n.tab--active{background:rgba(197,165,114,.25);border-color:var(--kd-primary);color:var(--kd-navy)}\n.chip-row{display:flex;flex-wrap:wrap;gap:.4rem}\n.chip{border:1px solid var(--kd-border);background:var(--kd-bg);color:var(--kd-navy);border-radius:999px;padding:.32rem .75rem;font-size:.78rem;font-weight:650;cursor:pointer}\n.chip--active{background:rgba(197,165,114,.28);border-color:var(--kd-primary-dark)}\n.field{display:flex;flex-direction:column;gap:.3rem;margin:.75rem 0;font-size:.82rem;font-weight:650;color:var(--kd-navy)}\n.field input{border:1px solid var(--kd-border);border-radius:6px;padding:.45rem .6rem;font-size:.85rem;font-family:ui-monospace,monospace;background:var(--kd-bg);color:var(--kd-text)}\n.status{margin-top:.75rem;color:var(--kd-success,#2e7d32);font-weight:650;font-size:.85rem}\n.chat-log{margin:1rem 0;min-height:12rem;max-height:22rem;overflow:auto;border:1px solid var(--kd-border);border-radius:var(--kd-radius-md);padding:.75rem;background:var(--kd-bg)}\n.chat-msg{margin:.35rem 0;padding:.5rem .65rem;border-radius:8px;max-width:85%;font-size:.88rem;line-height:1.4}\n.chat-msg--user{background:var(--kd-primary);color:var(--kd-navy);margin-left:auto}\n.chat-msg--bot{background:var(--kd-surface);border:1px solid var(--kd-border);color:var(--kd-text)}\n.chat-form{display:flex;gap:.5rem}\n.chat-form input{flex:1;border:1px solid var(--kd-border);border-radius:999px;padding:.55rem .9rem;font-size:.9rem;background:var(--kd-bg);color:var(--kd-text)}\n`;
  }

  private buildJs(): string {
    return `/* Static export interactions */
(function () {
  document.querySelectorAll('[data-action="signout"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      alert('Sign out is a demo action in the static export.');
      window.location.href = 'index.html';
    });
  });

  // Settings tabs
  var tabs = document.querySelectorAll('.tab[data-tab]');
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var id = tab.getAttribute('data-tab');
      tabs.forEach(function (t) {
        t.classList.toggle('tab--active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      var business = document.getElementById('panel-business');
      var application = document.getElementById('panel-application');
      if (business && application) {
        business.hidden = id !== 'business';
        application.hidden = id !== 'application';
      }
    });
  });

  // Chips
  document.querySelectorAll('.chip-row').forEach(function (row) {
    row.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        row.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('chip--active'); });
        chip.classList.add('chip--active');
        var status = document.getElementById('settings-status');
        if (status) { status.hidden = false; }
      });
    });
  });

  function currentProtocol() {
    var active = document.querySelector('[data-protocol].chip--active');
    return active ? active.getAttribute('data-protocol') : 'http';
  }
  function composePreview(path) {
    var host = (document.getElementById('base-host') || {}).value || '';
    host = host.trim().replace(/\/+$/, '');
    var p = (path || '').trim();
    if (!p) return host ? currentProtocol() + '://' + host.replace(/^https?:\/\//i, '') : '';
    if (/^https?:\/\//i.test(p)) return p;
    if (p.charAt(0) !== '/') p = '/' + p;
    if (!host) return p;
    return currentProtocol() + '://' + host.replace(/^https?:\/\//i, '') + p;
  }
  function refreshPreviews() {
    document.querySelectorAll('.comp-path').forEach(function (input) {
      var key = input.getAttribute('data-key');
      var preview = document.querySelector('.comp-preview[data-key="' + key + '"]');
      if (preview) preview.textContent = composePreview(input.value) || input.value || '—';
    });
  }
  document.querySelectorAll('[data-protocol]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('[data-protocol]').forEach(function (b) { b.classList.remove('chip--active'); });
      btn.classList.add('chip--active');
      refreshPreviews();
    });
  });
  var baseHost = document.getElementById('base-host');
  if (baseHost) baseHost.addEventListener('input', refreshPreviews);
  document.querySelectorAll('.comp-path').forEach(function (input) {
    input.addEventListener('input', refreshPreviews);
  });
  var saveApp = document.querySelector('[data-action="save-app"]');
  if (saveApp) {
    saveApp.addEventListener('click', function () {
      var status = document.getElementById('settings-status');
      if (status) {
        status.hidden = false;
        status.textContent = 'Application configuration saved for this static demo.';
      }
      alert('Application configuration saved for this static demo.');
    });
  }

  // Chat
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');
  var log = document.getElementById('chat-log');
  if (form && input && log) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;
      appendMsg(text, 'user');
      input.value = '';
      setTimeout(function () {
        appendMsg('Demo reply: “' + text + '”. Connect this page to your chat API for production.', 'bot');
      }, 350);
    });
  }
  function appendMsg(text, role) {
    var el = document.createElement('div');
    el.className = 'chat-msg chat-msg--' + role;
    el.textContent = text;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
  }
})();
`;
  }

  private buildReadme(projectName: string, pathHint: string, theme: ThemeDefinition): string {
    return `# ${projectName}

Static HTML + CSS + JS export.

- **Path / name:** \`${pathHint || projectName}\`
- **Theme:** \`${theme.id}\` only
- **Not included:** Localization & Themes tab, Angular app, other themes

## Pages

| File | Purpose |
|------|---------|
| \`index.html\` | Home |
| \`chat.html\` | AI Chat (demo UI, works offline) |
| \`settings.html\` | Settings — Business & Application tabs only |
| \`css/theme.css\` | Selected theme tokens |
| \`js/app.js\` | Button / tab / chat behaviour |

## Why Chat & Settings work

They are **real linked pages** (\`chat.html\`, \`settings.html\`), not \`href="#\` placeholders.
Open via a local server if your browser blocks \`file://\` modules:

\`\`\`bash
npx serve .
\`\`\`
`;
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  private buildZip(files: Array<{ name: string; content: string }>): Blob {
    const encoder = new TextEncoder();
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;
    for (const file of files) {
      const nameBytes = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const crc = this.crc32(data);
      const local = new Uint8Array(30 + nameBytes.length + data.length);
      let o = 0;
      this.writeU32(local, o, 0x04034b50); o += 4;
      this.writeU16(local, o, 20); o += 2;
      this.writeU16(local, o, 0); o += 2;
      this.writeU16(local, o, 0); o += 2;
      this.writeU16(local, o, 0); o += 2;
      this.writeU16(local, o, 0); o += 2;
      this.writeU32(local, o, crc); o += 4;
      this.writeU32(local, o, data.length); o += 4;
      this.writeU32(local, o, data.length); o += 4;
      this.writeU16(local, o, nameBytes.length); o += 2;
      this.writeU16(local, o, 0); o += 2;
      local.set(nameBytes, o); o += nameBytes.length;
      local.set(data, o);
      parts.push(local);
      const cen = new Uint8Array(46 + nameBytes.length);
      let c = 0;
      this.writeU32(cen, c, 0x02014b50); c += 4;
      this.writeU16(cen, c, 20); c += 2;
      this.writeU16(cen, c, 20); c += 2;
      this.writeU16(cen, c, 0); c += 2;
      this.writeU16(cen, c, 0); c += 2;
      this.writeU16(cen, c, 0); c += 2;
      this.writeU16(cen, c, 0); c += 2;
      this.writeU32(cen, c, crc); c += 4;
      this.writeU32(cen, c, data.length); c += 4;
      this.writeU32(cen, c, data.length); c += 4;
      this.writeU16(cen, c, nameBytes.length); c += 2;
      this.writeU16(cen, c, 0); c += 2;
      this.writeU16(cen, c, 0); c += 2;
      this.writeU16(cen, c, 0); c += 2;
      this.writeU16(cen, c, 0); c += 2;
      this.writeU32(cen, c, 0); c += 4;
      this.writeU32(cen, c, offset); c += 4;
      cen.set(nameBytes, c);
      central.push(cen);
      offset += local.length;
    }
    const centralSize = central.reduce((n, a) => n + a.length, 0);
    const end = new Uint8Array(22);
    let e = 0;
    this.writeU32(end, e, 0x06054b50); e += 4;
    this.writeU16(end, e, 0); e += 2;
    this.writeU16(end, e, 0); e += 2;
    this.writeU16(end, e, files.length); e += 2;
    this.writeU16(end, e, files.length); e += 2;
    this.writeU32(end, e, centralSize); e += 4;
    this.writeU32(end, e, offset); e += 4;
    this.writeU16(end, e, 0);
    const out = new Uint8Array(offset + centralSize + end.length);
    let pos = 0;
    for (const p of parts) { out.set(p, pos); pos += p.length; }
    for (const p of central) { out.set(p, pos); pos += p.length; }
    out.set(end, pos);
    return new Blob([out], { type: 'application/zip' });
  }

  private writeU16(buf: Uint8Array, offset: number, value: number): void {
    buf[offset] = value & 0xff;
    buf[offset + 1] = (value >> 8) & 0xff;
  }
  private writeU32(buf: Uint8Array, offset: number, value: number): void {
    buf[offset] = value & 0xff;
    buf[offset + 1] = (value >> 8) & 0xff;
    buf[offset + 2] = (value >> 16) & 0xff;
    buf[offset + 3] = (value >> 24) & 0xff;
  }
  private crc32(data: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      crc ^= data[i];
      for (let j = 0; j < 8; j++) {
        const mask = -(crc & 1);
        crc = (crc >>> 1) ^ (0xedb88320 & mask);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}
