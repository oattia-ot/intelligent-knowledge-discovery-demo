import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AppSettingsService } from './app-settings.service';
import { EndpointHealthService, VerifyResult } from './endpoint-health.service';

export type PreflightPhase = 'idle' | 'checking' | 'ok' | 'down' | 'skipped';

export type PreflightReason = 'ok' | 'stub' | 'unreachable' | 'proxy' | 'spaFallback' | 'unexpected';

export interface PreflightSnapshot {
  phase: PreflightPhase;
  reason: PreflightReason;
  message: string;
  status?: number;
  url?: string;
  /** True when the login form may be submitted. */
  allowLogin: boolean;
}

const AUTN_NS = 'http://schemas.autonomy.com/aci/';

/**
 * Startup / login-gate health check for Community.
 *
 * Unlike Settings → Test (which probes the raw upstream via /__kd-probe),
 * pre-flight hits the same Community base URL that `AuthService.login` uses.
 * That is the path the user will actually authenticate against, and it also
 * detects the common failure where a dead proxy location is served as the
 * Angular SPA (login HTML) instead of ACI XML.
 */
@Injectable({ providedIn: 'root' })
export class PreflightHealthService {
  private readonly http = inject(HttpClient);
  private readonly appSettings = inject(AppSettingsService);
  private readonly endpointHealth = inject(EndpointHealthService);

  private readonly _phase = signal<PreflightPhase>('idle');
  private readonly _reason = signal<PreflightReason>('ok');
  private readonly _message = signal('');
  private readonly _status = signal<number | undefined>(undefined);
  private readonly _url = signal<string | undefined>(undefined);
  private inFlight: Promise<PreflightSnapshot> | null = null;

  readonly phase = this._phase.asReadonly();
  readonly reason = this._reason.asReadonly();
  readonly message = this._message.asReadonly();
  readonly status = this._status.asReadonly();
  readonly url = this._url.asReadonly();

  readonly allowLogin = computed(() => {
    const phase = this._phase();
    return phase === 'ok' || phase === 'skipped';
  });

  readonly snapshot = computed<PreflightSnapshot>(() => ({
    phase: this._phase(),
    reason: this._reason(),
    message: this._message(),
    status: this._status(),
    url: this._url(),
    allowLogin: this.allowLogin()
  }));

