import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';

export interface NifiAiConfig {
  enabled: boolean;
  mode?: 'none' | 'local' | 'external';
  uiUrl?: string;
  directUiUrl?: string;
  orchestratorUrl?: string;
  /** Initial masked/visible state of the NiFi login password field in the
   *  NiFi AI modal. true (default) = masked. false = shown in plain text
   *  as soon as the form loads. The show/hide toggle button still works
   *  either way — see nifi-ai-modal.component.ts. */
  hidePassword?: boolean;
}

const DEFAULTS: NifiAiConfig = {
  enabled: false,
  mode: 'none',
  uiUrl: '/nifi-ai/?theme=kd',
  directUiUrl: 'http://localhost:27120/?theme=kd',
  orchestratorUrl: 'http://localhost:27110',
  hidePassword: true
};

/**
 * Runtime flag written by kd-demo/init.sh into assets/config/nifi-ai.json.
 * When enabled, the header shows "NiFi AI" and the in-page overlay can open.
 */
@Injectable({ providedIn: 'root' })
export class NifiAiService {
  private readonly http = inject(HttpClient);

  readonly enabled = signal(false);
  readonly uiUrl = signal(DEFAULTS.uiUrl!);
  readonly mode = signal<NifiAiConfig['mode']>('none');
  readonly overlayOpen = signal(false);
  readonly hidePassword = signal(DEFAULTS.hidePassword!);
  readonly orchestratorUrl = signal(DEFAULTS.orchestratorUrl!);

  constructor() {
    this.http
      .get<NifiAiConfig>('assets/config/nifi-ai.json')
      .pipe(catchError(() => of(DEFAULTS)))
      .subscribe((cfg) => {
        const enabled = !!cfg?.enabled;
        this.enabled.set(enabled);
        this.mode.set(cfg?.mode || (enabled ? 'local' : 'none'));
        this.uiUrl.set(cfg?.uiUrl || cfg?.directUiUrl || DEFAULTS.uiUrl!);
        this.hidePassword.set(cfg?.hidePassword !== false);
        this.orchestratorUrl.set(cfg?.orchestratorUrl || DEFAULTS.orchestratorUrl!);
      });
  }

  openOverlay(): void {
    if (!this.enabled()) {
      return;
    }
    this.overlayOpen.set(true);
  }

  closeOverlay(): void {
    this.overlayOpen.set(false);
  }

  toggleOverlay(): void {
    if (!this.enabled()) {
      return;
    }
    this.overlayOpen.update((open) => !open);
  }

  /**
   * Record a Clear all invocation on the KD admin-config server so the
   * process log shows `calling method=clearAllObjects`. The server also
   * forwards the same payload to the NiFi orchestrator and UI ports.
   */
  reportClearAll(payload: Record<string, unknown> = {}): void {
    const body = {
      method: 'clearAllObjects',
      action: 'clear-all',
      kinds: ['action', 'skill', 'template'],
      ...payload
    };
    this.http
      .post('/api/admin/nifi-ai/clear-all', body)
      .pipe(catchError(() => of(null)))
      .subscribe();
  }

  /**
   * Send a `runObject` / `refreshObjects` MCP request to the KD admin-config
   * server (POST /api/admin/nifi-ai/mcp). Used as a fallback when the embedded
   * iframe cannot reach the server itself.
   */
  reportMcp(body: Record<string, unknown>): void {
    this.http
      .post('/api/admin/nifi-ai/mcp', body)
      .pipe(catchError(() => of(null)))
      .subscribe();
  }
}
