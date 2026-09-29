import { Injectable, signal } from '@angular/core';

export type SettingsTab = 'business' | 'application' | 'databases' | 'localization';

/**
 * localStorage key used to survive a dev-server restart (see
 * UpstreamHostAdminService.saveHost / "Apply to all"). Clicking "Apply to
 * all" makes dev.mjs kill and respawn `ng serve`; the Angular CLI's own
 * live-reload client then does a full `window.location.reload()` once it
 * reconnects, which wipes every in-memory signal — including this
 * service's `_open` — the same way any other full page reload would.
 * That reload is what looked like "the window closes and goes back to
 * the home page". We can't stop the dev server from restarting (that's
 * required for the new upstream host to take effect), so instead we
 * leave a breadcrumb here right before the restart and re-open Settings
 * on the tab the user was on as soon as this service is constructed
 * again after the page comes back.
 */
const REOPEN_STORAGE_KEY = 'kd-settings-reopen-after-restart';

/**
 * Controls the centralized Settings modal (single gear → three tabs).
 */
@Injectable({ providedIn: 'root' })
export class SettingsUiService {
  private readonly _open = signal(false);
  private readonly _tab = signal<SettingsTab>('business');

  readonly open = this._open.asReadonly();
  readonly tab = this._tab.asReadonly();

  constructor() {
    // If a dev-server-restart reload just happened, reopen right where
    // the user left off instead of landing on the home page.
    try {
      const savedTab = window.localStorage.getItem(REOPEN_STORAGE_KEY);
      if (savedTab) {
        window.localStorage.removeItem(REOPEN_STORAGE_KEY);
        this.show(this.isSettingsTab(savedTab) ? savedTab : 'application');
      }
    } catch {
      // localStorage unavailable (e.g. private mode) — nothing to restore.
    }
  }

  private isSettingsTab(value: string): value is SettingsTab {
    return value === 'business' || value === 'application' || value === 'databases' || value === 'localization';
  }

  /** Call right before an action that may cause a dev-server-restart page
   *  reload, so Settings reopens on `tab` once the page comes back. */
  markReopenAfterRestart(tab: SettingsTab): void {
    try {
      window.localStorage.setItem(REOPEN_STORAGE_KEY, tab);
    } catch {
      // Ignore — worst case Settings just won't auto-reopen.
    }
  }

  /** Cancel a pending reopen — call if a restart turns out not to be
   *  happening after all (save failed, endpoint unavailable, etc.). */
  clearReopenAfterRestart(): void {
    try {
      window.localStorage.removeItem(REOPEN_STORAGE_KEY);
    } catch {
      // Ignore.
    }
  }

  show(tab: SettingsTab = 'business'): void {
    this._tab.set(tab);
    this._open.set(true);
  }

  hide(): void {
    this._open.set(false);
  }

  toggle(): void {
    if (this._open()) {
      this.hide();
    } else {
      this.show('business');
    }
  }

  setTab(tab: SettingsTab): void {
    this._tab.set(tab);
  }
}
