import { Component, HostListener, NgZone, computed, effect, inject } from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NifiAiService } from '../../../core/services/nifi-ai.service';
import { TranslatePipe } from '../../../core/i18n/translate.pipe';

@Component({
  selector: 'app-nifi-ai-modal',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './nifi-ai-modal.component.html',
  styleUrl: './nifi-ai-modal.component.scss'
})
export class NifiAiModalComponent {
  private readonly nifiAi = inject(NifiAiService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly zone = inject(NgZone);

  readonly open = this.nifiAi.overlayOpen;
  readonly enabled = this.nifiAi.enabled;

  /**
   * Sanitized iframe src, memoized as a computed() signal keyed only on
   * nifiAi.uiUrl(). This used to be a plain method called from the template
   * as [src]="frameSrc()", which re-ran on *every* Angular change-detection
   * cycle. Each run called sanitizer.bypassSecurityTrustResourceUrl(...)
   * again, and — even when the URL string was unchanged — that returns a
   * new wrapper object each time. Angular's [src] binding compares by
   * reference, so it saw a "new" value every cycle and reassigned
   * iframe.src, forcing the iframe to reload.
   *
   * That reload loop was self-sustaining: onFrameLoad() below attaches
   * scroll/resize listeners and a MutationObserver inside the iframe, and
   * those firing (inside Angular's zone) triggered more change-detection
   * cycles, which called frameSrc() again, which reloaded the iframe again
   * — producing the visible "blinking".
   *
   * computed() only recomputes when uiUrl() actually changes, so the
   * sanitized URL — and the iframe's src — now stays stable across
   * unrelated change-detection cycles.
   */
  readonly frameSrc = computed<SafeResourceUrl>(() => {
    const raw = this.nifiAi.uiUrl() || '/nifi-ai/?theme=kd';
    const joiner = raw.includes('?') ? '&' : '?';
    const url = raw.includes('theme=') ? raw : `${raw}${joiner}theme=kd`;
    return this.sanitizer.bypassSecurityTrustResourceUrl(url);
  });

  constructor() {
    // Ask only when NiFi AI is selected (overlay opens), not when the
    // hidden iframe first loads in the background.
    effect(() => {
      if (this.open()) {
        this.zone.runOutsideAngular(() => this.offerDefaultItems());
      } else {
        this.clearDefaultOffer();
      }
    });
  }

  close(): void {
    this.clearDefaultOffer();
    this.nifiAi.closeOverlay();
  }

  /**
   * The NiFi login form's password field is masked with no built-in
   * "show password" control, which makes it easy to mistype credentials
   * into a field you can't check. `/nifi-ai/` is proxied through this
   * app's own dev-server origin (see proxy.conf.mjs), so the iframed
   * document is same-origin and we can reach into it from here to add
   * one — this only works for that proxied path; a cross-origin
   * `directUiUrl` (bypassing the proxy) will throw on `contentDocument`
   * and is silently skipped below.
   */
  onFrameLoad(event: Event): void {
    const iframe = event.target as HTMLIFrameElement;
    let doc: Document | null = null;
    try {
      doc = iframe.contentDocument;
    } catch {
      // Cross-origin iframe — nothing we can do from the parent.
      return;
    }
    if (!doc) {
      return;
    }
    this.injectPasswordToggle(doc);
    this.injectSkillParamDialog(doc);
    if (this.open()) {
      this.offerDefaultItems();
    }
  }

  /**
   * NiFi AI was just selected. Ask once per open whether to replace the
   * lists with kd-nifi-items-default.json. The iframe installs the handler.
   */
  private offerDefaultItems(attempt = 0): void {
    const frame = document.querySelector('.nifi-ai-modal__frame') as HTMLIFrameElement | null;
    const offer = frame?.contentWindow as (Window & { __kdOfferDefaultItems?: () => void }) | null;
    if (offer && typeof offer.__kdOfferDefaultItems === 'function') {
      offer.__kdOfferDefaultItems();
      return;
    }
    if (attempt < 12) {
      window.setTimeout(() => this.offerDefaultItems(attempt + 1), 200);
    }
  }

  private clearDefaultOffer(): void {
    const frame = document.querySelector('.nifi-ai-modal__frame') as HTMLIFrameElement | null;
    const doc = frame?.contentDocument;
    if (doc) {
      delete doc.documentElement.dataset['kdDefaultOffer'];
    }
  }

  private injectPasswordToggle(doc: Document): void {
    const STYLE_ID = 'kd-nifi-pw-toggle-style';
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        .kd-pw-toggle-btn {
          position: absolute;
          z-index: 2147483647;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 15px;
          line-height: 1;
          padding: 4px 6px;
          opacity: 0.65;
        }
        .kd-pw-toggle-btn:hover { opacity: 1; }
      `;
      (doc.head || doc.documentElement).appendChild(style);
    }

    const reposition = (btn: HTMLElement, input: HTMLInputElement): void => {
      const rect = input.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        // Input not laid out yet (e.g. still hidden) — try again shortly.
        return;
      }
      const scrollX = doc.defaultView?.scrollX ?? 0;
      const scrollY = doc.defaultView?.scrollY ?? 0;
      btn.style.top = `${rect.top + scrollY + rect.height / 2 - 11}px`;
      btn.style.left = `${rect.right + scrollX - 28}px`;
    };

    const decorate = (input: HTMLInputElement): void => {
      if (input.dataset['kdPwToggleAttached']) {
        return;
      }
      input.dataset['kdPwToggleAttached'] = '1';

      // Apply the configured initial state (config/nifi-ai.json's
      // "hidePassword") before wiring up the toggle button, so a
      // false-configured environment shows the password as soon as the
      // form renders rather than only after the user clicks the eye icon.
      const startHidden = this.nifiAi.hidePassword();
      if (!startHidden) {
        input.type = 'text';
      }
      // Default NiFi login password for this demo environment.
      if (!input.value) {
        input.value = 'OpenText2026!';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }

      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'kd-pw-toggle-btn';
      btn.textContent = startHidden ? '👁' : '🙈';
      btn.title = 'Show/hide password';
      // Prevent the button from stealing focus off the input (and thus
      // blurring it) before the click handler runs.
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        const showing = input.type === 'text';
        input.type = showing ? 'password' : 'text';
        btn.textContent = showing ? '👁' : '🙈';
      });

      (doc.body || doc.documentElement).appendChild(btn);
      const onReposition = () => reposition(btn, input);
      onReposition();
      doc.defaultView?.addEventListener('resize', onReposition);
      doc.defaultView?.addEventListener('scroll', onReposition, true);
    };

    const scan = () => {
      doc.querySelectorAll('input[type="password"]').forEach((el) => decorate(el as HTMLInputElement));
    };

    this.zone.runOutsideAngular(() => {
      scan();
      // Login form is decorated once. A delayed second pass covers a late
      // paint; no ongoing observer so the iframe does not reconnect/loop.
      window.setTimeout(scan, 300);
    });
  }

  /**
   * Same-origin NiFi AI UI: reuse the "Complete SAP ingest" parameter-dialog
   * pattern for every skill, action, and template. Add controls live inside
   * their respective lists, and every object gets Edit and Delete controls.
   */
  private injectSkillParamDialog(doc: Document): void {
    const win = doc.defaultView;
    if (!win || doc.documentElement.dataset['kdParamDialog'] === '1') {
      return;
    }
    doc.documentElement.dataset['kdParamDialog'] = '1';

    const STYLE_ID = 'kd-nifi-param-style';
    if (!doc.getElementById(STYLE_ID)) {
      const style = doc.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        #kd-nifi-param-overlay {
          position: fixed; inset: 0; z-index: 2147483646;
          background: rgba(11, 44, 77, 0.5);
          backdrop-filter: blur(2px);
          display: flex; align-items: center; justify-content: center;
          padding: 1.25rem;
        }
        #kd-nifi-param-dialog,
        #kd-nifi-param-dialog.sap-dialog {
          width: min(640px, 94vw); max-height: 86vh;
          display: flex; flex-direction: column;
          background: #fff; color: #1a1a1a;
          border-radius: 12px; overflow: hidden;
          border: 1px solid #e2d9c8;
          box-shadow: 0 12px 40px rgba(11, 44, 77, 0.18);
          font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif;
        }
        #kd-nifi-param-dialog .kd-sap-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 1rem; min-height: 56px; padding: 0.7rem 1rem;
          background: #0b2c4d; color: #fff;
        }
        #kd-nifi-param-dialog .kd-sap-head h2 {
          margin: 0; font-size: 1.02rem; font-weight: 700;
        }
        #kd-nifi-param-dialog .kd-sap-head p {
          margin: 0.15rem 0 0; font-size: 0.72rem; color: rgba(255,255,255,.88);
        }
        #kd-nifi-param-dialog .kd-sap-x {
          width: 2.1rem; height: 2.1rem; border-radius: 999px;
          border: 1px solid rgba(255,255,255,.28);
          background: rgba(255,255,255,.12); color: #fff;
          font-size: 1.3rem; cursor: pointer;
        }
        #kd-nifi-param-dialog .kd-sap-accent {
          height: 3px;
          background: linear-gradient(90deg, #c5a572, #e0cfa3, #c5a572);
        }
        #kd-nifi-param-dialog .kd-param-body {
          padding: 0.95rem 1.15rem 0.4rem; overflow: auto; background: #f7f5f1;
        }
        #kd-nifi-param-dialog label {
          display: block; font-size: 0.78rem; font-weight: 600;
          margin: 0.6rem 0 0.25rem; color: #0b2c4d;
        }
        #kd-nifi-param-dialog input, #kd-nifi-param-dialog textarea {
          width: 100%; box-sizing: border-box;
          border: 1px solid #d7c9a8; border-radius: 8px;
          padding: 0.5rem 0.65rem; font: inherit; background: #fff;
        }
        #kd-nifi-param-dialog footer {
          display: flex; justify-content: flex-end; gap: 0.5rem;
          padding: 0.8rem 1.15rem 1rem; background: #fff;
          border-top: 1px solid #e2d9c8;
        }
        #kd-nifi-param-cancel, #kd-nifi-param-continue, .kd-nifi-add-btn {
          border-radius: 999px; padding: 0.42rem 1rem; cursor: pointer; font: inherit;
        }
        .kd-nifi-object-actions {
          display: inline-flex; align-items: center; gap: 0.25rem;
          margin-left: auto; padding-left: 0.5rem; flex-shrink: 0;
        }
        .kd-nifi-object-action {
          width: 28px; height: 28px; padding: 0;
          display: inline-flex; align-items: center; justify-content: center;
          border: 1px solid #d7c9a8; border-radius: 6px;
          background: #fff; color: #0b2c4d; cursor: pointer;
          font: 600 13px/1 Inter, "Segoe UI", Roboto, Arial, sans-serif;
        }
        .kd-nifi-object-action:hover { background: #f7f5f1; }
        .kd-nifi-object-action--delete { color: #a51d2d; }
        .kd-nifi-object-action:focus-visible, .kd-nifi-add-btn:focus-visible {
          outline: 2px solid #c5a572; outline-offset: 2px;
        }
        #kd-nifi-add-group {
          display: flex !important; flex-direction: column !important; gap: 0.35rem;
          margin: 0 0 0.65rem; padding: 0.4rem 0.45rem 0.55rem;
          border-bottom: 1px solid #e2d9c8;
          width: 100%; box-sizing: border-box;
          position: sticky; top: 0; z-index: 6;
          background: #f7f5f1;
        }
        #kd-nifi-add-group button.ghost,
        .kd-nifi-add-entry button.ghost {
          display: block; width: 100%; box-sizing: border-box; text-align: left;
        }
        #kd-nifi-io-all {
          display: flex !important; flex-wrap: wrap !important; gap: 0.35rem;
          margin: 0 !important; padding: 0.55rem 0.65rem 0.65rem;
          border-top: 1px solid #e2d9c8;
          box-sizing: border-box;
          position: fixed !important;
          left: 0; bottom: 0; top: auto;
          width: min(360px, 42vw);
          z-index: 2147483646 !important;
          background: #f7f5f1;
          box-shadow: 0 -8px 18px rgba(11, 44, 77, 0.12);
        }
        body.kd-nifi-io-pad {
          padding-bottom: 58px;
        }
        .kd-nifi-io-row {
          display: flex; flex-wrap: wrap; gap: 0.35rem;
          margin: 0.15rem 0 0.35rem;
        }
        .kd-nifi-io-btn {
          flex: 1 1 auto; min-width: 96px;
          border-radius: 999px; padding: 0.32rem 0.75rem; cursor: pointer;
          background: #fff; color: #0b2c4d; border: 1px solid #d7c9a8;
          font: 600 0.75rem/1.1 Inter, "Segoe UI", Roboto, Arial, sans-serif;
        }
        .kd-nifi-io-btn:hover { background: #f7f5f1; }
        .kd-nifi-io-btn--danger { color: #a51d2d; border-color: #d9a6ad; }
        .kd-nifi-io-btn--danger:hover { background: #fff1f2; }
        html.kd-nifi-ui-cleared .nav-section .side-btn:not([data-kd-add]),
        html.kd-nifi-ui-cleared .nav-section [data-prompt],
        html.kd-nifi-ui-cleared .nav-section [data-action],
        html.kd-nifi-ui-cleared .nav-section [data-skill],
        html.kd-nifi-ui-cleared .nav-section [data-template],
        html.kd-nifi-ui-cleared .kd-nifi-kind-list > :not(.kd-nifi-add-entry):not([data-kd-add]) {
          display: none !important;
        }
        .kd-nifi-io-file { display: none; }
        .nav-section {
          display: flex !important; flex-direction: column !important;
        }
        .nav-section > .nav-toggle {
          flex: 0 0 auto;
        }
        .kd-nifi-kind-list {
          display: flex; flex-direction: column; gap: 0.35rem;
          margin: auto 0 0; padding: 0.15rem 0.2rem 0.35rem;
          width: 100%; box-sizing: border-box;
          align-self: stretch;
          order: 99;
        }
        .nav-section > .kd-nifi-kind-list {
          margin-top: auto;
        }
        .nav-section:not(.open) > .kd-nifi-kind-list,
        .nav-toggle[aria-expanded="false"] ~ .kd-nifi-kind-list,
        [class*="nav-toggle"][aria-expanded="false"] ~ .kd-nifi-kind-list {
          display: none !important;
        }
        .kd-nifi-kind-list .side-btn,
        .kd-nifi-kind-list .kd-nifi-editable-entry {
          width: 100%; box-sizing: border-box;
        }
        #kd-nifi-prompt-wait {
          display: none; align-items: center; justify-content: center;
          gap: 0.65rem; margin: 0.45rem 0 0.2rem; padding: 0.55rem 0.4rem;
          pointer-events: none;
        }
        #kd-nifi-prompt-wait.is-on { display: flex; }
        #kd-nifi-prompt-wait .kd-wait {
          display: flex; flex-direction: column; align-items: center;
          justify-content: center; gap: 0.55rem;
        }
        #kd-nifi-prompt-wait .kd-wait__ring {
          width: 36px; height: 36px; box-sizing: border-box;
          border: 3px solid #e2d9c8; border-top-color: #0b2c4d;
          border-right-color: #c5a572; border-radius: 50%;
          animation: kd-wait-spin 0.85s linear infinite;
        }
        #kd-nifi-prompt-wait .kd-wait__dot {
          width: 7px; height: 7px; margin-top: -30px; border-radius: 50%;
          background: #c5a572; animation: kd-wait-pulse 0.85s ease-in-out infinite;
        }
        #kd-nifi-prompt-wait .kd-wait__label {
          margin: 0.2rem 0 0;
          font: 600 0.8rem/1.3 Inter, "Segoe UI", Roboto, Arial, sans-serif;
          color: #0b2c4d;
        }
        @keyframes kd-wait-spin { to { transform: rotate(360deg); } }
        @keyframes kd-wait-pulse {
          0%, 100% { opacity: 0.35; transform: scale(0.85); }
          50% { opacity: 1; transform: scale(1.15); }
        }
        .kd-nifi-editable-entry {
          position: relative;
        }
        .kd-nifi-editable-entry > .kd-nifi-object-actions {
          position: absolute; right: 0.4rem; top: 50%; transform: translateY(-50%);
        }
        #kd-nifi-param-cancel {
          background: #fff; border: 1px solid #cfc3a6; color: #0b2c4d;
        }
        #kd-nifi-param-continue {
          background: #0b2c4d; color: #fff; border: 1px solid #0b2c4d;
        }
        #kd-nifi-param-error {
          display: none; margin: 0 1.15rem 0.6rem;
          padding: 0.45rem 0.65rem; border-radius: 8px;
          background: #fdecec; color: #8f1d1d; border: 1px solid #f0b4b4;
          font-size: 0.8rem;
        }
        #kd-nifi-param-error.is-on { display: block; }
        #kd-nifi-param-dialog .is-missing {
          border-color: #c92a2a !important; background: #fff5f5;
        }
        #kd-nifi-msg-overlay {
          position: fixed; inset: 0; z-index: 2147483647;
          background: rgba(11, 44, 77, 0.5);
          backdrop-filter: blur(2px);
          display: flex; align-items: center; justify-content: center;
          padding: 1.25rem;
        }
        #kd-nifi-msg-dialog {
          width: min(420px, 94vw);
          display: flex; flex-direction: column;
          background: #fff; color: #1a1a1a;
          border-radius: 12px; overflow: hidden;
          border: 1px solid #e2d9c8;
          box-shadow: 0 12px 40px rgba(11, 44, 77, 0.18);
          font-family: Inter, "Segoe UI", Roboto, Arial, sans-serif;
        }
        #kd-nifi-msg-dialog .kd-sap-head {
          display: flex; align-items: center; justify-content: space-between;
          gap: 1rem; min-height: 48px; padding: 0.65rem 1rem;
          background: #0b2c4d; color: #fff;
        }
        #kd-nifi-msg-dialog .kd-sap-head h2 {
          margin: 0; font-size: 0.98rem; font-weight: 700;
        }
        #kd-nifi-msg-dialog .kd-sap-x {
          width: 2rem; height: 2rem; border-radius: 999px;
          border: 1px solid rgba(255,255,255,.28);
          background: rgba(255,255,255,.12); color: #fff;
          font-size: 1.25rem; cursor: pointer; flex-shrink: 0;
        }
        #kd-nifi-msg-dialog .kd-sap-accent {
          height: 3px;
          background: linear-gradient(90deg, #c5a572, #e0cfa3, #c5a572);
        }
        #kd-nifi-msg-dialog .kd-msg-body {
          padding: 1rem 1.15rem; background: #f7f5f1;
          font-size: 0.88rem; line-height: 1.4; color: #1a1a1a;
        }
        #kd-nifi-msg-dialog footer {
          display: flex; justify-content: flex-end; gap: 0.5rem;
          padding: 0.8rem 1.15rem 1rem; background: #fff;
          border-top: 1px solid #e2d9c8;
        }
        #kd-nifi-msg-cancel, #kd-nifi-msg-ok {
          border-radius: 999px; padding: 0.42rem 1rem; cursor: pointer; font: inherit;
        }
        #kd-nifi-msg-cancel {
          background: #fff; border: 1px solid #cfc3a6; color: #0b2c4d;
        }
        #kd-nifi-msg-ok {
          background: #0b2c4d; color: #fff; border: 1px solid #0b2c4d;
        }
        #kd-nifi-msg-ok.kd-nifi-msg-ok--danger {
          background: #a51d2d; border-color: #a51d2d;
        }
      `;
      (doc.head || doc.documentElement).appendChild(style);
    }

    const closeOverlay = (): void => {
      doc.getElementById('kd-nifi-param-overlay')?.remove();
    };

    const closeMessage = (): void => {
      doc.getElementById('kd-nifi-msg-overlay')?.remove();
    };

    /**
     * Inline replacement for window.alert()/window.confirm(). Native browser
     * dialogs are jarring inside an embedded iframe, get blocked by popup
     * managers in some hosts, and don't match the rest of this integration's
     * UI. Every alert/confirm in this file goes through here instead, as a
     * small in-page modal styled to match the existing param dialog.
     */
    const showMessage = (opts: {
      title?: string;
      message: string;
      confirmLabel?: string;
      cancelLabel?: string;
      danger?: boolean;
      onConfirm?: () => void;
    }): void => {
      closeMessage();
      const isConfirm = !!opts.onConfirm;
      const overlay = doc.createElement('div');
      overlay.id = 'kd-nifi-msg-overlay';
      const dialog = doc.createElement('div');
      dialog.id = 'kd-nifi-msg-dialog';
      dialog.setAttribute('role', isConfirm ? 'alertdialog' : 'alert');
      dialog.setAttribute('aria-modal', 'true');
      dialog.innerHTML = `
        <div class="kd-sap-head">
          <h2></h2>
          <button type="button" class="kd-sap-x" id="kd-nifi-msg-x" aria-label="Close">×</button>
        </div>
        <div class="kd-sap-accent"></div>
        <div class="kd-msg-body"></div>
        <footer>
          ${isConfirm ? '<button type="button" id="kd-nifi-msg-cancel"></button>' : ''}
          <button type="button" id="kd-nifi-msg-ok"></button>
        </footer>`;
      (dialog.querySelector('h2') as HTMLElement).textContent = opts.title || (isConfirm ? 'Confirm' : 'Notice');
      (dialog.querySelector('.kd-msg-body') as HTMLElement).textContent = opts.message;
      const okBtn = dialog.querySelector('#kd-nifi-msg-ok') as HTMLButtonElement;
      okBtn.textContent = opts.confirmLabel || 'OK';
      if (opts.danger) {
        okBtn.classList.add('kd-nifi-msg-ok--danger');
      }
      okBtn.addEventListener('click', () => {
        closeMessage();
        opts.onConfirm?.();
      });
      if (isConfirm) {
        const cancelBtn = dialog.querySelector('#kd-nifi-msg-cancel') as HTMLButtonElement;
        cancelBtn.textContent = opts.cancelLabel || 'Cancel';
        cancelBtn.addEventListener('click', closeMessage);
      }
      (dialog.querySelector('#kd-nifi-msg-x') as HTMLButtonElement).addEventListener('click', closeMessage);
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) {
          closeMessage();
        }
      });
      overlay.addEventListener('keydown', (ev) => {
        if ((ev as KeyboardEvent).key === 'Escape') {
          closeMessage();
        }
      });
      overlay.appendChild(dialog);
      (doc.body || doc.documentElement).appendChild(overlay);
      win.setTimeout(() => okBtn.focus(), 0);
    };

    const placeholders = (text: string): string[] => {
      const found = new Set<string>();
      for (const re of [
        /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g,
        /\$\{\s*([A-Za-z0-9_.-]+)\s*\}/g,
        /<<\s*([A-Za-z0-9_.-]+)\s*>>/g
      ]) {
        let match: RegExpExecArray | null;
        while ((match = re.exec(text))) {
          found.add(match[1]);
        }
      }
      return [...found];
    };

    /**
     * The three "+ Add ..." controls all use the embedded UI's own ghost
     * button markup, e.g. <button type="button" class="ghost" id="addTpl">
     * + Add template</button>. `data-kd-add` marks them so they can be told
     * apart from list entries now that they no longer carry a private class.
     */
    const isAddBtn = (el: Element | null | undefined): boolean =>
      !!el && ((el as HTMLElement).hasAttribute('data-kd-add') || (el as HTMLElement).id === 'addTpl');

    /**
     * `needs` is optional in the JSON, but the prompt itself declares its
     * parameters ({{name}}, ${name}, <<name>>). When `needs` is empty we
     * derive it from the prompt so an object saved with "needs": "" behaves
     * exactly like one saved with the list filled in.
     */
    const derivedNeeds = (needs: string | undefined, prompt: string | undefined): string =>
      (needs || '').trim() || placeholders(prompt || '').join(', ');

    const replaceTokens = (text: string, values: Record<string, string>): string =>
      text
        .replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, k) => values[k] ?? _)
        .replace(/\$\{\s*([A-Za-z0-9_.-]+)\s*\}/g, (_, k) => values[k] ?? _)
        .replace(/<<\s*([A-Za-z0-9_.-]+)\s*>>/g, (_, k) => values[k] ?? _);

    const promptComposer = (): HTMLTextAreaElement | HTMLInputElement | null =>
      doc.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea#input') ||
      doc.querySelector<HTMLTextAreaElement | HTMLInputElement>(
        'textarea[placeholder*="Ask to inspect" i], input[placeholder*="Ask to inspect" i], input[placeholder*="flow" i], input[name*="prompt" i]'
      ) ||
      doc.querySelector<HTMLTextAreaElement | HTMLInputElement>('textarea');

    const hidePromptWait = (): void => {
      doc.getElementById('kd-nifi-prompt-wait')?.classList.remove('is-on');
    };

    const showPromptWait = (): void => {
      let wait = doc.getElementById('kd-nifi-prompt-wait') as HTMLElement | null;
      if (!wait) {
        wait = doc.createElement('div');
        wait.id = 'kd-nifi-prompt-wait';
        wait.setAttribute('role', 'status');
        wait.setAttribute('aria-live', 'polite');
        wait.setAttribute('aria-label', 'Processing prompt');
        wait.innerHTML = `
          <div class="kd-wait">
            <span class="kd-wait__ring" aria-hidden="true"></span>
            <span class="kd-wait__dot" aria-hidden="true"></span>
            <p class="kd-wait__label">Processing prompt…</p>
          </div>`;
      }
      const box = promptComposer();
      const host: HTMLElement =
        (box?.closest('form, .composer, .chat, footer, [class*="composer"], [class*="prompt"]') as HTMLElement | null) ||
        (box?.parentElement as HTMLElement | null) ||
        (doc.body as HTMLElement);
      if (wait.parentElement !== host && host) {
        if (box && box.parentElement === host) {
          box.insertAdjacentElement('afterend', wait);
        } else {
          host.appendChild(wait);
        }
      }
      wait.classList.add('is-on');
      win.setTimeout(hidePromptWait, 120000);
    };

    const bindPromptWait = (): void => {
      const box = promptComposer();
      if (!box || box.dataset['kdPromptWait'] === '1') {
        return;
      }
      box.dataset['kdPromptWait'] = '1';
      box.addEventListener('keydown', (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'Enter' && !(event as KeyboardEvent).shiftKey && (box.value || '').trim()) {
          showPromptWait();
        }
      });
      const form = box.closest('form');
      form?.addEventListener('submit', () => {
        if ((box.value || '').trim()) {
          showPromptWait();
        }
      });
    };

    /**
     * Finds the page's own Send control. Tries, in order: a control whose
     * whole label is "Send"; any control whose label/id/class/title mentions
     * send/submit/run; the form's submit button; the last enabled button in the
     * composer's container. Our own buttons and the left-rail items are never
     * candidates.
     */
    const findSendControl = (box: HTMLElement): HTMLElement | null => {
      const excluded =
        '#kd-nifi-param-overlay, #kd-nifi-msg-overlay, #kd-nifi-io-all, #kd-nifi-add-group, .kd-nifi-kind-list, .kd-nifi-add-entry, .nav-section, .kd-nifi-object-actions';
      const all = Array.from(
        doc.querySelectorAll<HTMLElement>('button, [role="button"], input[type="submit"], input[type="button"]')
      ).filter((el) => !el.closest(excluded));
      const text = (el: HTMLElement): string =>
        `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${
          (el as HTMLInputElement).value || ''
        }`
          .replace(/\s+/g, ' ')
          .trim();
      const meta = (el: HTMLElement): string => `${el.id} ${typeof el.className === 'string' ? el.className : ''}`;
      const exact = all.find((el) => /^send$/i.test(text(el)));
      if (exact) {
        return exact;
      }
      const loose = all.find(
        (el) =>
          /send|submit|run prompt|ask|^[➤→↑▶⏎↵]$/i.test(text(el)) || /(^|[\s_-])(send|submit)([\s_-]|$)/i.test(meta(el))
      );
      if (loose) {
        return loose;
      }
      const scope =
        (box.closest('form, .composer, [class*="composer"], footer, [class*="input"], [class*="chat"]') as HTMLElement | null) ||
        box.parentElement;
      const inScope = scope ? all.filter((el) => scope.contains(el)) : [];
      return (
        inScope.find((el) => (el as HTMLButtonElement).type === 'submit') ||
        [...inScope].reverse().find((el) => !(el as HTMLButtonElement).disabled) ||
        null
      );
    };

    const pressEnter = (box: HTMLElement): void => {
      ['keydown', 'keypress', 'keyup'].forEach((type) => {
        box.dispatchEvent(
          new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true })
        );
      });
      const form = box.closest('form') as HTMLFormElement | null;
      if (form) {
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }
    };

    const fillComposerAndSend = (
      prompt: string,
      meta: { kind?: ObjectKind | null; name?: string; values?: Record<string, string> } = {}
    ): boolean => {
      const text = (prompt || '').trim();
      if (!text) {
        return false;
      }
      // Every executed item is an MCP request on the KD server, sent before
      // any DOM work so it is never lost if the composer is missing.
      notifyServerMcp('runObject', {
        kind: meta.kind || null,
        name: (meta.name || '').trim(),
        prompt: text,
        values: meta.values || {}
      });
      try {
        win.postMessage({ type: 'kd-nifi-ai', action: 'run-prompt', prompt: text }, '*');
        win.parent?.postMessage({ type: 'kd-nifi-ai', action: 'run-prompt', prompt: text }, '*');
      } catch {
        /* ignore */
      }
      const field = promptComposer();
      const editable = field
        ? null
        : (doc.querySelector('[contenteditable="true"], [contenteditable=""]') as HTMLElement | null);
      const box: HTMLElement | null = field || editable;
      if (!box) {
        return false;
      }
      if (field) {
        const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) {
          setter.call(field, text);
        } else {
          field.value = text;
        }
      } else {
        box.textContent = text;
      }
      box.dispatchEvent(new Event('input', { bubbles: true }));
      box.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      box.dispatchEvent(new Event('change', { bubbles: true }));
      box.focus();
      showPromptWait();

      // The page often enables Send only after it re-renders in response to
      // the input event, so a synchronous click hits a disabled button and
      // does nothing. Re-resolve the control and wait until it is enabled.
      const isDisabled = (el: HTMLElement): boolean =>
        (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';
      let tries = 0;
      const attempt = (): void => {
        const send = findSendControl(box);
        if (send && !isDisabled(send)) {
          send.click();
          return;
        }
        if (tries++ < 15) {
          win.setTimeout(attempt, 60);
          return;
        }
        if (send) {
          send.removeAttribute('disabled');
          send.setAttribute('aria-disabled', 'false');
          send.click();
          return;
        }
        pressEnter(box);
        try {
          win.postMessage({ type: 'kd-nifi-ai', action: 'run-prompt', prompt: text, force: true }, '*');
        } catch {
          /* ignore */
        }
      };
      attempt();
      return true;
    };

    /** The prompt text of an entry: its data-prompt, else the stored catalog prompt. */
    const sourcePromptFor = (card: HTMLElement, kind: ObjectKind | null): string => {
      const attr = (card.getAttribute('data-prompt') || '').trim();
      if (attr || !kind) {
        return attr;
      }
      const name = entryName(card, kind);
      return (name ? catalog[kind]?.get(name)?.prompt || '' : '').trim();
    };

    const objectRunPrompt = (card: HTMLElement, kind: ObjectKind | null, values: Record<string, string> = {}): string => {
      const attr = (card.getAttribute('data-prompt') || '').trim();
      const name = (
        (kind && card.getAttribute(`data-${kind}`)) ||
        card.getAttribute('data-action') ||
        card.getAttribute('data-skill') ||
        card.getAttribute('data-template') ||
        entryName(card, kind || 'action')
      ).trim();
      const stored = kind && name ? catalog[kind]?.get(name) : undefined;
      const raw = attr || stored?.prompt || '';
      if (raw.trim()) {
        return Object.keys(values).length ? replaceTokens(raw, values) : raw;
      }
      const description = stored?.description || (card.querySelector('small, .description, .desc')?.textContent || '').trim();
      const label = kind || 'object';
      return `Execute the NiFi ${label} "${name || 'item'}"${description ? `: ${description}` : ''}. Use the MCP tools to run this object's prompt and apply it to the current flow.`;
    };

    const runCreatedCard = (card: HTMLElement, values: Record<string, string> = {}): boolean => {
      const kind = sectionKindFor(card);
      const prompt = objectRunPrompt(card, kind, values);
      if (!prompt.trim()) {
        return false;
      }
      const unresolved = placeholders(prompt);
      if (unresolved.length) {
        // Tokens are still in the text (no values supplied). Ask for them
        // instead of sending "{{sourcePath}}" literally to the composer.
        openDialog({
          title: entryName(card, kind || 'action') || 'Run object',
          subtitle: 'Fill the parameters, then Continue to send this prompt to the MCP server.',
          sourceText: prompt,
          params: unresolved,
          mode: 'run',
          kind: kind || undefined
        });
        return true;
      }
      card.setAttribute('data-prompt', prompt);
      return fillComposerAndSend(prompt, { kind, name: entryName(card, kind || 'action'), values });
    };

    const applyValues = (values: Record<string, string>): void => {
      const fields = doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
        'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea'
      );
      for (const field of Array.from(fields)) {
        const key = (field.name || field.id || field.getAttribute('placeholder') || '').trim();
        for (const [param, value] of Object.entries(values)) {
          if (key && key.toLowerCase().includes(param.toLowerCase())) {
            field.value = value;
            field.dispatchEvent(new Event('input', { bubbles: true }));
            field.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      }
      const promptBox = doc.querySelector<HTMLElement>(
        'textarea, input[name*="prompt" i], [contenteditable="true"]'
      );
      if (promptBox && Object.keys(values).length) {
        const replaceTokens = (text: string): string =>
          text
            .replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, k) => values[k] ?? _)
            .replace(/\$\{\s*([A-Za-z0-9_.-]+)\s*\}/g, (_, k) => values[k] ?? _)
            .replace(/<<\s*([A-Za-z0-9_.-]+)\s*>>/g, (_, k) => values[k] ?? _);
        if (promptBox instanceof HTMLTextAreaElement || promptBox instanceof HTMLInputElement) {
          promptBox.value = replaceTokens(promptBox.value || '');
          promptBox.dispatchEvent(new Event('input', { bubbles: true }));
        } else {
          promptBox.textContent = replaceTokens(promptBox.textContent || '');
        }
      }
    };

    type DialogMode = 'run' | 'create' | 'edit';

    /**
     * Left-panel section a card or Add control belongs to.
     *
     * @example ObjectKind
     * const kind: ObjectKind = 'action';
     * function sectionTitle(kind: ObjectKind): string {
     *   if (kind === 'action') return 'Actions';
     *   if (kind === 'skill') return 'Skills';
     *   return 'Templates';
     * }
     * sectionTitle(kind); // 'Actions'
     * const all: ObjectKind[] = ['action', 'skill', 'template'];
     */
    type ObjectKind = 'skill' | 'action' | 'template';

    /**
     * Label for the Add control under a section heading.
     *
     * @example AddLabelFor
     * const addLabelFor: AddLabelFor = (kind) => {
     *   if (kind === 'action') return '+ Add Action';
     *   if (kind === 'skill') return '+ Add Skill';
     *   return '+ Add template';
     * };
     * addLabelFor('action');   // '+ Add Action'
     * addLabelFor('skill');    // '+ Add Skill'
     * addLabelFor('template'); // '+ Add template'
     */
    type AddLabelFor = (kind: ObjectKind) => string;

    /**
     * Place (or reuse) the Add button at the bottom of one section list.
     *
     * @example EnsureKindAddControl
     * const ensureKindAddControl: EnsureKindAddControl = (host, kind) => {
     *   const label = addLabelFor(kind);
     *   let btn = host.querySelector<HTMLElement>(`.kd-nifi-add-btn[data-kind="${kind}"]`);
     *   if (!btn) {
     *     btn = document.createElement('button');
     *     btn.type = 'button';
     *     btn.className = 'kd-nifi-add-btn';
     *     btn.dataset['kind'] = kind;
     *     btn.textContent = label;
     *     host.appendChild(btn);
     *   }
     * };
     * const actionsHost = document.querySelector('[data-kd-add-host="action"]') as HTMLElement;
     * ensureKindAddControl(actionsHost, 'action');
     */
    type EnsureKindAddControl = (host: HTMLElement, kind: ObjectKind) => void;

    /**
     * Resolve the left-panel list for a kind (`[data-kd-add-host]`).
     *
     * @example HostForKind
     * const hostForKind: HostForKind = (kind) => {
     *   const tagged = document.querySelector(`[data-kd-add-host="${kind}"]`);
     *   return (tagged as HTMLElement | null) ?? document.body;
     * };
     * const actionsList = hostForKind('action');
     * const skillsList = hostForKind('skill');
     * const templatesList = hostForKind('template');
     */
    type HostForKind = (kind: ObjectKind) => HTMLElement;

    /**
     * Insert a newly saved card into its section, above that section's Add button.
     *
     * @example InsertCreatedIntoSection
     * const insertCreatedIntoSection: InsertCreatedIntoSection = (created, kind) => {
     *   const host = hostForKind(kind);
     *   const addBtn = host.querySelector<HTMLElement>('.kd-nifi-add-btn');
     *   if (addBtn) {
     *     addBtn.insertAdjacentElement('beforebegin', created);
     *     return;
     *   }
     *   host.appendChild(created);
     * };
     * const card = document.createElement('button');
     * card.className = 'side-btn';
     * card.setAttribute('data-skill', 'Summarize contract');
     * insertCreatedIntoSection(card, 'skill');
     */
    type InsertCreatedIntoSection = (created: HTMLElement, kind: ObjectKind) => void;

    /**
     * Re-scan Actions / Skills / Templates and refresh Add controls + cards.
     *
     * @example EnsureAddButtons
     * const ensureAddButtons: EnsureAddButtons = () => {
     *   (['action', 'skill', 'template'] as ObjectKind[]).forEach((kind) => {
     *     const host = hostForKind(kind);
     *     host.setAttribute('data-kd-add-host', kind);
     *     ensureKindAddControl(host, kind);
     *   });
     * };
     * // After Save: insert the card, then refresh the matching left-panel list.
     * insertCreatedIntoSection(card, 'action');
     * ensureAddButtons();
     */
    type EnsureAddButtons = () => void;

    /**
     * Serializable action / skill / template card.
     *
     * @example ObjectPayload
     * const payload: ObjectPayload = {
     *   kind: 'skill',
     *   name: 'Summarize contract',
     *   description: 'Short summary of a legal doc',
     *   prompt: 'Summarize {{Document}}',
     *   needs: 'Document'
     * };
     */
    type ObjectPayload = {
      kind: ObjectKind;
      name: string;
      description: string;
      prompt: string;
      needs: string;
    };

    /**
     * File wrapper written by Export / Export all.
     *
     * @example ObjectBundle
     * const bundle: ObjectBundle = {
     *   version: 1,
     *   kind: 'action',
     *   objects: [{ kind: 'action', name: 'SAP ingest', description: '', prompt: '', needs: '' }]
     * };
     */
    type ObjectBundle = {
      version: 1;
      kind: ObjectKind | 'all';
      objects: ObjectPayload[];
      exportedAt?: string;
    };

    const findAddTpl = (): HTMLElement | null =>
      (doc.querySelector('#addTpl, [id="addTpl"], [data-id="addTpl"], .addTpl') as HTMLElement | null) ||
      (Array.from(doc.querySelectorAll('button, a, [role="button"]')).find((el) =>
        /^\+\s*add\s+template$/i.test((el.textContent || '').replace(/\s+/g, ' ').trim())
      ) as HTMLElement | undefined) ||
      null;

    const makeSideBtn = (spec: {
      kind: ObjectKind;
      name: string;
      description: string;
      prompt: string;
      needs: string;
    }): HTMLButtonElement => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'side-btn';
      btn.setAttribute(
        'data-prompt',
        spec.prompt?.trim() ||
          `Execute the NiFi ${spec.kind} "${spec.name}"${
            spec.description ? `: ${spec.description}` : ''
          }. Use the MCP tools to run this object's prompt and apply it to the current flow.`
      );
      if (spec.kind === 'action') {
        btn.setAttribute('data-action', spec.name);
      } else if (spec.kind === 'skill') {
        btn.setAttribute('data-skill', spec.name);
      } else {
        btn.setAttribute('data-template', spec.name);
      }
      // Persist the "Needs" list as a real, machine-readable attribute
      // (comma-separated — collectParams() falls back to splitting on
      // [,;|] when the value isn't JSON) so that clicking this card later
      // is able to find its declared parameters via collectParams(). The
      // `.need` span below is display-only text for the user; without this
      // attribute the card's params were silently lost as soon as the
      // dialog closed, and clicking the card again never re-opened the
      // parameter popup even though "Needs" had been filled in.
      if (spec.needs) {
        btn.setAttribute('data-params', spec.needs);
      }
      btn.dataset['kdCreated'] = '1';
      btn.dataset['kdRunnable'] = '1';
      const title = doc.createElement('span');
      title.textContent = spec.name;
      btn.appendChild(title);
      if (spec.description.trim()) {
        const sub = doc.createElement('small');
        sub.textContent = spec.description.trim();
        btn.appendChild(sub);
      }
      const needs = spec.needs.replace(/^needs:\s*/i, '').trim();
      if (needs) {
        const need = doc.createElement('span');
        need.className = 'need';
        need.textContent = `Needs: ${needs}`;
        btn.appendChild(need);
      }
      bindObjectClick(btn, spec.kind);
      return btn;
    };

    const chromeName = (name: string): boolean => {
      const t = name.replace(/\s+/g, ' ').trim();
      if (!t) {
        return true;
      }
      if (/^(actions?|skills?|templates?|template flows?)(\s+\d+)?$/i.test(t)) {
        return true;
      }
      if (/^\+\s*(add|import|export|refresh)/i.test(t)) {
        return true;
      }
      if (/^(import|export|refresh|clear all|add action|add skill|add template)$/i.test(t)) {
        return true;
      }
      return false;
    };

    const entryName = (entry: HTMLElement, kind: ObjectKind): string => {
      const attr =
        entry.getAttribute(`data-${kind}`) ||
        entry.getAttribute('data-name') ||
        entry.getAttribute('data-title') ||
        entry.getAttribute('title') ||
        '';
      const titleEl = entry.querySelector(
        '.side-btn__title, .title, .name, strong, b, span:not(.need):not(.kd-nifi-object-action)'
      ) as HTMLElement | null;
      let text = (attr || titleEl?.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) {
        const clone = entry.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('.kd-nifi-object-actions, .need, small').forEach((n) => n.remove());
        text = (clone.textContent || '').replace(/\s+/g, ' ').trim();
      }
      return text;
    };

    const objectPayloadFromEntry = (entry: HTMLElement, kind: ObjectKind): ObjectPayload => {
      const name = entryName(entry, kind);
      const description = (entry.querySelector('small, .description, .desc')?.textContent || '').trim();
      const prompt = (entry.getAttribute('data-prompt') || '').trim();
      const needs = derivedNeeds(entry.getAttribute('data-params') || '', prompt);
      return { kind, name, description, prompt, needs };
    };

    const slugName = (name: string): string =>
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'object';

    const downloadJson = (filename: string, data: unknown): void => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = doc.createElement('a');
      link.href = url;
      link.download = filename;
      (doc.body || doc.documentElement).appendChild(link);
      (link as HTMLAnchorElement).click();
      link.remove();
      URL.revokeObjectURL(url);
    };

    const exportObject = (entry: HTMLElement, kind: ObjectKind): void => {
      const payload = objectPayloadFromEntry(entry, kind);
      const bundle: ObjectBundle = { version: 1, kind, objects: [payload] };
      downloadJson(`kd-${kind}-${slugName(payload.name)}.json`, bundle);
    };

    const ENTRY_SELECTOR =
      '.side-btn, [data-prompt], [data-template], [data-action], [data-skill], [data-name], li, [role="listitem"], a.nav-item, .nav-item, button, [role="button"]';

    const isChromeEntry = (el: HTMLElement): boolean => {
      if (
        isAddBtn(el) ||
        el.classList.contains('kd-nifi-add-entry') ||
        el.classList.contains('kd-nifi-io-btn') ||
        el.classList.contains('kd-nifi-io-row') ||
        el.classList.contains('nav-toggle') ||
        /\bnav-toggle\b/.test(typeof el.className === 'string' ? el.className : '')
      ) {
        return true;
      }
      if (
        el.closest(
          '#kd-nifi-add-group, #kd-nifi-io-all, .kd-nifi-io-row, .kd-nifi-object-actions, #kd-nifi-param-overlay, .nav-toggle, [class*="nav-toggle"]'
        )
      ) {
        return true;
      }
      return chromeName((el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40));
    };

    const gatherEntries = (root: ParentNode, kind: ObjectKind): HTMLElement[] => {
      const out: HTMLElement[] = [];
      const seen = new Set<HTMLElement>();
      const consider = (el: Element | null): void => {
        if (!el || !(el instanceof HTMLElement)) {
          return;
        }
        if (seen.has(el)) {
          return;
        }
        if (el.classList.contains('kd-nifi-kind-list') || el.getAttribute('data-kd-add-host')) {
          Array.from(el.children).forEach((child) => consider(child));
          return;
        }
        if (el.matches('ul, ol, nav, section, div') && el.querySelector(ENTRY_SELECTOR)) {
          Array.from(el.children).forEach((child) => consider(child));
          return;
        }
        if (isChromeEntry(el)) {
          return;
        }
        const name = entryName(el, kind);
        if (!name || chromeName(name) || headingKind(name)) {
          return;
        }
        seen.add(el);
        out.push(el);
      };
      root.querySelectorAll<HTMLElement>(ENTRY_SELECTOR).forEach((el) => consider(el));
      if (root instanceof HTMLElement) {
        Array.from(root.children).forEach((child) => consider(child));
      }
      return out;
    };

    const asHtmlElement = (el: Element | null | undefined): HTMLElement | null => {
      if (!el) {
        return null;
      }
      return el instanceof HTMLElement ? el : (el as HTMLElement);
    };

    const listSectionObjects = (host: Element, kind: ObjectKind): ObjectPayload[] => {
      const root = asHtmlElement(host);
      if (!root) {
        return [];
      }
      const out: ObjectPayload[] = [];
      const seen = new Set<string>();
      gatherEntries(root, kind).forEach((el) => {
        const payload = objectPayloadFromEntry(el, kind);
        if (!payload.name || chromeName(payload.name) || seen.has(payload.name)) {
          return;
        }
        seen.add(payload.name);
        out.push(payload);
      });
      return out;
    };

    const sectionForKind = (kind: ObjectKind): HTMLElement | null => {
      for (const sec of allNavSections()) {
        const toggle = sec.querySelector<HTMLElement>(
          '.nav-toggle, [class*="nav-toggle"], button, summary, [role="button"]'
        );
        const raw = (
          toggle?.getAttribute('aria-label') ||
          toggle?.textContent ||
          ''
        )
          .replace(/\s+/g, ' ')
          .trim();
        if (headingKind(raw) === kind) {
          return sec;
        }
        for (const el of Array.from(sec.querySelectorAll<HTMLElement>('button, summary, h2, h3, h4, label'))) {
          const label = (el.textContent || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
          if (label.length <= 28 && headingKind(label) === kind && isRailHeading(el, label)) {
            return sec;
          }
        }
      }
      const heads = headingEls();
      for (const heading of heads) {
        if (headingKind((heading.textContent || '').replace(/\s+/g, ' ').trim()) === kind) {
          return (heading.closest('.nav-section, [class*="nav-section"]') as HTMLElement | null) || sectionRow(heading);
        }
      }
      return null;
    };

    const parkSectionEntries = (host: HTMLElement, kind: ObjectKind): void => {
      const section: HTMLElement | null =
        asHtmlElement(host.closest('.nav-section, [class*="nav-section"]')) || sectionForKind(kind);
      const roots: ParentNode[] = [host];
      if (section && section !== host) {
        roots.push(section);
      }
      const parked = new Set<HTMLElement>();
      roots.forEach((root) => {
        gatherEntries(root, kind).forEach((el) => {
          if (parked.has(el) || host.contains(el)) {
            return;
          }
          if (el === host || el.contains(host)) {
            return;
          }
          parked.add(el);
          host.appendChild(el);
        });
      });
    };

    const listAllKindObjects = (kind: ObjectKind): ObjectPayload[] => {
      const host = hostForKind(kind);
      parkSectionEntries(host, kind);
      const section: HTMLElement =
        asHtmlElement(host.closest('.nav-section, [class*="nav-section"]')) ||
        sectionForKind(kind) ||
        host;
      const out: ObjectPayload[] = [];
      const seen = new Set<string>();
      const add = (payload: ObjectPayload): void => {
        const name = (payload.name || '').trim();
        if (!name || chromeName(name) || seen.has(name)) {
          return;
        }
        seen.add(name);
        out.push({ ...payload, name });
      };
      listSectionObjects(host, kind).forEach(add);
      if (section !== host) {
        listSectionObjects(section as HTMLElement, kind).forEach(add);
      }
      const heads = headingEls();
      const idx = heads.findIndex(
        (heading) => headingKind((heading.textContent || '').replace(/\s+/g, ' ').trim()) === kind
      );
      if (idx >= 0) {
        const start = sectionRow(heads[idx]);
        const end = heads[idx + 1] ? sectionRow(heads[idx + 1]) : null;
        let node: HTMLElement | null = asHtmlElement(start.nextElementSibling);
        while (node && node !== end) {
          if (node.id !== 'kd-nifi-add-group' && node.id !== 'kd-nifi-io-all') {
            listSectionObjects(node as HTMLElement, kind).forEach(add);
          }
          node = asHtmlElement(node.nextElementSibling);
        }
      }
      return out;
    };

    const exportSection = (host: HTMLElement, kind: ObjectKind): void => {
      const objects = listSectionObjects(host, kind);
      const bundle: ObjectBundle = { version: 1, kind, objects };
      downloadJson(`kd-${kind}s.json`, bundle);
    };

    const parseImported = (raw: unknown, fallbackKind: ObjectKind): ObjectPayload[] => {
      const asPayload = (item: unknown): ObjectPayload | null => {
        if (!item || typeof item !== 'object') {
          return null;
        }
        const rec = item as Record<string, unknown>;
        const kind: ObjectKind =
          rec['kind'] === 'skill' || rec['kind'] === 'action' || rec['kind'] === 'template'
            ? rec['kind']
            : fallbackKind;
        const name = String(rec['name'] ?? rec['title'] ?? '').trim();
        if (!name) {
          return null;
        }
        return {
          kind,
          name,
          description: String(rec['description'] ?? ''),
          prompt: String(rec['prompt'] ?? ''),
          needs: String(rec['needs'] ?? rec['params'] ?? '')
        };
      };
      if (Array.isArray(raw)) {
        return raw.map(asPayload).filter((p): p is ObjectPayload => p !== null);
      }
      if (raw && typeof raw === 'object' && Array.isArray((raw as ObjectBundle).objects)) {
        return (raw as ObjectBundle).objects.map(asPayload).filter((p): p is ObjectPayload => p !== null);
      }
      const one = asPayload(raw);
      return one ? [one] : [];
    };

    const SAVED_KEY = 'kd-nifi-saved-objects';
    const CLEARED_FLAG = 'kd-nifi-ui-cleared';
    const TOMBSTONE_KEY = 'kd-nifi-cleared-objects';

    const loadSaved = (): ObjectPayload[] => {
      try {
        const raw = win.localStorage.getItem(SAVED_KEY);
        if (!raw) {
          return [];
        }
        return parseImported(JSON.parse(raw), 'action');
      } catch {
        return [];
      }
    };

    const writeSaved = (items: ObjectPayload[]): void => {
      try {
        win.localStorage.setItem(SAVED_KEY, JSON.stringify(items));
      } catch {
        /* ignore quota */
      }
    };

    const upsertSaved = (payload: ObjectPayload): void => {
      const normalized = {
        ...payload,
        name: payload.name.replace(/\s+/g, ' ').trim(),
        description: payload.description?.trim() || '',
        prompt: payload.prompt?.trim() || '',
        needs: payload.needs?.trim() || ''
      };
      const key = objectKey(normalized.kind, normalized.name);
      const items = loadSaved().filter((item) => objectKey(item.kind, item.name) !== key);
      items.push(normalized);
      writeSaved(items);
    };

    const removeSaved = (kind: ObjectKind, name: string): void => {
      const key = objectKey(kind, name);
      writeSaved(loadSaved().filter((item) => objectKey(item.kind, item.name) !== key));
      [...catalog[kind].keys()].forEach((keyName) => {
        if (sameName(keyName, name)) {
          catalog[kind].delete(keyName);
        }
      });
    };

    const catalog: Record<ObjectKind, Map<string, ObjectPayload>> = {
      action: new Map(),
      skill: new Map(),
      template: new Map()
    };

    const rememberObject = (payload: ObjectPayload): void => {
      const name = (payload.name || '').replace(/\s+/g, ' ').trim();
      if (!name || name.length > 80 || chromeName(name) || headingKind(name)) {
        return;
      }
      if (isTombstoned(payload.kind, name)) {
        return;
      }
      const kind = payload.kind;
      let existingName: string | null = null;
      catalog[kind].forEach((_value, key) => {
        if (sameName(key, name)) {
          existingName = key;
        }
      });
      const prev = existingName ? catalog[kind].get(existingName) : undefined;
      if (existingName && existingName !== name) {
        catalog[kind].delete(existingName);
      }
      catalog[kind].set(name, {
        ...prev,
        ...payload,
        name,
        prompt: payload.prompt?.trim() || prev?.prompt || '',
        description: payload.description?.trim() || prev?.description || '',
        needs: payload.needs?.trim() || prev?.needs || ''
      });
    };

    const allCatalogObjects = (): ObjectPayload[] =>
      (['action', 'skill', 'template'] as ObjectKind[]).flatMap((kind) => [...catalog[kind].values()]);

    const persistCatalog = (): void => {
      if (isUiCleared()) {
        writeSaved([]);
        return;
      }
      const merged = allCatalogObjects();
      loadSaved().forEach((item) => {
        if (isTombstoned(item.kind, item.name)) {
          return;
        }
        if (!catalog[item.kind] || ![...catalog[item.kind].keys()].some((name) => sameName(name, item.name))) {
          merged.push(item);
        }
      });
      writeSaved(merged.filter((item) => !isTombstoned(item.kind, item.name)));
    };

    const hydrateCatalog = (): void => {
      if (isUiCleared()) {
        (['action', 'skill', 'template'] as ObjectKind[]).forEach((kind) => catalog[kind].clear());
        return;
      }
      loadSaved().forEach((item) => {
        if (!isTombstoned(item.kind, item.name)) {
          rememberObject(item);
        }
      });
    };

    const kindFromContext = (el: HTMLElement): ObjectKind | null => {
      const tagged = el.closest('[data-kd-add-host]') as HTMLElement | null;
      const fromHost = tagged?.getAttribute('data-kd-add-host');
      if (fromHost === 'action' || fromHost === 'skill' || fromHost === 'template') {
        return fromHost;
      }
      if (el.getAttribute('data-action')) {
        return 'action';
      }
      if (el.getAttribute('data-skill')) {
        return 'skill';
      }
      if (el.getAttribute('data-template')) {
        return 'template';
      }
      let node: HTMLElement | null = el;
      for (let i = 0; i < 18 && node; i += 1) {
        const label = (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32);
        const asKind = headingKind(label);
        if (asKind && (node.classList.contains('nav-toggle') || /\bnav-toggle\b/.test(node.className) || node.classList.contains('nav-section'))) {
          return asKind;
        }
        let prev = node.previousElementSibling as HTMLElement | null;
        while (prev) {
          const prevLabel = (prev.getAttribute('aria-label') || prev.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 32);
          const prevKind = headingKind(prevLabel);
          if (prevKind) {
            return prevKind;
          }
          prev = prev.previousElementSibling as HTMLElement | null;
        }
        node = node.parentElement;
      }
      return null;
    };

    let skipDomSnapshot = false;
    let listObserver: MutationObserver | null = null;
    const pauseListObserver = (): void => {
      listObserver?.disconnect();
    };
    const resumeListObserver = (): void => {
      listObserver?.observe(doc.documentElement, { childList: true, subtree: true });
    };
    const isUiCleared = (): boolean => {
      try {
        return win.localStorage.getItem(CLEARED_FLAG) === '1';
      } catch {
        return false;
      }
    };
    const setUiCleared = (on: boolean): void => {
      try {
        if (on) {
          win.localStorage.setItem(CLEARED_FLAG, '1');
        } else {
          win.localStorage.removeItem(CLEARED_FLAG);
        }
      } catch {
        /* ignore quota */
      }
      doc.documentElement.classList.toggle('kd-nifi-ui-cleared', on);
      doc.body?.classList.toggle('kd-nifi-ui-cleared', on);
    };
    const snapshotDomObjects = (): void => {
      if (skipDomSnapshot || isUiCleared()) {
        return;
      }
      hydrateCatalog();
      const take = (el: HTMLElement, kind: ObjectKind): void => {
        if (isChromeEntry(el)) {
          return;
        }
        const payload = objectPayloadFromEntry(el, kind);
        if (isTombstoned(kind, payload.name)) {
          return;
        }
        rememberObject(payload);
      };
      const toggles = Array.from(
        doc.querySelectorAll<HTMLElement>('.nav-toggle, [class*="nav-toggle"], button, summary, [role="button"]')
      ).filter((el) => {
        const raw = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
        return !!headingKind(raw) && raw.length <= 32;
      });
      toggles.forEach((toggle, index) => {
        const raw = (toggle.getAttribute('aria-label') || toggle.textContent || '').replace(/\s+/g, ' ').trim();
        const kind = headingKind(raw);
        if (!kind) {
          return;
        }
        const parent = toggle.parentElement;
        if (parent && parent !== doc.body) {
          gatherEntries(parent, kind).forEach((el) => take(el, kind));
        }
        const stop = toggles[index + 1] || null;
        let sib: HTMLElement | null = toggle.nextElementSibling as HTMLElement | null;
        while (sib && sib !== stop) {
          gatherEntries(sib, kind).forEach((el) => take(el, kind));
          take(sib, kind);
          sib = sib.nextElementSibling as HTMLElement | null;
        }
      });
      (['action', 'skill', 'template'] as ObjectKind[]).forEach((kind) => {
        doc.querySelectorAll<HTMLElement>(`[data-${kind}], [data-kd-add-host="${kind}"]`).forEach((el) => {
          if (el.getAttribute('data-kd-add-host') === kind) {
            gatherEntries(el, kind).forEach((item) => take(item, kind));
            return;
          }
          take(el, kind);
        });
        const section = sectionForKind(kind);
        if (section) {
          gatherEntries(section, kind).forEach((el) => take(el, kind));
        }
        const host = doc.querySelector(`[data-kd-add-host="${kind}"]`) as HTMLElement | null;
        if (host) {
          gatherEntries(host, kind).forEach((el) => take(el, kind));
        }
      });
      doc.querySelectorAll<HTMLElement>('[data-prompt], .side-btn, [data-name]').forEach((el) => {
        const kind = kindFromContext(el);
        if (kind) {
          take(el, kind);
        }
      });
      doc.querySelectorAll('*').forEach((el) => {
        const shadow = (el as HTMLElement).shadowRoot;
        if (!shadow) {
          return;
        }
        shadow.querySelectorAll<HTMLElement>('[data-prompt], [data-action], [data-skill], [data-template], .side-btn, button, li').forEach((item) => {
          const kind = kindFromContext(item) || kindFromContext(el as HTMLElement);
          if (kind) {
            take(item, kind);
          }
        });
      });
      persistCatalog();
    };

    const collectKindEntries = (kind: ObjectKind): HTMLElement[] => {
      const roots: ParentNode[] = [];
      const host = doc.querySelector(`[data-kd-add-host="${kind}"]`) as HTMLElement | null;
      const section = sectionForKind(kind);
      if (host) {
        roots.push(host);
      }
      if (section && section !== host) {
        roots.push(section);
      }
      const rail = leftNavigator();
      if (rail) {
        roots.push(rail);
      }
      const seen = new Set<HTMLElement>();
      const out: HTMLElement[] = [];
      roots.forEach((root) => {
        gatherEntries(root, kind).forEach((el) => {
          if (seen.has(el)) {
            return;
          }
          seen.add(el);
          out.push(el);
        });
      });
      return out;
    };

    const normKey = (value: string): string =>
      value.replace(/\s+/g, ' ').trim().toLocaleLowerCase();

    const sameName = (a: string, b: string): boolean => normKey(a) === normKey(b);

    const objectKey = (kind: ObjectKind, name: string): string => `${kind}:${normKey(name)}`;

    const loadTombstones = (): Set<string> => {
      try {
        const raw = JSON.parse(win.localStorage.getItem(TOMBSTONE_KEY) || '[]') as unknown;
        return new Set(Array.isArray(raw) ? raw.map((item) => String(item)) : []);
      } catch {
        return new Set();
      }
    };
    const writeTombstones = (keys: Set<string>): void => {
      try {
        win.localStorage.setItem(TOMBSTONE_KEY, JSON.stringify([...keys]));
      } catch {
        /* ignore quota */
      }
    };
    const isTombstoned = (kind: ObjectKind, name: string): boolean =>
      !!name && loadTombstones().has(objectKey(kind, name));
    const addTombstones = (keys: string[]): void => {
      const set = loadTombstones();
      keys.forEach((key) => set.add(key));
      writeTombstones(set);
    };
    const forgetTombstone = (kind: ObjectKind, name: string): void => {
      const set = loadTombstones();
      set.delete(objectKey(kind, name));
      writeTombstones(set);
    };
    const clearTombstones = (): void => {
      try {
        win.localStorage.removeItem(TOMBSTONE_KEY);
      } catch {
        /* ignore */
      }
    };

    /**
     * "Import" must be authoritative: for every kind present in the
     * imported JSON, the visible list must contain exactly those objects —
     * nothing carried over from whatever the embedded UI had natively.
     * `importPayloads()` already removes (and tombstones) every entry it can
     * see in the DOM at the moment of import, but the embedded UI is a
     * separate app that can redraw its own native entries afterward
     * (MutationObserver ticks, a section expanding, its own re-render) —
     * entries our one-time removal sweep never had a chance to see, so they
     * were never tombstoned. This standing per-kind allow-list closes that
     * gap: once a kind is import-locked, ensureAddButtons() strips anything
     * whose name isn't on the list, on every pass, until Refresh explicitly
     * lifts the lock (same lifecycle as the Clear all lock).
     */
    const IMPORT_LOCK_KEY = 'kd-nifi-import-lock';
    const loadImportLocks = (): Partial<Record<ObjectKind, string[]>> => {
      try {
        const raw = JSON.parse(win.localStorage.getItem(IMPORT_LOCK_KEY) || '{}') as unknown;
        return raw && typeof raw === 'object' ? (raw as Partial<Record<ObjectKind, string[]>>) : {};
      } catch {
        return {};
      }
    };
    const writeImportLocks = (locks: Partial<Record<ObjectKind, string[]>>): void => {
      try {
        win.localStorage.setItem(IMPORT_LOCK_KEY, JSON.stringify(locks));
      } catch {
        /* ignore quota */
      }
    };
    const setImportLock = (kind: ObjectKind, names: Iterable<string>): void => {
      const locks = loadImportLocks();
      locks[kind] = [...new Set([...names].map((name) => normKey(name)))];
      writeImportLocks(locks);
    };
    const clearImportLock = (kind: ObjectKind): void => {
      const locks = loadImportLocks();
      if (kind in locks) {
        delete locks[kind];
        writeImportLocks(locks);
      }
    };
    const clearAllImportLocks = (): void => {
      try {
        win.localStorage.removeItem(IMPORT_LOCK_KEY);
      } catch {
        /* ignore */
      }
    };
    const isImportLocked = (kind: ObjectKind): boolean => Array.isArray(loadImportLocks()[kind]);
    const isAllowedByImportLock = (kind: ObjectKind, name: string): boolean => {
      const allowed = loadImportLocks()[kind];
      return !Array.isArray(allowed) || allowed.includes(normKey(name));
    };
    const rememberImportLockAddition = (kind: ObjectKind, name: string): void => {
      const locks = loadImportLocks();
      const allowed = locks[kind];
      if (!Array.isArray(allowed)) {
        return;
      }
      const key = normKey(name);
      if (!allowed.includes(key)) {
        allowed.push(key);
        writeImportLocks(locks);
      }
    };
    const forgetImportLockName = (kind: ObjectKind, name: string): void => {
      const locks = loadImportLocks();
      const allowed = locks[kind];
      if (!Array.isArray(allowed)) {
        return;
      }
      const key = normKey(name);
      const next = allowed.filter((item) => item !== key);
      if (next.length !== allowed.length) {
        locks[kind] = next;
        writeImportLocks(locks);
      }
    };

    const notifyServerClearAll = (objects: ObjectPayload[]): void => {
      const body = {
        method: 'clearAllObjects',
        action: 'clear-all',
        kinds: ['action', 'skill', 'template'] as ObjectKind[],
        count: objects.length,
        objects: objects.map((item) => ({ kind: item.kind, name: item.name })),
        at: new Date().toISOString()
      };
      const headers = {
        'Content-Type': 'application/json',
        'X-KD-Nifi-Method': 'clearAllObjects'
      };
      const urls = ['/api/admin/nifi-ai/clear-all', '/api/nifi-ai/clear-all'];
      try {
        const parentOrigin = win.parent?.location?.origin;
        if (parentOrigin && parentOrigin !== win.location.origin) {
          urls.unshift(`${parentOrigin}/api/admin/nifi-ai/clear-all`);
        }
      } catch {
        /* ignore cross-origin parent */
      }
      urls.forEach((url) => {
        try {
          win.fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            keepalive: true
          }).catch(() => undefined);
        } catch {
          /* ignore */
        }
      });
      try {
        win.parent?.postMessage(
          { type: 'kd-nifi-ai', action: 'clear-all', method: 'clearAllObjects', body },
          '*'
        );
      } catch {
        /* ignore */
      }
    };

    /**
     * Report a user action to the KD server as an MCP `tools/call` request.
     * The server (admin-config-api, POST /api/admin/nifi-ai/mcp) logs it as
     * `[KD][NiFi AI] mcp request ... name=<method>` and forwards it to the
     * NiFi AI MCP endpoint. This is deliberately independent of the embedded
     * page's DOM, so a Run click or a Refresh always reaches the server even
     * when the composer / Send button cannot be found.
     *
     * One request per call. Only if the network call itself fails do we fall
     * back to asking the parent Angular app to send it.
     */
    const notifyServerMcp = (
      method: 'runObject' | 'refreshObjects' | 'addObject' | 'deleteObject' | 'listObjects' | 'clearAllObjects',
      args: Record<string, unknown> = {}
    ): void => {
      const body = { method, ...args, at: new Date().toISOString() };
      const viaParent = (): void => {
        try {
          win.parent?.postMessage({ type: 'kd-nifi-ai', action: 'mcp', method, body }, '*');
        } catch {
          /* ignore */
        }
      };
      try {
        win
          .fetch('/api/admin/nifi-ai/mcp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-KD-Nifi-Method': method },
            body: JSON.stringify(body),
            keepalive: true
          })
          .then(async (r: Response) => {
            const info = (await r.json().catch(() => ({}))) as { error?: string; reply?: string };
            if (!r.ok) {
              // eslint-disable-next-line no-console
              console.warn(`[KD][NiFi AI] ${method} not accepted (HTTP ${r.status}): ${info.error || 'see admin API log'}`);
              showMessage({ message: info.error || `${method} was not executed (HTTP ${r.status}).` });
              return;
            }
            if (info.reply) {
              showMessage({ message: info.reply });
            }
          })
          .catch(viaParent);
      } catch {
        viaParent();
      }
    };

    const findAllEntriesByName = (kind: ObjectKind, name: string): HTMLElement[] => {
      const out: HTMLElement[] = [];
      const seen = new Set<HTMLElement>();
      const consider = (el: HTMLElement | null | undefined): void => {
        if (!el || seen.has(el)) {
          return;
        }
        if (
          el.id === 'kd-nifi-io-all' ||
          el.id === 'kd-nifi-add-group' ||
          isAddBtn(el) ||
          el.classList.contains('kd-nifi-add-entry')
        ) {
          return;
        }
        const attr = el.getAttribute(`data-${kind}`) || '';
        const labeled = entryName(el, kind);
        if (sameName(attr, name) || sameName(labeled, name)) {
          seen.add(el);
          out.push(el);
        }
      };
      collectKindEntries(kind).forEach(consider);
      doc.querySelectorAll<HTMLElement>(`[data-${kind}], [data-kd-created="1"], .side-btn, .kd-nifi-editable-entry`).forEach(consider);
      return out;
    };

    const findEntryByName = (kind: ObjectKind, name: string): HTMLElement | null =>
      findAllEntriesByName(kind, name)[0] || null;

    const dedupeKindLists = (): void => {
      (['action', 'skill', 'template'] as ObjectKind[]).forEach((kind) => {
        const seen = new Set<string>();
        findAllEntriesByName(kind, '').forEach(() => undefined);
        const entries = [
          ...collectKindEntries(kind),
          ...Array.from(doc.querySelectorAll<HTMLElement>(`[data-${kind}]`))
        ];
        const unique: HTMLElement[] = [];
        const seenEl = new Set<HTMLElement>();
        entries.forEach((el) => {
          if (seenEl.has(el)) {
            return;
          }
          seenEl.add(el);
          unique.push(el);
        });
        unique.forEach((el) => {
          const name = (el.getAttribute(`data-${kind}`) || entryName(el, kind) || '').replace(/\s+/g, ' ').trim();
          if (!name || chromeName(name)) {
            return;
          }
          const key = normKey(name);
          if (seen.has(key)) {
            el.remove();
            return;
          }
          seen.add(key);
        });
      });
    };

    const isProtectedChrome = (el: HTMLElement): boolean => {
      if (
        el.id === 'kd-nifi-io-all' ||
        el.id === 'kd-nifi-add-group' ||
        el.id === 'kd-nifi-param-overlay' ||
        el.id === 'kd-nifi-param-dialog' ||
        el.classList.contains('kd-nifi-add-entry') ||
        isAddBtn(el) ||
        el.classList.contains('kd-nifi-io-btn') ||
        el.classList.contains('kd-nifi-io-row') ||
        el.classList.contains('nav-toggle') ||
        /\bnav-toggle\b/.test(typeof el.className === 'string' ? el.className : '')
      ) {
        return true;
      }
      if (el.closest('#kd-nifi-io-all, #kd-nifi-add-group, #kd-nifi-param-overlay, .kd-nifi-io-row')) {
        return true;
      }
      const label = (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim();
      return !!headingKind(label) && label.length <= 28;
    };

    const countKindObjects = (kind: ObjectKind): number => {
      if (isUiCleared()) {
        return 0;
      }
      const names = new Set<string>();
      const take = (value: string): void => {
        const name = value.replace(/\s+/g, ' ').trim();
        if (!name || chromeName(name) || headingKind(name)) {
          return;
        }
        names.add(normKey(name));
      };
      collectKindEntries(kind).forEach((el) => take(entryName(el, kind)));
      catalog[kind].forEach((_payload, name) => take(name));
      doc.querySelectorAll<HTMLElement>(`[data-${kind}]`).forEach((el) => {
        take(el.getAttribute(`data-${kind}`) || entryName(el, kind));
      });
      return names.size;
    };

    /**
     * Some embedded NiFi AI skins show the per-section total as a separate
     * round "badge" element next to the heading (e.g. a small filled circle
     * containing just a number) instead of folding the count into the
     * heading's own text ("Actions 3"). The regex-based `rewrite()` below
     * only ever touches text nodes that contain the ACTIONS/SKILLS/TEMPLATES
     * word, so a sibling/child element whose entire text is just a bare
     * number is invisible to it and is left showing a stale total after
     * Clear all, Delete, Import, etc. This walks the heading itself plus its
     * immediate row (parent's direct children) for any leaf element whose
     * full text is a plain integer and rewrites it directly.
     */
    const updateHeadingBadge = (heading: HTMLElement, count: number): void => {
      const isBadgeEl = (el: HTMLElement): boolean => {
        if (el === heading || el.children.length) {
          return false;
        }
        return /^\d+$/.test((el.textContent || '').trim());
      };
      const toggle = (heading.closest('.nav-toggle, [class*="nav-toggle"]') as HTMLElement | null) || heading;
      const rowSiblings = Array.from(toggle.parentElement?.children || []).filter(
        (el): el is HTMLElement => el instanceof HTMLElement && el !== toggle
      );
      [...Array.from(toggle.querySelectorAll<HTMLElement>('*')), ...rowSiblings].forEach((el) => {
        if (isBadgeEl(el)) {
          el.textContent = String(count);
        }
      });
    };

    const updateKindCounts = (): void => {
      const labelFor = (kind: ObjectKind): string =>
        kind === 'action' ? 'ACTIONS' : kind === 'skill' ? 'SKILLS' : 'TEMPLATES';
      // The section label carries NO number ("ACTIONS", not "ACTIONS 16"):
      // the only total shown is the one inside the round badge, which
      // updateHeadingBadge() keeps in sync.
      const rewrite = (value: string, kind: ObjectKind, _count: number): string => {
        const title = labelFor(kind);
        const next = value
          .replace(/\bACTION\b(?!S)/g, 'ACTIONS')
          .replace(/\b(ACTIONS|SKILLS|TEMPLATES|TEMPLATE FLOWS)\b(\s*\d+)?/gi, title);
        return next;
      };
      headingEls().forEach((heading) => {
        const raw = (heading.textContent || heading.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const kind = headingKind(raw);
        if (!kind) {
          return;
        }
        const count = countKindObjects(kind);
        const walk = (node: Node): void => {
          if (node.nodeType === 3) {
            const text = node.textContent || '';
            const next = rewrite(text, kind, count);
            if (next !== text) {
              node.textContent = next;
            }
            return;
          }
          node.childNodes.forEach(walk);
        };
        walk(heading);
        ['aria-label', 'title'].forEach((attr) => {
          const current = heading.getAttribute(attr);
          if (current) {
            heading.setAttribute(attr, rewrite(current, kind, count));
          }
        });
        updateHeadingBadge(heading, count);
      });
    };

    const zeroKindCounts = (): void => {
      updateKindCounts();
    };

    const wipeSectionList = (root: HTMLElement | null): void => {
      if (!root) {
        return;
      }
      const victims: HTMLElement[] = [];
      const consider = (el: Element): void => {
        if (!(el instanceof HTMLElement)) {
          return;
        }
        if (isProtectedChrome(el)) {
          return;
        }
        if (el.classList.contains('kd-nifi-kind-list') || el.getAttribute('data-kd-add-host')) {
          Array.from(el.children).forEach(consider);
          return;
        }
        if (el.matches('ul, ol, nav') && el.querySelector('.side-btn, [data-prompt], [data-action], [data-skill], [data-template], li, button')) {
          Array.from(el.children).forEach(consider);
          return;
        }
        victims.push(el);
      };
      Array.from(root.children).forEach(consider);
      root
        .querySelectorAll<HTMLElement>(
          '.side-btn, [data-prompt], [data-action], [data-skill], [data-template], [data-name], [role="listitem"], a.nav-item, .nav-item'
        )
        .forEach((el) => {
          if (!isProtectedChrome(el) && !victims.includes(el)) {
            victims.push(el);
          }
        });
      victims.forEach((el) => {
        if (el.isConnected) {
          el.remove();
        }
      });
    };

    const wipeUiObjectLists = (): void => {
      (['action', 'skill', 'template'] as ObjectKind[]).forEach((kind) => {
        collectKindEntries(kind).forEach((el) => {
          if (!isProtectedChrome(el)) {
            el.remove();
          }
        });
        const host = doc.querySelector(`[data-kd-add-host="${kind}"]`) as HTMLElement | null;
        wipeSectionList(host);
        wipeSectionList(sectionForKind(kind));
      });
      const rail = leftNavigator();
      if (rail) {
        rail.querySelectorAll<HTMLElement>('.nav-section, [class*="nav-section"]').forEach((section) => {
          const toggle = section.querySelector<HTMLElement>('.nav-toggle, [class*="nav-toggle"], button, summary');
          const raw = (toggle?.getAttribute('aria-label') || toggle?.textContent || '').replace(/\s+/g, ' ').trim();
          if (headingKind(raw)) {
            wipeSectionList(section);
          }
        });
      }
      zeroKindCounts();
    };

    const clearListedObjects = (): void => {
      wipeUiObjectLists();
    };

    const sortKindLists = (): void => {
      (['action', 'skill', 'template'] as ObjectKind[]).forEach((kind) => {
        const host = hostForKind(kind);
        const items = gatherEntries(host, kind);
        items.sort((a, b) =>
          entryName(a, kind).localeCompare(entryName(b, kind), undefined, { numeric: true, sensitivity: 'base' })
        );
        items.forEach((el) => host.appendChild(el));
      });
    };

    const bindObjectClick = (el: HTMLElement, kind: ObjectKind): void => {
      if (el.dataset['kdObjectClickBound'] === '1') {
        return;
      }
      el.dataset['kdObjectClickBound'] = '1';
      el.addEventListener('click', (ev) => {
        const target = ev.target as HTMLElement | null;
        if (target?.closest('.kd-nifi-object-actions')) {
          return;
        }
        const runnable = el.dataset['kdCreated'] === '1' || el.dataset['kdRunnable'] === '1';
        if (!runnable) {
          return;
        }
        ev.preventDefault();
        ev.stopPropagation();
        const sourceText = sourcePromptFor(el, kind);
        const params = collectParams(el, sourceText, kind);
        if (params.length) {
          openDialog({
            title: entryName(el, kind) || 'Run object',
            subtitle: 'Fill the parameters, then Continue to send this prompt to the MCP server.',
            sourceText,
            params,
            mode: 'run',
            kind
          });
          return;
        }
        if (!runCreatedCard(el)) {
          showMessage({
            message: 'This item could not be run: the prompt box of the NiFi AI page was not found.'
          });
        }
      });
    };

    /**
     * Canonical object mutation pipeline.
     *
     * Every persisted object creation, import, and reload restore must pass
     * through this function. It removes every DOM duplicate first, updates
     * the catalog and localStorage once, creates one canonical card, and
     * binds its behavior once.
     */
    const upsertObject = (payload: ObjectPayload): HTMLButtonElement => {
      const normalized: ObjectPayload = {
        kind: payload.kind,
        name: payload.name.replace(/\s+/g, ' ').trim(),
        description: payload.description?.trim() || '',
        prompt: payload.prompt?.trim() || '',
        needs: derivedNeeds(payload.needs, payload.prompt)
      };
      if (!normalized.name) {
        throw new Error(`Cannot create an unnamed ${normalized.kind}.`);
      }

      setUiCleared(false);
      forgetTombstone(normalized.kind, normalized.name);
      const key = objectKey(normalized.kind, normalized.name);

      // Remove every matching DOM representation, including duplicates that
      // may have been created by older versions of the integration.
      findAllEntriesByName(normalized.kind, normalized.name).forEach((entry) => entry.remove());

      // Keep the in-memory catalog and persistent store in lock-step.
      [...catalog[normalized.kind].keys()].forEach((name) => {
        if (sameName(name, normalized.name)) {
          catalog[normalized.kind].delete(name);
        }
      });
      rememberObject(normalized);
      const saved = loadSaved().filter((item) => objectKey(item.kind, item.name) !== key);
      saved.push(normalized);
      writeSaved(saved);
      rememberImportLockAddition(normalized.kind, normalized.name);

      const created = makeSideBtn(normalized);
      enhanceObject(created, normalized.kind);
      bindObjectClick(created, normalized.kind);
      insertCreatedIntoSection(created, normalized.kind);
      updateKindCounts();
      // Persist on the NiFi AI orchestrator so the item survives a reload of
      // either package and so a later click can run it via MCP runObject.
      notifyServerMcp('addObject', {
        kind: normalized.kind,
        name: normalized.name,
        title: normalized.name,
        description: normalized.description,
        prompt: normalized.prompt,
        needs: normalized.needs
      });
      return created;
    };

    /**
     * Canonical object deletion pipeline. DOM, catalog, and localStorage
     * are updated together, using the same normalized identity key.
     */
    const removeObject = (kind: ObjectKind, name: string): void => {
      const key = objectKey(kind, name);
      findAllEntriesByName(kind, name).forEach((entry) => entry.remove());
      [...catalog[kind].keys()].forEach((catalogName) => {
        if (sameName(catalogName, name)) {
          catalog[kind].delete(catalogName);
        }
      });
      writeSaved(loadSaved().filter((item) => objectKey(item.kind, item.name) !== key));
      addTombstones([key]);
      forgetImportLockName(kind, name);
      updateKindCounts();
      notifyServerMcp('deleteObject', { kind, name, title: name });
    };

    /**
     * Canonical bulk deletion pipeline. Every object is deleted through the
     * same removeObject() path used by the per-object Delete control. This
     * keeps the embedded DOM, in-memory catalog, and localStorage consistent.
     */
    const clearAllObjects = (): void => {
      const kinds: ObjectKind[] = ['action', 'skill', 'template'];
      const namesByKind = new Map<ObjectKind, string[]>();
      const removed: ObjectPayload[] = [];
      skipDomSnapshot = true;
      pauseListObserver();

      kinds.forEach((kind) => {
        const names = new Map<string, string>();
        collectKindEntries(kind).forEach((entry) => {
          const name = entryName(entry, kind);
          if (name) {
            names.set(objectKey(kind, name), name);
          }
        });
        catalog[kind].forEach((payload, name) => {
          names.set(objectKey(kind, name), name);
          removed.push(payload);
        });
        loadSaved()
          .filter((item) => item.kind === kind)
          .forEach((item) => {
            names.set(objectKey(kind, item.name), item.name);
            removed.push(item);
          });
        listAllKindObjects(kind).forEach((item) => {
          names.set(objectKey(kind, item.name), item.name);
          removed.push(item);
        });
        namesByKind.set(kind, [...names.values()]);
      });

      namesByKind.forEach((names, kind) => {
        names.forEach((name) => removeObject(kind, name));
      });
      clearListedObjects();

      kinds.forEach((kind) => {
        catalog[kind].clear();
      });
      writeSaved([]);
      const tombstoneKeys: string[] = [];
      namesByKind.forEach((names, kind) => {
        names.forEach((name) => tombstoneKeys.push(objectKey(kind, name)));
      });
      addTombstones(tombstoneKeys);
      clearAllImportLocks();
      setUiCleared(true);
      notifyServerClearAll(
        [...new Map(removed.map((item) => [objectKey(item.kind, item.name), item])).values()]
      );

      refreshAllLists(true);
      wipeUiObjectLists();
      win.setTimeout(() => {
        wipeUiObjectLists();
        skipDomSnapshot = isUiCleared();
        resumeListObserver();
      }, 500);
    };

    const renderCatalogIntoLists = (forceReplace = false): void => {
      (['action', 'skill', 'template'] as ObjectKind[]).forEach((kind) => {
        const host = hostForKind(kind);
        const sorted = [...catalog[kind].values()].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );
        sorted.forEach((payload) => {
          const matches = findAllEntriesByName(kind, payload.name);
          if (forceReplace) {
            matches.forEach((el) => el.remove());
          } else if (matches.length) {
            const keep = matches[0];
            matches.slice(1).forEach((el) => el.remove());
            if (payload.prompt) {
              keep.setAttribute('data-prompt', payload.prompt);
            }
            keep.setAttribute(`data-${kind}`, payload.name);
            enhanceObject(keep, kind);
            bindObjectClick(keep, kind);
            if (keep.parentElement !== host) {
              host.appendChild(keep);
            }
            return;
          }
          const created = makeSideBtn(payload);
          enhanceObject(created, kind);
          bindObjectClick(created, kind);
          host.appendChild(created);
        });
      });
      sortKindLists();
    };

    const importPayloads = (payloads: ObjectPayload[], fallbackKind: ObjectKind): void => {
      // Import is an authoritative synchronization operation. For every kind
      // represented in the JSON file, the resulting list must contain exactly
      // the objects from that JSON section. It must not behave like an append.
      skipDomSnapshot = true;
      pauseListObserver();
      setUiCleared(false);
      try {
        const wanted = new Map<string, ObjectPayload>();
        const importedKinds = new Set<ObjectKind>();

        payloads.forEach((payload) => {
          const kind = payload.kind || fallbackKind;
          const name = (payload.name || '').replace(/\s+/g, ' ').trim();
          if (!name) {
            return;
          }
          importedKinds.add(kind);

          // JSON is authoritative. Empty description, prompt, or needs values
          // intentionally clear the previous value instead of inheriting it.
          const normalized: ObjectPayload = {
            kind,
            name,
            description: payload.description?.trim() || '',
            prompt: payload.prompt?.trim() || '',
            needs: payload.needs?.trim() || ''
          };
          wanted.set(objectKey(kind, name), normalized);
        });

        // First remove everything in the affected kinds that is not present
        // in the imported JSON. Do this before upserting so there is never a
        // transient duplicate and so stale catalog/localStorage entries are
        // removed as well. Do not restrict this to kdCreated: synchronization
        // must make the visible list match the file exactly.
        importedKinds.forEach((kind) => {
          const existingNames = new Set<string>();
          collectKindEntries(kind).forEach((entry) => {
            const name = entryName(entry, kind);
            if (name) {
              existingNames.add(name);
            }
          });
          [...catalog[kind].keys()].forEach((name) => existingNames.add(name));
          loadSaved()
            .filter((item) => item.kind === kind)
            .forEach((item) => existingNames.add(item.name));
          existingNames.forEach((name) => removeObject(kind, name));
          catalog[kind].clear();
          const host = doc.querySelector(`[data-kd-add-host="${kind}"]`) as HTMLElement | null;
          wipeSectionList(host);
          wipeSectionList(sectionForKind(kind));
        });
        if (!importedKinds.size) {
          wipeUiObjectLists();
        }

        // Lock every imported kind to exactly the names from this file. Any
        // entry that shows up later with a name outside this list — including
        // native entries the embedded UI redraws on its own — gets stripped
        // by ensureAddButtons() until Refresh lifts the lock.
        importedKinds.forEach((kind) => {
          const names = [...wanted.values()].filter((payload) => payload.kind === kind).map((payload) => payload.name);
          setImportLock(kind, names);
        });

        // Then create or replace every object from the JSON file through the
        // same canonical pipeline used by manual creation and restore.
        wanted.forEach((payload) => upsertObject(payload));

        // Re-render from the synchronized catalog without taking another DOM
        // snapshot. A snapshot here would re-import stale third-party DOM
        // entries that the synchronization just removed.
        refreshAllLists(true);
        dedupeKindLists();
        wanted.forEach((payload) => expandKind(payload.kind));
        updateKindCounts();
      } finally {
        win.setTimeout(() => {
          skipDomSnapshot = false;
          dedupeKindLists();
          updateKindCounts();
          resumeListObserver();
        }, 600);
      }
    };

    const openDialog = (opts: {
      title: string;
      subtitle: string;
      sourceText: string;
      params: string[];
      mode: DialogMode;
      kind?: ObjectKind;
      editTarget?: HTMLElement;
      resume?: () => void;
    }): void => {
      closeOverlay();
      const overlay = doc.createElement('div');
      overlay.id = 'kd-nifi-param-overlay';
      const dialog = doc.createElement('div');
      dialog.id = 'kd-nifi-param-dialog';
      dialog.className = 'sap-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      const isCreate = opts.mode === 'create';
      const isEdit = opts.mode === 'edit';
      dialog.innerHTML = `
        <div class="kd-sap-head">
          <div>
            <h2></h2>
            <p></p>
          </div>
          <button type="button" class="kd-sap-x" id="kd-nifi-param-x" aria-label="Close">×</button>
        </div>
        <div class="kd-sap-accent"></div>
        <div class="kd-param-body"></div>
        <div id="kd-nifi-param-error" role="alert"></div>
        <footer>
          <button type="button" class="app-btn" id="kd-nifi-param-cancel">Cancel</button>
          <button type="button" class="app-btn app-btn--primary" id="kd-nifi-param-continue">Continue</button>
        </footer>`;
      (dialog.querySelector('h2') as HTMLElement).textContent = opts.title;
      (dialog.querySelector('.kd-sap-head p') as HTMLElement).textContent = opts.subtitle;
      const body = dialog.querySelector('.kd-param-body') as HTMLElement;

      const addField = (name: string, kind: 'input' | 'textarea', value = ''): void => {
        const lab = doc.createElement('label');
        lab.textContent = name;
        const field = doc.createElement(kind === 'textarea' ? 'textarea' : 'input') as
          | HTMLInputElement
          | HTMLTextAreaElement;
        if (field instanceof HTMLInputElement) {
          field.type = 'text';
        } else {
          field.rows = 5;
        }
        field.name = name;
        field.dataset['kdParam'] = name;
        field.placeholder = name;
        field.value = value;
        if (name !== 'Description') {
          field.required = true;
        }
        body.appendChild(lab);
        body.appendChild(field);
      };

      if (isCreate || isEdit) {
        const target = opts.editTarget;
        const currentName = target
          ? (target.getAttribute('data-skill') || target.getAttribute('data-action') || target.getAttribute('data-template') || '').trim()
          : '';
        const currentDescription = target?.querySelector('small')?.textContent?.trim() || '';
        const currentNeeds = target?.getAttribute('data-params') || '';
        addField('Name', 'input', currentName);
        addField('Description', 'input', currentDescription);
        addField('Prompt', 'textarea', opts.sourceText);
        addField('Needs', 'input', currentNeeds || opts.params.join(', '));
      } else {
        const names = opts.params.length ? opts.params : [];
        if (!names.length && opts.sourceText) {
          addField('Prompt', 'textarea', opts.sourceText);
        } else if (!names.length) {
          addField('input', 'input');
        } else {
          for (const name of names) {
            addField(name, 'input');
          }
        }
      }

      overlay.appendChild(dialog);
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) {
          closeOverlay();
        }
      });
      (doc.body || doc.documentElement).appendChild(overlay);

      const dismiss = (ev: Event) => {
        ev.preventDefault();
        ev.stopPropagation();
        closeOverlay();
      };
      dialog.querySelector('#kd-nifi-param-cancel')?.addEventListener('click', dismiss);
      dialog.querySelector('#kd-nifi-param-x')?.addEventListener('click', dismiss);
      dialog.querySelector('#kd-nifi-param-continue')?.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const values: Record<string, string> = {};
        const missing: string[] = [];
        const errorBox = dialog.querySelector('#kd-nifi-param-error') as HTMLElement | null;
        dialog.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-kd-param]').forEach((el) => {
          const key = el.dataset['kdParam'] || el.name;
          const value = (el.value || '').trim();
          values[key] = value;
          el.classList.remove('is-missing');
          const optional = key === 'Description' || key === 'Needs' || key === 'Parameters (comma-separated)';
          if (!optional && !value) {
            missing.push(key);
            el.classList.add('is-missing');
          }
        });
        const showError = (message: string): void => {
          if (errorBox) {
            errorBox.classList.add('is-on');
            errorBox.textContent = message;
          }
        };
        if (missing.length) {
          showError(
            'Missing required parameter' +
              (missing.length > 1 ? 's' : '') +
              ': ' +
              missing.join(', ') +
              '. Fill every required field, or press Cancel to abort.'
          );
          dialog.querySelector<HTMLInputElement | HTMLTextAreaElement>('.is-missing')?.focus();
          return;
        }
        if (errorBox) {
          errorBox.classList.remove('is-on');
          errorBox.textContent = '';
        }
        if (isCreate || isEdit) {
          const kind: ObjectKind =
            opts.kind ||
            (opts.title.toLowerCase().includes('skill')
              ? 'skill'
              : opts.title.toLowerCase().includes('action')
                ? 'action'
                : 'template');
          const name = (values['Name'] || '').trim();
          const description = (values['Description'] || '').trim();
          const prompt = (values['Prompt'] || '').trim();
          const needs = derivedNeeds(values['Needs'] || values['Parameters (comma-separated)'] || '', prompt);
          const sectionLabel = kind === 'template' ? 'TEMPLATE FLOWS' : `${kind.toUpperCase()}S`;
          const issues: string[] = [];
          if (!name) {
            issues.push('Name is required');
          } else if (name.length < 2) {
            issues.push('Name must be at least 2 characters');
          } else if (/^(untitled|new (action|skill|template))$/i.test(name)) {
            issues.push('Give the object a real name');
          }
          if (!prompt) {
            issues.push('Prompt is required');
          }
          const host = hostForKind(kind);
          const duplicate = Array.from(host.querySelectorAll(`[data-${kind}]`)).some((el) => {
            if (isEdit && opts.editTarget && (el === opts.editTarget || opts.editTarget.contains(el))) {
              return false;
            }
            return sameName(el.getAttribute(`data-${kind}`) || '', name);
          });
          if (duplicate) {
            issues.push(`A ${kind} named "${name}" already exists in ${sectionLabel}`);
          }
          if (issues.length) {
            showError(issues.join('. ') + '. Fix the form or press Cancel to abort.');
            dialog.querySelector<HTMLInputElement>('[data-kd-param="Name"]')?.focus();
            return;
          }

          if (isEdit && opts.editTarget) {
            const target = opts.editTarget;
            const oldName = entryName(target, kind);
            if (!sameName(oldName, name)) {
              removeSaved(kind, oldName);
            }
            target.setAttribute(`data-${kind}`, name);
            target.setAttribute('data-prompt', prompt);
            if (needs) {
              target.setAttribute('data-params', needs);
            } else {
              target.removeAttribute('data-params');
            }
            const titleEl = target.querySelector('span, .title, strong') as HTMLElement | null;
            if (titleEl) {
              titleEl.textContent = name;
            }
            const sub = target.querySelector('small, .description, .desc') as HTMLElement | null;
            if (sub) {
              sub.textContent = description;
            }
            const need = target.querySelector('.need') as HTMLElement | null;
            if (need) {
              need.textContent = needs
                ? (needs.toLowerCase().startsWith('needs:') ? needs : `Needs: ${needs}`)
                : '';
            }
            target.dataset['kdObjectEnhanced'] = '1';
            const editedPayload: ObjectPayload = { kind, name, description, prompt, needs };
            rememberObject(editedPayload);
            upsertSaved(editedPayload);
            notifyServerMcp('addObject', {
              kind,
              name,
              title: name,
              description,
              prompt,
              needs
            });
            const stored = loadSaved().some((item) => objectKey(item.kind, item.name) === objectKey(kind, name));
            if (!stored) {
              showError('Save failed. The change was not stored. Fix and try again, or press Cancel to abort.');
              return;
            }
            ensureAddButtons();
            expandKind(kind);
            closeOverlay();
            return;
          }

          const payload: ObjectPayload = { kind, name, description, prompt, needs };
          const created = upsertObject(payload);
          const stored = loadSaved().some((item) => objectKey(item.kind, item.name) === objectKey(kind, name));
          const inList = created.isConnected && !!created.closest(`[data-kd-add-host="${kind}"]`);
          if (!stored || !inList) {
            showError(
              (!inList
                ? `Could not add this ${kind} to the ${sectionLabel} list.`
                : 'Could not persist this object.') + ' Fix the form or press Cancel to abort.'
            );
            return;
          }
          ensureAddButtons();
          expandKind(kind);
          closeOverlay();
          return;
        }
        if (opts.mode === 'run') {
          const prompt = replaceTokens(opts.sourceText || '', values);
          closeOverlay();
          if (prompt.trim()) {
            fillComposerAndSend(prompt, { kind: opts.kind || null, name: opts.title, values });
          } else {
            applyValues(values);
            opts.resume?.();
          }
          return;
        }
        closeOverlay();
        applyValues(values);
        opts.resume?.();
      });
      dialog.querySelector<HTMLInputElement>('input, textarea')?.focus();
    };

    const nativeParamDialog = (): HTMLElement | null => {
      const nodes = Array.from(
        doc.querySelectorAll<HTMLElement>('[role="dialog"], .modal, .popup, .overlay, dialog')
      );
      return (
        nodes.find((el) => {
          if (el.id === 'kd-nifi-param-overlay' || el.id === 'kd-nifi-param-dialog') {
            return false;
          }
          const text = (el.textContent || '').toLowerCase();
          return /cancel/.test(text) && /(continue|run|save|execute|ingest)/.test(text);
        }) || null
      );
    };

    const enhanceNative = (dialog: HTMLElement): void => {
      if (dialog.id === 'kd-nifi-param-dialog' || dialog.id === 'kd-nifi-param-overlay' || dialog.id === 'kd-nifi-msg-dialog') {
        return;
      }
      dialog.classList.add('sap-dialog');
      if (!dialog.querySelector('.kd-sap-head')) {
        const head = doc.createElement('div');
        head.className = 'kd-sap-head';
        head.innerHTML = '<div><h2>Complete parameters</h2><p>Fill the parameters, then Continue.</p></div>';
        const close = doc.createElement('button');
        close.type = 'button';
        close.className = 'kd-sap-x';
        close.setAttribute('aria-label', 'Close');
        close.textContent = '×';
        close.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (dialog instanceof HTMLDialogElement) {
            dialog.close();
          } else {
            dialog.remove();
          }
        });
        head.appendChild(close);
        const accent = doc.createElement('div');
        accent.className = 'kd-sap-accent';
        const form = dialog.querySelector('form') || dialog;
        form.insertBefore(accent, form.firstChild);
        form.insertBefore(head, form.firstChild);
      }
      if (!dialog.querySelector('.kd-param-body')) {
        const body = doc.createElement('div');
        body.className = 'kd-param-body';
        const form = dialog.querySelector('form') || dialog;
        Array.from(form.querySelectorAll('label, input, textarea, select')).forEach((el) => {
          if (!el.closest('.kd-sap-head, menu, footer')) {
            body.appendChild(el);
          }
        });
        const menu = form.querySelector('menu, footer');
        if (menu) {
          form.insertBefore(body, menu);
        } else {
          form.appendChild(body);
        }
      }
      dialog.querySelectorAll('button').forEach((btn) => {
        if (btn.classList.contains('kd-sap-x')) {
          return;
        }
        btn.classList.add('app-btn');
        if (/continue|save|run|test/i.test(btn.textContent || '')) {
          btn.classList.add('app-btn--primary');
        }
      });
      if (dialog.dataset['kdEnhanced'] === '1') {
        return;
      }
      dialog.dataset['kdEnhanced'] = '1';
      const cancel = Array.from(dialog.querySelectorAll('button')).find((b) =>
        /cancel|close/i.test(b.textContent || b.getAttribute('aria-label') || '')
      );
      cancel?.addEventListener(
        'click',
        (ev) => {
          ev.stopPropagation();
          if (dialog instanceof HTMLDialogElement && dialog.open) {
            dialog.close();
          }
        },
        true
      );
    };

    const headingKind = (text: string): ObjectKind | null => {
      const label = text.toLowerCase().replace(/\s+/g, ' ').trim();
      // Left rail labels look like "ACTION 16", "ACTIONS 16", "SKILLS 28", "TEMPLATES 8".
      if (/^skills?(\s+\d+)?$/.test(label) || /^skills?\s+\d+\b/.test(label)) {
        return 'skill';
      }
      if (/^actions?(\s+\d+)?$/.test(label) || /^actions?\s+\d+\b/.test(label)) {
        return 'action';
      }
      if (
        /^templates?(\s+\d+)?$/.test(label) ||
        /^templates?\s+\d+\b/.test(label) ||
        /^template\s+flows?(\s+\d+)?$/.test(label)
      ) {
        return 'template';
      }
      return null;
    };

    const defaultPrompt = (kind: ObjectKind): string => {
      if (kind === 'action') {
        return 'Create a KD action flow into IDOL';
      }
      if (kind === 'skill') {
        return 'Create a KD skill flow into IDOL';
      }
      return 'Create a KD SAP ingestion flow into IDOL';
    };

    const enhanceObject = (entry: HTMLElement, kind: ObjectKind): void => {
      if (entry.dataset['kdObjectEnhanced'] === '1') {
        return;
      }
      if (entry.classList.contains('kd-nifi-add-entry') || isAddBtn(entry)) {
        return;
      }
      entry.dataset['kdObjectEnhanced'] = '1';
      entry.classList.add('kd-nifi-editable-entry');

      const actions = doc.createElement('span');
      actions.className = 'kd-nifi-object-actions';
      actions.setAttribute('aria-label', `${kind} actions`);

      // Use non-button controls so native list entries that are themselves
      // buttons or links remain valid HTML.
      const makeAction = (label: string, title: string, extraClass = ''): HTMLSpanElement => {
        const control = doc.createElement('span');
        control.className = `kd-nifi-object-action ${extraClass}`.trim();
        control.textContent = label;
        control.title = title;
        control.setAttribute('role', 'button');
        control.setAttribute('tabindex', '0');
        control.setAttribute('aria-label', title);
        return control;
      };

      const edit = makeAction('✎', `Edit ${kind}`);
      const exp = makeAction('↓', `Export ${kind}`);
      const del = makeAction('×', `Delete ${kind}`, 'kd-nifi-object-action--delete');

      edit.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const sourceText = (entry.getAttribute('data-prompt') || entry.textContent || '').replace(/\s+/g, ' ').trim();
        const params = collectParams(entry, sourceText, kind);
        openDialog({
          title: `Edit ${kind}`,
          subtitle: `Update this ${kind}. Save applies the changes to the item.`,
          sourceText,
          params,
          mode: 'edit',
          kind,
          editTarget: entry
        });
      });

      exp.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        exportObject(entry, kind);
      });

      del.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const name = (entry.getAttribute(`data-${kind}`) || entry.textContent || kind).replace(/\s+/g, ' ').trim();
        showMessage({
          title: `Delete ${kind}`,
          message: `Delete ${name}?`,
          confirmLabel: 'Delete',
          danger: true,
          onConfirm: () => {
            removeObject(kind, name);
          }
        });
      });

      const activate = (control: HTMLElement, handler: (ev: Event) => void): void => {
        control.addEventListener('keydown', (ev) => {
          const key = (ev as KeyboardEvent).key;
          if (key === 'Enter' || key === ' ') {
            ev.preventDefault();
            handler(ev);
          }
        });
      };
      activate(edit, (ev) => edit.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      activate(exp, (ev) => exp.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      activate(del, (ev) => del.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      actions.append(edit, exp, del);
      entry.appendChild(actions);
    };

    const openCreate = (kind: ObjectKind, host: Element): void => {
      const title =
        kind === 'template' ? 'Complete SAP ingest' : kind === 'skill' ? 'Complete skill' : 'Complete action';
      openDialog({
        title,
        subtitle: 'Fill the parameters attached to this item, then Continue.',
        sourceText: defaultPrompt(kind),
        params: [],
        mode: 'create',
        kind
      });
      const dialog = doc.getElementById('kd-nifi-param-dialog');
      const nameField = dialog?.querySelector<HTMLInputElement>('[data-kd-param="Name"]');
      if (nameField) {
        const lab = nameField.previousElementSibling;
        if (lab) {
          lab.textContent = `${kind[0].toUpperCase()}${kind.slice(1)} name`;
        }
        nameField.placeholder = `${kind} name`;
      }
      // Only tag a real section list, never the doc.body fallback — tagging
      // body would make later `[data-kd-add-host="kind"]` lookups match the
      // whole document instead of the actual list.
      if (host !== doc.body) {
        host.setAttribute('data-kd-add-host', kind);
      }
    };

    const sectionRow = (heading: Element): HTMLElement => {
      return (
        (heading.closest('button, [role="button"], summary') as HTMLElement | null) ||
        (heading as HTMLElement)
      );
    };

    const relabelActionHeader = (heading: Element): void => {
      const row = sectionRow(heading);
      const toggle =
        (row.closest('.nav-toggle, [class*="nav-toggle"]') as HTMLElement | null) ||
        (row.querySelector('.nav-toggle, [class*="nav-toggle"]') as HTMLElement | null) ||
        row;
      const renameAttr = (el: Element | null, attr: string): void => {
        if (!el) {
          return;
        }
        const raw = el.getAttribute(attr);
        if (!raw || !/\bACTION\b/.test(raw) || /\bACTIONS\b/.test(raw)) {
          return;
        }
        el.setAttribute(attr, raw.replace(/\bACTION\b/g, 'ACTIONS'));
      };
      const walk = (node: Node): void => {
        if (node.nodeType === 3) {
          const text = node.textContent || '';
          // Section title only: "ACTION" / "ACTION 16" — never "Add Action".
          const next = text.replace(/\bACTION\b(?!\s*S)/g, 'ACTIONS');
          if (next !== text) {
            node.textContent = next;
          }
          return;
        }
        node.childNodes.forEach(walk);
      };
      [heading, row, toggle].forEach((el) => {
        if (!el) {
          return;
        }
        renameAttr(el, 'aria-label');
        renameAttr(el, 'title');
        walk(el);
      });
    };

    const relabelActionHeaders = (): void => {
      headingEls().forEach((heading) => {
        if (headingKind((heading.textContent || '').replace(/\s+/g, ' ').trim()) === 'action') {
          relabelActionHeader(heading);
        }
      });
    };

    const setHostOpen = (host: HTMLElement, open: boolean): void => {
      host.hidden = !open;
      host.style.display = open ? '' : 'none';
    };

    const sectionToggle = (heading: Element): HTMLElement => {
      const row = sectionRow(heading);
      return (
        (row.closest('.nav-toggle, [class*="nav-toggle"]') as HTMLElement | null) ||
        (row.querySelector('.nav-toggle, [class*="nav-toggle"]') as HTMLElement | null) ||
        row
      );
    };

    const sectionIsOpen = (heading: Element): boolean => {
      const row = sectionRow(heading);
      const toggle = sectionToggle(heading);
      const details = heading.closest('details');
      const section = (heading.closest('.nav-section, [class*="nav-section"]') as HTMLElement | null) || null;
      if (toggle.getAttribute('aria-expanded') === 'false') {
        return false;
      }
      if (toggle.getAttribute('aria-expanded') === 'true') {
        return true;
      }
      if (row.getAttribute('aria-expanded') === 'false') {
        return false;
      }
      if (row.getAttribute('aria-expanded') === 'true') {
        return true;
      }
      if (details) {
        return details.hasAttribute('open');
      }
      if (section && /\bopen\b/.test(section.className)) {
        return true;
      }
      const host = section?.querySelector('.kd-nifi-kind-list') as HTMLElement | null;
      if (host && (host.hidden || host.style.display === 'none')) {
        return false;
      }
      return false;
    };

    const hideKindListsFor = (heading: Element, open: boolean): void => {
      const row = sectionRow(heading);
      const section = heading.closest('.nav-section, [class*="nav-section"]') as HTMLElement | null;
      section?.querySelectorAll<HTMLElement>('.kd-nifi-kind-list, [data-kd-add-host]').forEach((list) => {
        setHostOpen(list, open);
      });
      let next = row.nextElementSibling as HTMLElement | null;
      while (next && (next.getAttribute('data-kd-add-host') || next.classList.contains('kd-nifi-kind-list'))) {
        setHostOpen(next, open);
        next = next.nextElementSibling as HTMLElement | null;
      }
    };

    const collapsedKinds = new Set<ObjectKind>();
    const forceSectionClosed = (heading: Element): void => {
      const row = sectionRow(heading);
      const toggle = sectionToggle(heading);
      const details = heading.closest('details');
      const section = heading.closest('.nav-section, [class*="nav-section"]') as HTMLElement | null;
      details?.removeAttribute('open');
      section?.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      row.setAttribute('aria-expanded', 'false');
      toggle.dataset['kdWantOpen'] = '0';
      hideKindListsFor(heading, false);
    };

    const collapseRailSections = (_forceDefault = false): void => {
      headingEls().forEach((heading) => {
        const kind = headingKind((heading.textContent || '').replace(/\s+/g, ' ').trim());
        const toggle = sectionToggle(heading);
        if (kind && !collapsedKinds.has(kind)) {
          forceSectionClosed(heading);
          collapsedKinds.add(kind);
        }
        if (toggle.dataset['kdCollapseBound'] === '1') {
          return;
        }
        toggle.dataset['kdCollapseBound'] = '1';
        toggle.addEventListener('click', () => {
          win.setTimeout(() => {
            const want = toggle.dataset['kdWantOpen'] !== '1';
            toggle.dataset['kdWantOpen'] = want ? '1' : '0';
            toggle.setAttribute('aria-expanded', want ? 'true' : 'false');
            sectionRow(heading).setAttribute('aria-expanded', want ? 'true' : 'false');
            const section = heading.closest('.nav-section, [class*="nav-section"]') as HTMLElement | null;
            section?.classList.toggle('open', want);
            const details = heading.closest('details');
            if (details) {
              if (want) {
                details.setAttribute('open', '');
              } else {
                details.removeAttribute('open');
              }
            }
            hideKindListsFor(heading, want);
          }, 0);
        });
      });
      doc.querySelectorAll<HTMLElement>('.nav-toggle, [class*="nav-toggle"]').forEach((toggle) => {
        const raw = (toggle.textContent || toggle.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const kind = headingKind(raw);
        if (!kind) {
          return;
        }
        if (/\bACTION\b/.test(raw) && !/\bACTIONS\b/.test(raw)) {
          relabelActionHeader(toggle);
        }
        if (!collapsedKinds.has(kind)) {
          toggle.setAttribute('aria-expanded', 'false');
          toggle.dataset['kdWantOpen'] = '0';
          toggle.closest('.nav-section')?.classList.remove('open');
          collapsedKinds.add(kind);
        }
      });
    };

    const expandKind = (kind: ObjectKind): void => {
      headingEls().forEach((heading) => {
        if (headingKind((heading.textContent || '').replace(/\s+/g, ' ').trim()) !== kind) {
          return;
        }
        const row = sectionRow(heading);
        if (row.getAttribute('aria-expanded') === 'false') {
          (row as HTMLElement).click();
        }
        row.setAttribute('aria-expanded', 'true');
        let next = row.nextElementSibling as HTMLElement | null;
        while (next && (next.getAttribute('data-kd-add-host') || next.classList.contains('kd-nifi-kind-list'))) {
          setHostOpen(next, true);
          next = next.nextElementSibling as HTMLElement | null;
        }
      });
    };

    const listAfter = (heading: Element): HTMLElement | null => {
      const row = sectionRow(heading);
      const box = heading.closest('details, [role="group"], fieldset, section') as HTMLElement | null;
      if (box && box !== doc.body) {
        const inner = box.querySelector('ul, ol, [role="list"], nav, .list');
        if (inner) {
          return inner as HTMLElement;
        }
      }
      let node: Element | null = row.nextElementSibling;
      for (let i = 0; i < 8 && node; i += 1, node = node.nextElementSibling) {
        if ((node as HTMLElement).id === 'kd-nifi-add-group' || (node as HTMLElement).id === 'kd-nifi-io-all') {
          continue;
        }
        const asKind = headingKind((node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28));
        if (asKind) {
          break;
        }
        if (node.matches('ul, ol, [role="list"], nav, details, [data-kd-add-host]')) {
          const nested = node.querySelector('ul, ol, [role="list"]');
          return (nested as HTMLElement) || (node as HTMLElement);
        }
        const inner = node.querySelector('ul, ol, [role="list"], nav, [data-kd-add-host]');
        if (inner) {
          return inner as HTMLElement;
        }
      }
      return null;
    };

    const stripEmptyLabels = (root: ParentNode): void => {
      root.querySelectorAll('small, .need, .side-btn__desc, .side-btn__need, label, p, span').forEach((el) => {
        if (el.classList.contains('kd-nifi-object-action')) {
          return;
        }
        if (!(el.textContent || '').trim()) {
          el.remove();
        }
      });
    };

    const addLabelFor: AddLabelFor = (kind) => {
      if (kind === 'action') {
        return '+ Add Action';
      }
      if (kind === 'skill') {
        return '+ Add Skill';
      }
      return '+ Add template';
    };

    const headingEls = (): HTMLElement[] => {
      const found: HTMLElement[] = [];
      const seenKinds = new Set<string>();
      const scope = leftNavigator() || navSectionOpen() || doc;
      const nodes = scope.querySelectorAll(
        '.nav-toggle, [class*="nav-toggle"], button, summary, h1, h2, h3, h4, h5, header, label, strong, [role="heading"]'
      );
      for (const el of Array.from(nodes)) {
        if ((el as HTMLElement).closest('#kd-nifi-add-group, #kd-nifi-io-all, #kd-nifi-param-overlay')) {
          continue;
        }
        const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (!raw || raw.length > 28) {
          continue;
        }
        if (!isRailHeading(el as HTMLElement, raw)) {
          continue;
        }
        const kind = headingKind(raw);
        if (!kind || seenKinds.has(kind)) {
          continue;
        }
        seenKinds.add(kind);
        found.push(el as HTMLElement);
      }
      return found;
    };

    const isRailHeading = (el: HTMLElement, raw: string): boolean => {
      if (/^(strong|em|b|i|a)$/i.test(el.tagName)) {
        return false;
      }
      const blob = `${el.textContent || ''} ${el.parentElement?.textContent || ''}`;
      if (/describe a flow or pick a skill|open actions, skills, or templates/i.test(blob) && !el.closest('.nav-section')) {
        return false;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width && rect.left > win.innerWidth * 0.42) {
        return false;
      }
      return !!headingKind(raw);
    };

    const allNavSections = (): HTMLElement[] =>
      Array.from(doc.querySelectorAll<HTMLElement>('.nav-section, [class*="nav-section"]')).filter((el) => {
        const cls = typeof el.className === 'string' ? el.className : '';
        return /\bnav-section\b/.test(cls);
      });

    const navSectionOpen = (): HTMLElement | null => {
      const sections = allNavSections();
      return (
        sections.find((el) => el.classList.contains('open') || /\bopen\b/.test(el.className)) ||
        sections[0] ||
        null
      );
    };

    const leftNavigator = (): HTMLElement | null => {
      const sections = allNavSections();
      if (sections.length) {
        let node: HTMLElement | null = sections[0].parentElement;
        while (node && node !== doc.body && node !== doc.documentElement) {
          const current: HTMLElement = node;
          if (sections.every((section) => current === section || current.contains(section))) {
            if (!current.classList.contains('nav-section')) {
              return current;
            }
          }
          node = current.parentElement;
        }
        return sections[0].parentElement;
      }
      const open = navSectionOpen();
      return open?.parentElement && open.parentElement !== doc.body ? open.parentElement : open;
    };

    const leftPanelRoot = (): HTMLElement | null => {
      const nav = navSectionOpen();
      if (nav) {
        return nav;
      }
      const heads = headingEls();
      const tagged = Array.from(doc.querySelectorAll<HTMLElement>('[data-kd-add-host]'));
      const seeds = heads.length ? heads : tagged;
      if (!seeds.length) {
        return null;
      }
      let ancestor: HTMLElement | null = seeds[0];
      let best: HTMLElement | null = null;
      while (ancestor && ancestor !== doc.body && ancestor !== doc.documentElement) {
        const current: HTMLElement = ancestor;
        let containsAll = true;
        for (let i = 0; i < seeds.length; i += 1) {
          const seed = seeds[i];
          if (current !== seed && !current.contains(seed)) {
            containsAll = false;
            break;
          }
        }
        if (containsAll) {
          const rect = current.getBoundingClientRect();
          const tooWide = rect.width > 560;
          const notLeft = rect.left > win.innerWidth * 0.42;
          const help = /open actions, skills, or templates/i.test(current.textContent || '');
          if (!tooWide && !notLeft && !help) {
            best = current;
          }
        }
        ancestor = current.parentElement;
      }
      return best;
    };

    /**
     * Labels the embedded UI renders under Templates that must not be shown.
     * Compared case-insensitively against an element's whole trimmed text.
     */
    const TEMPLATE_LABELS_TO_REMOVE = new Set(['actions', 'ingest', 'idol nifi2', 'stages', 'custom']);
    const pruneTemplateLabels = (host: HTMLElement): void => {
      const section: HTMLElement =
        asHtmlElement(host.closest('.nav-section, [class*="nav-section"]')) || sectionForKind('template') || host;
      const isLabel = (el: HTMLElement): boolean =>
        TEMPLATE_LABELS_TO_REMOVE.has((el.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase());
      const keep = (el: HTMLElement): boolean =>
        !!el.closest(
          '.kd-nifi-add-entry, #kd-nifi-io-all, .kd-nifi-object-actions, #kd-nifi-param-overlay, .nav-toggle, [class*="nav-toggle"]'
        );
      const isUserObject = (el: HTMLElement): boolean => {
        const name = entryName(el, 'template');
        return (
          !!name &&
          (catalog.template.has(name) || loadSaved().some((item) => item.kind === 'template' && sameName(item.name, name)))
        );
      };
      Array.from(section.querySelectorAll<HTMLElement>('*'))
        .filter((el) => el.isConnected && !keep(el) && isLabel(el))
        .forEach((el) => {
          const owner = asHtmlElement(el.closest('[data-kd-created="1"]'));
          if (isUserObject(el) || (owner && isUserObject(owner))) {
            return;
          }
          // Remove the smallest element that is only this label, then any
          // now-empty plain wrapper it leaves behind.
          let target: HTMLElement = el;
          while (
            target.parentElement &&
            target.parentElement !== section &&
            target.parentElement !== host &&
            isLabel(target.parentElement) &&
            !keep(target.parentElement)
          ) {
            target = target.parentElement;
          }
          const parent = target.parentElement;
          target.remove();
          if (parent && parent !== section && parent !== host && !parent.children.length && !(parent.textContent || '').trim()) {
            parent.remove();
          }
        });
    };

    const addIdFor = (kind: ObjectKind): string =>
      kind === 'action' ? 'addAct' : kind === 'skill' ? 'addSkill' : 'addTpl';

    /**
     * All three Add controls are the same ghost button as the embedded UI's:
     *   <button type="button" class="ghost" id="addTpl">+ Add template</button>
     *   <button type="button" class="ghost" id="addAct">+ Add Action</button>
     *   <button type="button" class="ghost" id="addSkill">+ Add Skill</button>
     */
    const makeAddButton = (kind: ObjectKind): HTMLButtonElement => {
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'ghost';
      btn.id = addIdFor(kind);
      btn.dataset['kind'] = kind;
      btn.setAttribute('data-kd-add', kind);
      btn.textContent = addLabelFor(kind);
      return btn;
    };

    /**
     * Add Action / Add Skill / Add template live together at the top of the
     * left panel, above the Actions / Skills / Templates sections.
     */
    const ensureKindAddControl: EnsureKindAddControl = (host, kind) => {
      if (!host || host === doc.body || host === doc.documentElement) {
        return;
      }
      host.setAttribute('data-kd-add-host', kind);

      let entry = host.querySelector<HTMLElement>(`:scope > .kd-nifi-add-entry`);
      if (!entry) {
        entry = doc.createElement('div');
        entry.className = 'kd-nifi-add-entry';
        entry.dataset['kind'] = kind;
        const button = makeAddButton(kind);
        entry.appendChild(button);
        host.appendChild(entry);
      } else {
        entry.dataset['kind'] = kind;
        const button = entry.querySelector<HTMLButtonElement>('[data-kd-add], #addTpl, .kd-nifi-add-btn');
        if (button && (button.id !== addIdFor(kind) || button.className !== 'ghost')) {
          button.replaceWith(makeAddButton(kind));
        } else if (button) {
          button.dataset['kind'] = kind;
          button.textContent = addLabelFor(kind);
        }
      }
    };

    const ensureTopAddBar = (): void => {
      // Kept as a compatibility cleanup for older embedded UI versions.
      // Add controls now live inside their own Actions, Skills, and Templates
      // sections, never in a root-level toolbar.
      doc.getElementById('kd-nifi-add-group')?.remove();
      doc.querySelectorAll<HTMLElement>('[data-kd-add], #addTpl').forEach((button) => {
        const host = button.closest('[data-kd-add-host]');
        if (!host) {
          button.closest('.kd-nifi-add-entry')?.remove();
          if (!button.closest('[data-kd-add-host]')) {
            button.remove();
          }
        }
      });
      doc.querySelectorAll('[data-kd-add-host] > .kd-nifi-io-row').forEach((el) => {
        if (el.id !== 'kd-nifi-io-all') {
          el.remove();
        }
      });
    };

    const refreshAllLists = (fromSynchronizedState = false): void => {
      // Normal refresh learns from the embedded NiFi DOM. A post-import
      // refresh must instead render from the already synchronized catalog,
      // otherwise stale DOM entries can immediately come back.
      if (!fromSynchronizedState) {
        setUiCleared(false);
        clearTombstones();
        clearAllImportLocks();
        snapshotDomObjects();
      }
      renderCatalogIntoLists();
      ensureAddButtons(true);
      sortKindLists();
      dedupeKindLists();
      pinIoBar();
      updateKindCounts();
    };

    /**
     * Refresh button: rescan the embedded lists AND tell the server, so the
     * click is traceable in the process log (`mcp request ... name=refreshObjects`).
     */
    const runRefresh = (): void => {
      refreshAllLists();
      notifyServerMcp('refreshObjects', {
        kinds: ['action', 'skill', 'template'],
        count: countKindObjects('action') + countKindObjects('skill') + countKindObjects('template')
      });
      // Pull server-owned items (including ones added from the other package)
      // and materialize any that are missing from this overlay.
      win
        .fetch('/api/admin/nifi-ai/mcp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-KD-Nifi-Method': 'listObjects' },
          body: JSON.stringify({ method: 'listObjects' })
        })
        .then((res) => res.json())
        .then((payload) => {
          const forwarded = payload?.forwarded?.body;
          let parsed: { items?: Array<Record<string, unknown>> } = {};
          try {
            parsed = typeof forwarded === 'string' ? JSON.parse(forwarded) : forwarded || {};
          } catch {
            parsed = {};
          }
          const rpc = parsed as {
            result?: { structuredContent?: { items?: Array<Record<string, unknown>> }; content?: Array<{ text?: string }> };
            items?: Array<Record<string, unknown>>;
          };
          const structured = rpc.result?.structuredContent?.items;
          let items = structured || rpc.items || [];
          if (!items.length && rpc.result?.content?.[0]?.text) {
            try {
              const inner = JSON.parse(rpc.result.content[0].text);
              items = inner.items || [];
            } catch {
              items = [];
            }
          }
          items.forEach((raw) => {
            const kind = raw['kind'] === 'skill' || raw['kind'] === 'template' || raw['kind'] === 'action' ? raw['kind'] : null;
            const name = String(raw['title'] || raw['name'] || '').trim();
            if (!kind || !name || chromeName(name) || isTombstoned(kind, name)) {
              return;
            }
            if (findEntryByName(kind, name)) {
              return;
            }
            upsertObject({
              kind,
              name,
              description: String(raw['description'] || ''),
              prompt: String(raw['prompt'] || ''),
              needs: String(raw['needs'] || (Array.isArray(raw['required_config']) ? raw['required_config'].join(', ') : ''))
            });
          });
        })
        .catch(() => undefined);
    };

    const exportAllObjects = (): void => {
      snapshotDomObjects();
      const objects: ObjectPayload[] = [];
      const seen = new Set<string>();
      const add = (payload: ObjectPayload): void => {
        const name = (payload.name || '').trim();
        if (!name || chromeName(name)) {
          return;
        }
        const key = objectKey(payload.kind, name);
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        objects.push({ ...payload, name });
      };
      allCatalogObjects().forEach(add);
      (['action', 'skill', 'template'] as ObjectKind[]).forEach((kind) => {
        listAllKindObjects(kind).forEach(add);
      });
      loadSaved().forEach(add);
      downloadJson('kd-nifi-all-objects.json', {
        version: 1,
        kind: 'all',
        exportedAt: new Date().toISOString(),
        objects
      });
      updateKindCounts();
    };

    const importAllObjects = (raw: unknown): void => {
      const payloads = parseImported(raw, 'action');
      const unique: ObjectPayload[] = [];
      const seen = new Set<string>();
      payloads.forEach((payload) => {
        const key = `${payload.kind}:${payload.name}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        unique.push(payload);
      });
      if (!unique.length) {
        showMessage({ message: 'No actions, skills, or templates found in that file.' });
        return;
      }
      importPayloads(unique, unique[0].kind);
    };

    const pinIoBar = (row?: HTMLElement | null): void => {
      const bar = row || (doc.getElementById('kd-nifi-io-all') as HTMLElement | null);
      if (!bar) {
        return;
      }
      const mount = doc.body || doc.documentElement;
      if (bar.parentElement !== mount) {
        mount.appendChild(bar);
      }
      (doc.body || doc.documentElement).classList.add('kd-nifi-io-pad');
      const rail = leftNavigator();
      const rect = rail?.getBoundingClientRect();
      const width = rect && rect.width > 72 ? Math.round(rect.width) : Math.min(360, Math.round(win.innerWidth * 0.42));
      const left = rect ? Math.max(0, Math.round(rect.left)) : 0;
      bar.style.position = 'fixed';
      bar.style.left = `${left}px`;
      bar.style.width = `${width}px`;
      bar.style.bottom = '0px';
      bar.style.top = 'auto';
      bar.style.right = 'auto';
      bar.style.zIndex = '2147483646';
    };

    const hasAnyListedObject = (): boolean =>
      (['action', 'skill', 'template'] as ObjectKind[]).some(
        (kind) =>
          collectKindEntries(kind).length > 0 ||
          catalog[kind].size > 0 ||
          loadSaved().some((item) => item.kind === kind) ||
          listAllKindObjects(kind).length > 0
      );

    const runClearAll = (): void => {
      if (!hasAnyListedObject()) {
        showMessage({ message: 'Nothing to clear. The Actions, Skills, and Templates lists are already empty.' });
        return;
      }
      showMessage({
        title: 'Clear all',
        message: 'Delete all Actions, Skills, and Templates?',
        confirmLabel: 'Delete all',
        danger: true,
        onConfirm: () => clearAllObjects()
      });
    };

    const bindClearAllButton = (row?: HTMLElement | null): void => {
      const host = row || (doc.getElementById('kd-nifi-io-all') as HTMLElement | null);
      const btn =
        (host?.querySelector<HTMLButtonElement>('[data-kd-io="clear-all"]') as HTMLButtonElement | null) ||
        (host?.querySelectorAll<HTMLButtonElement>('.kd-nifi-io-btn')[3] as HTMLButtonElement | undefined) ||
        null;
      if (!btn) {
        return;
      }
      btn.dataset['kdIo'] = 'clear-all';
      btn.classList.add('kd-nifi-io-btn--danger');
      btn.textContent = 'Clear all';
      btn.title = 'Delete all actions, skills, and templates from the lists';
      btn.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        runClearAll();
      };
    };

    const ensureBottomIo = (): void => {
      let row = doc.getElementById('kd-nifi-io-all') as HTMLElement | null;
      if (!row) {
        row = doc.createElement('div');
        row.id = 'kd-nifi-io-all';
        row.className = 'kd-nifi-io-row';
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', 'Import or export all objects');
        const file = doc.createElement('input');
        file.type = 'file';
        file.accept = 'application/json,.json';
        file.className = 'kd-nifi-io-file';
        file.addEventListener('change', () => {
          const picked = file.files?.[0];
          file.value = '';
          if (!picked) {
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            try {
              importAllObjects(JSON.parse(String(reader.result || 'null')));
            } catch {
              showMessage({ message: 'Could not read that JSON file.' });
            }
          };
          reader.readAsText(picked);
        });
        const makeIo = (label: string, title: string, onClick: () => void, ioKey?: string): HTMLButtonElement => {
          const btn = doc.createElement('button');
          btn.type = 'button';
          btn.className = 'kd-nifi-io-btn';
          btn.textContent = label;
          btn.title = title;
          if (ioKey) {
            btn.dataset['kdIo'] = ioKey;
          }
          btn.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            onClick();
          });
          return btn;
        };
        const clearAll = makeIo(
          'Clear all',
          'Delete all actions, skills, and templates from the lists',
          runClearAll,
          'clear-all'
        );
        clearAll.classList.add('kd-nifi-io-btn--danger');
        row.append(
          makeIo('Export', 'Export actions, skills, and templates to a formatted JSON file', exportAllObjects, 'export-all'),
          makeIo('Import', 'Import actions, skills, and templates from a JSON file', () =>
            (file as HTMLInputElement).click(), 'import-all'
          ),
          makeIo('Refresh', 'Refresh the Actions, Skills, and Templates lists', runRefresh, 'refresh'),
          clearAll,
          file
        );
      } else {
        const buttons = Array.from(row.querySelectorAll<HTMLButtonElement>('.kd-nifi-io-btn'));
        if (!row.querySelector('[data-kd-io="clear-all"]') && !buttons[3]) {
          const clearAll = doc.createElement('button');
          clearAll.type = 'button';
          clearAll.className = 'kd-nifi-io-btn kd-nifi-io-btn--danger';
          clearAll.textContent = 'Clear all';
          clearAll.title = 'Delete all actions, skills, and templates from the lists';
          clearAll.dataset['kdIo'] = 'clear-all';
          row.appendChild(clearAll);
          buttons.push(clearAll);
        }
        const labels = ['Export', 'Import', 'Refresh', 'Clear all'];
        const keys = ['export-all', 'import-all', 'refresh', 'clear-all'];
        buttons.forEach((btn, i) => {
          if (labels[i] && btn.textContent !== labels[i]) {
            btn.textContent = labels[i];
          }
          if (keys[i]) {
            btn.dataset['kdIo'] = keys[i];
          }
        });
        if (buttons[0]) {
          buttons[0].title = 'Export all actions, skills, and templates to a formatted JSON file';
        }
        if (buttons[1]) {
          buttons[1].title = 'Import actions, skills, and templates from a JSON file';
        }
        if (buttons[2]) {
          buttons[2].title = 'Refresh the Actions, Skills, and Templates lists';
        }
        if (buttons[3]) {
          buttons[3].title = 'Delete all actions, skills, and templates from the lists';
          buttons[3].classList.add('kd-nifi-io-btn--danger');
          buttons[3].dataset['kdIo'] = 'clear-all';
        }
      }
      bindClearAllButton(row);
      pinIoBar(row);
    };

    const sectionAnchor = (kind: ObjectKind): HTMLElement | null => {
      const host = doc.querySelector(`[data-kd-add-host="${kind}"]`) as HTMLElement | null;
      if (!host) {
        return null;
      }
      const wrap = host.closest('details, section, [role="group"], fieldset') as HTMLElement | null;
      return wrap && wrap !== doc.body ? wrap : host;
    };

    const placeInLeftPanel = (el: HTMLElement, where: 'top' | 'bottom'): void => {
      const rail = leftNavigator();
      const sections = allNavSections();
      if (rail && rail !== doc.body) {
        if (where === 'top') {
          const firstSection = sections[0];
          if (firstSection && firstSection.parentElement === rail) {
            if (el.nextElementSibling !== firstSection) {
              rail.insertBefore(el, firstSection);
            }
          } else if (rail.firstElementChild !== el) {
            rail.insertBefore(el, rail.firstChild);
          }
          return;
        }
        rail.appendChild(el);
        return;
      }
      const heads = headingEls();
      if (heads.length) {
        const actionHead =
          heads.find((head) => headingKind((head.textContent || '').replace(/\s+/g, ' ').trim()) === 'action') || heads[0];
        const firstRow = sectionRow(actionHead);
        const lastRow = sectionRow(heads[heads.length - 1]);
        const parent = firstRow.parentElement;
        if (parent && parent !== doc.body) {
          if (where === 'top') {
            if (el.parentElement !== parent || el.nextElementSibling !== firstRow) {
              parent.insertBefore(el, firstRow);
            }
            return;
          }
          let anchor: HTMLElement = lastRow;
          let next = lastRow.nextElementSibling as HTMLElement | null;
          while (next && next.getAttribute('data-kd-add-host')) {
            anchor = next;
            next = next.nextElementSibling as HTMLElement | null;
          }
          if (anchor.nextElementSibling !== el) {
            anchor.insertAdjacentElement('afterend', el);
          }
          return;
        }
      }
      const panel = leftPanelRoot();
      if (panel && panel !== doc.body) {
        if (where === 'top') {
          panel.insertBefore(el, panel.firstChild);
        } else {
          panel.appendChild(el);
        }
        return;
      }
      if (!doc.body.contains(el)) {
        (doc.body || doc.documentElement).appendChild(el);
      }
    };

    const hostForKind: HostForKind = (kind) => {
      const railHost = (el: HTMLElement | null): boolean => {
        if (!el || el === doc.body) {
          return false;
        }
        if (el.closest('#kd-nifi-add-group, #kd-nifi-io-all')) {
          return false;
        }
        if (/describe a flow or pick a skill|open actions, skills, or templates/i.test(el.textContent || '')) {
          return false;
        }
        if (el.closest('.nav-section')) {
          return true;
        }
        const rect = el.getBoundingClientRect();
        return !rect.width || rect.left <= win.innerWidth * 0.42;
      };
      const tagged = Array.from(doc.querySelectorAll<HTMLElement>(`[data-kd-add-host="${kind}"]`)).find(railHost);
      if (tagged) {
        return tagged;
      }
      const section = sectionForKind(kind);
      const host = doc.createElement('div');
      host.setAttribute('data-kd-add-host', kind);
      host.className = 'kd-nifi-kind-list';
      if (section) {
        if (host.parentElement !== section || section.lastElementChild !== host) {
          section.appendChild(host);
        }
        return host;
      }
      const scope = leftNavigator() || doc;
      const nodes = scope.querySelectorAll('button, summary, [role="button"], header, label');
      let row: HTMLElement | null = null;
      for (const el of Array.from(nodes)) {
        const raw = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (headingKind(raw) === kind && isRailHeading(el as HTMLElement, raw)) {
          row = sectionRow(el);
          break;
        }
      }
      if (row && row.parentElement) {
        row.insertAdjacentElement('afterend', host);
        return host;
      }
      const rail = leftNavigator();
      const io = doc.getElementById('kd-nifi-io-all');
      if (rail && io && rail.contains(io)) {
        rail.insertBefore(host, io);
      } else if (rail) {
        rail.appendChild(host);
      } else {
        (doc.body || doc.documentElement).appendChild(host);
      }
      return host;
    };

    const objectResponds = (el: HTMLElement, kind: ObjectKind): boolean => {
      if (isAddBtn(el) || el.classList.contains('kd-nifi-io-btn')) {
        return true;
      }
      const name = (
        el.getAttribute(`data-${kind}`) ||
        el.getAttribute('data-prompt') ||
        el.getAttribute('data-template') ||
        el.getAttribute('data-action') ||
        el.getAttribute('data-skill') ||
        el.querySelector('.side-btn__title, span:not(.need):not(.kd-nifi-object-action)')?.textContent ||
        ''
      )
        .replace(/\s+/g, ' ')
        .trim();
      if (!name) {
        return false;
      }
      if (/^(actions?|skills?|templates?)$/i.test(name)) {
        return false;
      }
      if (/^\+\s*(add|import|export|refresh)/i.test(name) || /^(import|export|refresh)$/i.test(name)) {
        return false;
      }
      const hasDef = !!(
        el.getAttribute('data-prompt') ||
        el.getAttribute(`data-${kind}`) ||
        el.getAttribute('data-params') ||
        el.classList.contains('side-btn') ||
        el.tagName === 'BUTTON' ||
        el.getAttribute('role') === 'button' ||
        el.dataset['kdCreated'] === '1' ||
        el.dataset['kdObjectEnhanced'] === '1'
      );
      if (!hasDef) {
        return false;
      }
      if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') {
        return false;
      }
      return true;
    };

    const insertCreatedIntoSection: InsertCreatedIntoSection = (created, kind) => {
      const host = hostForKind(kind);
      const createdName = created.getAttribute(`data-${kind}`) || '';
      const existing = Array.from(host.querySelectorAll(`[data-${kind}]`)).find(
        (el) => el !== created && (el.getAttribute(`data-${kind}`) || '') === createdName
      );
      if (existing) {
        existing.replaceWith(created);
        return;
      }
      host.appendChild(created);
    };

    /**
     * Enhance every existing object in each section and keep the matching
     * Add control at the bottom of that section on the left panel.
     */
    let ensuring = false;
    const ensureAddButtons = (fromRefresh = false): void => {
      if (ensuring) {
        return;
      }
      ensuring = true;
      try {
        const seen = new Set<string>();
        const headings = doc.querySelectorAll(
          '.nav-toggle, [class*="nav-toggle"], h1, h2, h3, h4, h5, header, [role="heading"], summary, button, label, strong'
        );
        for (const heading of Array.from(headings)) {
          if ((heading as HTMLElement).closest?.('#kd-nifi-param-overlay, .kd-nifi-io-row, .kd-nifi-object-actions')) {
            continue;
          }
          const raw = (heading.textContent || '').replace(/\s+/g, ' ').trim();
          if (!raw || raw.length > 24 || /^\+\s*add\s+/i.test(raw) || /^(import|export)\s+/i.test(raw)) {
            continue;
          }
          if (!isRailHeading(heading as HTMLElement, raw)) {
            continue;
          }
          const kind = headingKind(raw);
          if (!kind || seen.has(kind)) {
            continue;
          }
          seen.add(kind);
          relabelActionHeader(heading);
          const collapse = (heading.closest('button, [role="button"], summary') as HTMLElement | null) || heading;
          const host = hostForKind(kind);
          if (!host || host === doc.body || host === doc.documentElement) {
            continue;
          }
          const parent = host.parentElement;
          if (
            parent &&
            parent !== doc.body &&
            parent.classList.contains('nav-section') &&
            parent.lastElementChild !== host
          ) {
            parent.appendChild(host);
          }

          parkSectionEntries(host, kind);
          ensureKindAddControl(host, kind);
          if (kind === 'template') {
            pruneTemplateLabels(host);
          }
          const items = gatherEntries(host, kind);
          items.forEach((entry) => {
            if (entry.classList.contains('kd-nifi-add-entry') || isAddBtn(entry)) {
              return;
            }
            if (entry.closest('#kd-nifi-add-group, #kd-nifi-io-all, .kd-nifi-io-row')) {
              return;
            }
            const name = entryName(entry, kind);
            if (isUiCleared() || isTombstoned(kind, name)) {
              entry.remove();
              return;
            }
            if (isImportLocked(kind) && !isAllowedByImportLock(kind, name)) {
              entry.remove();
              return;
            }
            if (!objectResponds(entry, kind) && !name) {
              return;
            }
            enhanceObject(entry, kind);
            // Native entries that were already present in the embedded UI
            // (not created through Add/Import in this session) reach this
            // point too. Without marking them as managed and binding the
            // click handler here, enhanceObject() still gives them
            // Edit/Export/Delete controls, but clicking the item itself to
            // run it silently does nothing, because bindObjectClick() only
            // executes for entries flagged kdCreated. Flag + bind them here
            // so every recognized object is runnable, not just ones created
            // in the current session.
            if (entry.dataset['kdCreated'] !== '1') {
              entry.dataset['kdCreated'] = '1';
            }
            entry.dataset['kdRunnable'] = '1';
            bindObjectClick(entry, kind);
          });
        }
        if (isUiCleared()) {
          clearListedObjects();
          (['action', 'skill', 'template'] as ObjectKind[]).forEach((kind) => catalog[kind].clear());
          writeSaved([]);
        } else {
        loadSaved().forEach((payload) => {
          if (isTombstoned(payload.kind, payload.name)) {
            return;
          }
          const existing = findEntryByName(payload.kind, payload.name);
          if (existing) {
            if (existing.dataset['kdCreated'] === '1') {
              enhanceObject(existing, payload.kind);
              bindObjectClick(existing, payload.kind);
            }
            return;
          }
          const inCatalog = [...catalog[payload.kind].keys()].some((name) => sameName(name, payload.name));
          if (inCatalog || skipDomSnapshot) {
            // Already synchronized. Do not create another card on observer ticks
            // or the 6 delayed ensureAddButtons passes after import.
            return;
          }
          // Reload restore uses the same canonical creation pipeline, but only
          // when the object is actually absent from the embedded UI.
          upsertObject(payload);
        });
        }
        if (!isUiCleared()) {
        doc.querySelectorAll<HTMLElement>('.kd-nifi-editable-entry, [data-kd-created="1"]').forEach((card) => {
          const parked = card.closest('[data-kd-add-host]') as HTMLElement | null;
          const inMain =
            /describe a flow or pick a skill|open actions, skills, or templates/i.test(
              card.parentElement?.textContent || ''
            ) || card.getBoundingClientRect().left > win.innerWidth * 0.42;
          if (parked && !inMain) {
            return;
          }
          const kindAttr = card.getAttribute('data-action')
            ? 'action'
            : card.getAttribute('data-skill')
              ? 'skill'
              : card.getAttribute('data-template')
                ? 'template'
                : null;
          if (!kindAttr) {
            return;
          }
          if (isTombstoned(kindAttr, entryName(card, kindAttr))) {
            card.remove();
            return;
          }
          insertCreatedIntoSection(card, kindAttr);
        });
        }
        snapshotDomObjects();
        renderCatalogIntoLists();
        dedupeKindLists();
        ensureTopAddBar();
        ensureBottomIo();
        relabelActionHeaders();
        collapseRailSections(false);
        bindPromptWait();
        pinIoBar();
        updateKindCounts();
      } finally {
        ensuring = false;
      }
    };

    const sectionKindFor = (el: Element): ObjectKind | null => {
      const host = el.closest('[data-kd-add-host]') as HTMLElement | null;
      const fromHost = host?.getAttribute('data-kd-add-host');
      if (fromHost === 'skill' || fromHost === 'action' || fromHost === 'template') {
        return fromHost;
      }
      let node: Element | null = el;
      for (let i = 0; i < 12 && node; i += 1, node = node.parentElement) {
        const prev = node.previousElementSibling;
        const head = `${prev?.textContent || ''} ${node.getAttribute('aria-label') || ''}`;
        const kind = headingKind(head.replace(/\s+/g, ' ').trim());
        if (kind) {
          return kind;
        }
      }
      return null;
    };

    const collectParams = (card: Element, sourceText: string, kind: ObjectKind | null): string[] => {
      const found = new Set<string>(placeholders(sourceText));
      const attrKeys = [
        'data-params',
        'data-parameters',
        'data-args',
        'data-arguments',
        'data-schema',
        'data-inputs'
      ];
      const scan = (el: Element): void => {
        for (const key of attrKeys) {
          const raw = el.getAttribute(key);
          if (!raw) {
            continue;
          }
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                if (typeof item === 'string') {
                  found.add(item);
                } else if (item && typeof item === 'object' && 'name' in item) {
                  found.add(String((item as { name: string }).name));
                }
              }
            } else if (parsed && typeof parsed === 'object') {
              Object.keys(parsed as object).forEach((k) => found.add(k));
            }
          } catch {
            raw.split(/[,;|]/).forEach((p) => p.trim() && found.add(p.trim()));
          }
        }
      };
      scan(card);
      card.querySelectorAll('[data-params], [data-parameters], [name], [placeholder]').forEach((el) => {
        scan(el);
        const name = el.getAttribute('name') || el.getAttribute('placeholder') || '';
        if (name && !/^(search|query|q)$/i.test(name)) {
          found.add(name);
        }
      });
      return [...found];
    };

    const isCollapseToggle = (el: HTMLElement): boolean => {
      if (el.closest('#kd-nifi-param-overlay, #kd-nifi-add-group, .kd-nifi-add-entry, .kd-nifi-io-row')) {
        return false;
      }
      if (el.closest('summary, details > summary, .nav-toggle, [class*="nav-toggle"]')) {
        return true;
      }
      const trimmed = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (/^(actions?|skills?|templates?)(\s+\d+)?$/i.test(trimmed)) {
        return true;
      }
      return false;
    };

    const isListEntry = (el: HTMLElement): boolean => {
      if (el.closest('#kd-nifi-param-overlay, #kd-nifi-add-group, [data-kd-add], .kd-nifi-add-entry, .kd-nifi-object-actions, .kd-nifi-io-row')) {
        return false;
      }
      if (isCollapseToggle(el)) {
        return false;
      }
      return !!el.closest(
        '[data-kd-add-host] li, [data-kd-add-host] [role="listitem"], [data-skill], [data-action], [data-template], [data-prompt]'
      );
    };

    this.zone.runOutsideAngular(() => {
      win.addEventListener(
        'keydown',
        (event: KeyboardEvent) => {
          if (event.key !== 'Escape') {
            return;
          }
          if (doc.getElementById('kd-nifi-param-overlay')) {
            event.preventDefault();
            event.stopPropagation();
            closeOverlay();
            return;
          }
          const native = nativeParamDialog();
          if (native) {
            event.preventDefault();
            event.stopPropagation();
            const cancel = Array.from(native.querySelectorAll('button')).find((b) =>
              /cancel|close/i.test(b.textContent || b.getAttribute('aria-label') || '')
            );
            (cancel as HTMLButtonElement | undefined)?.click();
            if (!cancel) {
              native.remove();
            }
          }
        },
        true
      );

      doc.addEventListener(
        'click',
        (event: MouseEvent) => {
          const target = event.target as HTMLElement | null;
          if (!target) {
            return;
          }
          const nativeNow = nativeParamDialog();
          if (nativeNow) {
            enhanceNative(nativeNow);
          }
          const btn = target.closest('button, a, [role="button"], summary, [aria-expanded]') as HTMLElement | null;
          const label = (btn?.textContent || btn?.getAttribute('aria-label') || '').trim().toLowerCase();
          if (btn && isCollapseToggle(btn)) {
            return;
          }
          if (btn && (label === 'cancel' || label === 'close') && !btn.closest('#kd-nifi-param-overlay')) {
            const dialog = btn.closest('[role="dialog"], .modal, .popup, .overlay, dialog') as HTMLElement | null;
            if (dialog && dialog.id !== 'kd-nifi-param-dialog') {
              event.preventDefault();
              event.stopPropagation();
              dialog.remove();
              return;
            }
          }
          if (btn && /^send$/i.test(label)) {
            const box = promptComposer();
            if (box && (box.value || '').trim()) {
              showPromptWait();
            }
          }
          if (/^\+?\s*add\s+(action|skill|template)s?$/.test(label)) {
            const isOurs =
              isAddBtn(btn) || !!btn?.closest('#kd-nifi-add-group');
            if (label.includes('template') && !isOurs) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            const kind: ObjectKind = label.includes('skill')
              ? 'skill'
              : label.includes('action')
                ? 'action'
                : 'template';
            const host = hostForKind(kind);
            openCreate(kind, host);
            return;
          }

          const hit = target.closest(
            '[data-kd-add-host] li, [data-kd-add-host] [role="listitem"], [data-skill], [data-action], [data-template], [data-prompt], button, a, [role="button"]'
          ) as HTMLElement | null;
          if (hit?.dataset['kdParamResume'] === '1') {
            return;
          }
          if (!hit || !isListEntry(hit) || hit.id === 'kd-nifi-param-continue' || hit.id === 'kd-nifi-param-cancel') {
            return;
          }
          if (label === 'cancel' || label === 'close' || label === 'continue' || label === 'run' || label === 'save') {
            return;
          }

          const card =
            (hit.closest(
              '.kd-nifi-editable-entry, [data-kd-created="1"], [data-kd-runnable="1"], li, [role="listitem"], article, .card, [data-skill], [data-action], [data-template]'
            ) as HTMLElement | null) || hit;
          if (target.closest('.kd-nifi-object-actions')) {
            return;
          }
          const created = card.dataset['kdCreated'] === '1' || card.dataset['kdRunnable'] === '1';
          if (created) {
            event.preventDefault();
            event.stopPropagation();
            const kind = sectionKindFor(card) || sectionKindFor(hit);
            const sourceText = sourcePromptFor(card, kind);
            const params = collectParams(card, sourceText, kind);
            if (!params.length) {
              if (!runCreatedCard(card)) {
                showMessage({ message: 'This item could not be run: the prompt box of the NiFi AI page was not found.' });
              }
              return;
            }
            if (doc.getElementById('kd-nifi-param-overlay')) {
              return;
            }
            openDialog({
              title:
                card.getAttribute('data-skill') ||
                card.getAttribute('data-action') ||
                card.getAttribute('data-template') ||
                'Run object',
              subtitle: 'Fill the parameters, then Continue to send this prompt.',
              sourceText,
              params,
              mode: 'run',
              resume: () => undefined
            });
            return;
          }
          const kind = sectionKindFor(card) || sectionKindFor(hit);
          const sourceText = (
            card.getAttribute('data-prompt') ||
            card.getAttribute('data-template') ||
            card.getAttribute('title') ||
            card.textContent ||
            ''
          )
            .replace(/\s+/g, ' ')
            .trim();
          const params = collectParams(card, sourceText, kind);
          const title =
            card.getAttribute('data-skill') ||
            card.getAttribute('data-action') ||
            card.getAttribute('data-template') ||
            (card.querySelector('.side-btn__title, span')?.textContent || '').trim() ||
            sourceText.slice(0, 80) ||
            'Complete action';

          if (/sap ingest|nifi version|service discovery/i.test(title + ' ' + sourceText) && !created) {
            // Native built-ins already bind their own click → /chat. Still
            // report the run so the orchestrator log shows runObject.
            notifyServerMcp('runObject', {
              kind: kind || null,
              name: title,
              prompt: sourceText,
              values: {}
            });
            return;
          }

          // No parameters on this item — let NiFi run the prompt as-is, but
          // still report the run to the server as an MCP request.
          if (!params.length) {
            notifyServerMcp('runObject', {
              kind: kind || null,
              name: title,
              prompt: sourceText,
              values: {}
            });
            return;
          }

          event.preventDefault();
          event.stopPropagation();
          openDialog({
            title,
            subtitle: 'Fill the parameters, then Continue.',
            sourceText,
            params,
            mode: 'run',
            kind: kind || undefined
          });
        },
        true
      );

      if (isUiCleared()) {
        setUiCleared(true);
      }
      hydrateCatalog();
      ensureAddButtons();
      if (isUiCleared()) {
        wipeUiObjectLists();
      }
      bindPromptWait();
      pinIoBar();
      win.addEventListener('resize', () => pinIoBar());
      [150, 400, 900, 1600, 2800, 4500].forEach((ms) => {
        win.setTimeout(() => {
          if (isUiCleared()) {
            wipeUiObjectLists();
          } else {
            dedupeKindLists();
          }
          ensureAddButtons();
          bindPromptWait();
          pinIoBar();
          updateKindCounts();
        }, ms);
      });
      let obsTimer = 0;
      listObserver = new MutationObserver(() => {
        if (ensuring) {
          return;
        }
        const wait = doc.getElementById('kd-nifi-prompt-wait');
        if (wait?.classList.contains('is-on')) {
          const busy = doc.querySelector('[aria-busy="true"], .streaming, .thinking, .spinner, .loading');
          if (!busy) {
            const box = promptComposer();
            if (box && !(box.value || '').trim()) {
              hidePromptWait();
            }
          }
        }
        if (obsTimer) {
          return;
        }
        obsTimer = win.setTimeout(() => {
          obsTimer = 0;
          if (isUiCleared()) {
            wipeUiObjectLists();
          }
          ensureAddButtons();
          bindPromptWait();
        }, 250);
      });
      listObserver.observe(doc.documentElement, { childList: true, subtree: true });

      const loadDefaultItems = (): void => {
        const urls = [
          '/assets/config/kd-nifi-items-default.json',
          'kd-nifi-items-default.json',
          '/nifi-ai/kd-nifi-items-default.json'
        ];
        const tryNext = (index: number): void => {
          if (index >= urls.length) {
            showMessage({
              title: 'Default items',
              message: 'Could not load kd-nifi-items-default.json.'
            });
            return;
          }
          window
            .fetch(urls[index])
            .then((response) => {
              if (!response.ok) {
                throw new Error(String(response.status));
              }
              return response.json();
            })
            .then((data: { objects?: ObjectPayload[] } | ObjectPayload[]) => {
              const objects = Array.isArray(data) ? data : data.objects || [];
              const payloads = objects.filter((item) => item && item.kind && item.name);
              if (!payloads.length) {
                showMessage({ title: 'Default items', message: 'The default file has no Actions, Skills, or Templates.' });
                return;
              }
              importPayloads(payloads, payloads[0].kind);
              const counts = { action: 0, skill: 0, template: 0 };
              payloads.forEach((item) => {
                counts[item.kind] += 1;
              });
              showMessage({
                title: 'Default items loaded',
                message: `Loaded ${counts.action} actions, ${counts.skill} skills, and ${counts.template} templates from kd-nifi-items-default.json.`
              });
            })
            .catch(() => tryNext(index + 1));
        };
        tryNext(0);
      };

      const offerDefaultItems = (): void => {
        if (doc.documentElement.dataset['kdDefaultOffer'] === '1') {
          return;
        }
        doc.documentElement.dataset['kdDefaultOffer'] = '1';
        showMessage({
          title: 'Load default items?',
          message:
            'Load the default Actions, Skills, and Templates from kd-nifi-items-default.json? This replaces the current lists with the default set, including SAP ingest.',
          confirmLabel: 'Load defaults',
          cancelLabel: 'Not now',
          onConfirm: () => loadDefaultItems()
        });
      };
      (win as Window & { __kdOfferDefaultItems?: () => void }).__kdOfferDefaultItems = offerDefaultItems;
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    // Inner skill/template parameter dialog owns Escape first.
    const frame = document.querySelector('.nifi-ai-modal__frame') as HTMLIFrameElement | null;
    const inner = frame?.contentDocument?.getElementById('kd-nifi-param-overlay');
    if (inner) {
      return;
    }
    if (this.open()) {
      this.close();
    }
  }

  @HostListener('window:message', ['$event'])
  onFrameMessage(event: MessageEvent): void {
    const data = event.data;
    if (!data || data.type !== 'kd-nifi-ai') {
      return;
    }
    if (data.action === 'home' || data.action === 'close') {
      this.close();
    }
    if (data.action === 'clear-all') {
      this.nifiAi.reportClearAll(data.body || { method: data.method || 'clearAllObjects' });
    }
    if (data.action === 'mcp' && data.body) {
      this.nifiAi.reportMcp(data.body);
    }
  }
}