  /**
   * Run (or join) a Community pre-flight check.
   * Stub-auth builds skip the network call so the shell still works offline.
   */
  async run(force = false): Promise<PreflightSnapshot> {
    if (!force && this.inFlight) {
      return this.inFlight;
    }
    if (!force && (this._phase() === 'ok' || this._phase() === 'skipped')) {
      return this.snapshot();
    }

    this._phase.set('checking');
    this._message.set('');
    this._status.set(undefined);

    this.inFlight = this.execute().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async execute(): Promise<PreflightSnapshot> {
    if (environment.useStubAuth) {
      return this.finish({
        phase: 'skipped',
        reason: 'stub',
        message: 'Offline stub auth — Community pre-flight skipped.',
        allowLogin: true
      });
    }

    await Promise.all([this.appSettings.ready, this.endpointHealth.ensureLoaded()]);

    const base = this.appSettings.requestUrl('communityApiUrl').replace(/\/?$/, '/');
    const params = new HttpParams().set('action', 'GetStatus');
    const timeoutMs = this.endpointHealth.timeoutMs();

    try {
      const resp = await firstValueFrom(
        this.http
          .get(base, { params, responseType: 'text', observe: 'response' })
          .pipe(timeout(timeoutMs))
      );
      const body = typeof resp.body === 'string' ? resp.body : '';
      const classified = this.classifyBody(body, resp.status);
      return this.finish({
        ...classified,
        status: resp.status,
        url: resp.url || `${base}?action=GetStatus`
      });
    } catch (err: unknown) {
      // Proxy /community may still point at http://127.0.0.1:9030 while Test
      // already reaches https://<idol-host>:9030 via the probe. If the probe
      // succeeds, Community is up — allow login and send UserRead the same way.
      const probed = await this.tryProbeFallback();
      if (probed) return this.finish(probed);
      return this.finish(this.classifyError(err, base, timeoutMs));
    }
  }

  private classifyBody(
    xmlText: string,
    status: number
  ): Pick<PreflightSnapshot, 'phase' | 'reason' | 'message' | 'allowLogin'> {
    const looksHtml =
      /<html[\s>]|<HTML[\s>]|<app-root[\s>]|class="login-page"|class="login-card"/i.test(
        xmlText
      );
    const looksAci =
      /autnresponse|schemas\.autonomy\.com\/aci/i.test(xmlText) ||
      /<(response|action)>/i.test(xmlText);

    if (looksHtml && !looksAci) {
      return {
        phase: 'down',
        reason: 'spaFallback',
        allowLogin: false,
        message:
          'Community path returned the application HTML instead of ACI XML. The proxy location is missing or falling through to the SPA.'
      };
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) {
      return {
        phase: 'down',
        reason: 'unexpected',
        allowLogin: false,
        message: `Community GetStatus returned a non-XML body (HTTP ${status}).`
      };
    }

    const responseStatus =
      doc.querySelector('response')?.textContent?.trim() ||
      doc.getElementsByTagNameNS(AUTN_NS, 'response')[0]?.textContent?.trim();

    if (responseStatus && responseStatus !== 'SUCCESS') {
      const detail =
        doc.querySelector('errordescription')?.textContent?.trim() ||
        responseStatus;
      return {
        phase: 'down',
        reason: 'unexpected',
        allowLogin: false,
        message: `Community GetStatus failed: ${detail}`
      };
    }

    if (status >= 200 && status < 300 && (responseStatus === 'SUCCESS' || looksAci)) {
      return {
        phase: 'ok',
        reason: 'ok',
        allowLogin: true,
        message: `Community reachable (HTTP ${status}).`
      };
    }

    return {
      phase: 'down',
      reason: 'unexpected',
      allowLogin: false,
      message: `Community GetStatus unexpected response (HTTP ${status}).`
    };
  }

  private classifyError(err: unknown, base: string, timeoutMs: number): PreflightSnapshot {
    const url = `${base}?action=GetStatus`;
    const name =
      err && typeof err === 'object' && 'name' in err
        ? String((err as { name: string }).name)
        : '';

    if (name === 'TimeoutError') {
      return {
        phase: 'down',
        reason: 'unreachable',
        allowLogin: false,
        url,
        message: `Community did not respond within ${timeoutMs}ms.`
      };
    }

    if (err instanceof HttpErrorResponse) {
      const body = typeof err.error === 'string' ? err.error : '';
      if (body && /<html[\s>]|<app-root[\s>]|class="login-page"/i.test(body)) {
        return {
          phase: 'down',
          reason: 'spaFallback',
          allowLogin: false,
          status: err.status,
          url,
          message:
            'Community path returned the application HTML instead of ACI XML. The proxy location is missing or falling through to the SPA.'
        };
      }
      if (err.status === 0) {
        return {
          phase: 'down',
          reason: 'unreachable',
          allowLogin: false,
          status: 0,
          url,
          message: 'Cannot reach Community (network, CORS, or proxy refused the connection).'
        };
      }
      if (err.status === 502 || err.status === 503 || err.status === 504) {
        return {
          phase: 'down',
          reason: 'proxy',
          allowLogin: false,
          status: err.status,
          url,
          message: `Community proxy error (HTTP ${err.status}). The component is not responding.`
        };
      }
      return {
        phase: 'down',
        reason: 'unexpected',
        allowLogin: false,
        status: err.status,
        url,
        message: `Community pre-flight failed (HTTP ${err.status}).`
      };
    }

    return {
      phase: 'down',
      reason: 'unreachable',
      allowLogin: false,
      url,
      message: 'Cannot reach Community.'
    };
  }

  private finish(
    snap: Omit<PreflightSnapshot, 'allowLogin'> & { allowLogin?: boolean }
  ): PreflightSnapshot {
    const allowLogin =
      snap.allowLogin ?? (snap.phase === 'ok' || snap.phase === 'skipped');
    this._phase.set(snap.phase);
    this._reason.set(snap.reason);
    this._message.set(snap.message);
    this._status.set(snap.status);
    this._url.set(snap.url);
    return { ...snap, allowLogin };
  }

  /**
   * Same path as Settings → Test. Used when /community proxy still points
   * at localhost HTTP but Community is reachable at https://host:9030.
   */
  private async tryProbeFallback(): Promise<PreflightSnapshot | null> {
    try {
      const result = await this.endpointHealth.verify(
        this.appSettings.communityApiUrl(),
        'communityApiUrl'
      );
      if (result.state === 'ok') {
        return {
          phase: 'ok',
          reason: 'ok',
          allowLogin: true,
          status: result.status,
          url: result.url,
          message:
            `Community reachable via Test probe (HTTP ${result.status ?? 200}). ` +
            'Login will use the same upstream.'
        };
      }
    } catch {
      /* fall through */
    }
    return null;
  }

  /**
   * Optional extra probe of the configured upstream (Settings Test path).
   * Used only for diagnostics; it does not gate the login form.
   */
  async probeUpstream(): Promise<VerifyResult> {
    await Promise.all([this.appSettings.ready, this.endpointHealth.ensureLoaded()]);
    const raw = this.appSettings.communityApiUrl().trim();
    const host = this.appSettings.baseHost().trim();
    const base = /^https?:\/\//i.test(raw)
      ? raw
      : host
        ? this.appSettings.composeUrl(raw.startsWith('/') ? raw : `/${raw}`)
        : '';
    return this.endpointHealth.verify(base, 'communityApiUrl');
  }
}
