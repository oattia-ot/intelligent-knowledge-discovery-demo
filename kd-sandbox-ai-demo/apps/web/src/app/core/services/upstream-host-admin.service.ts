import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom, timeout } from 'rxjs';

export interface CurrentHostResponse {
  host: string;
  protocol?: 'http' | 'https';
  canRestart: boolean;
}

export interface UpdateHostResponse {
  ok: boolean;
  host?: string;
  restarting?: boolean;
  error?: string;
}

export type UpstreamHostSaveState = 'idle' | 'saving' | 'restarting' | 'ok' | 'error' | 'unavailable';

/**
 * Talks to scripts/admin-server.mjs via the '/__kd-admin' dev-proxy
 * entry (see proxy.conf.mjs). Dev-only: this endpoint only exists when
 * the app was started with `npm start` (scripts/dev.mjs) — it's not
 * proxied at all in a production/nginx deployment, and requests there
 * will fail, which callers should treat the same as "unavailable".
 */
@Injectable({ providedIn: 'root' })
export class UpstreamHostAdminService {
  private readonly http = inject(HttpClient);

  readonly saveState = signal<UpstreamHostSaveState>('idle');
  readonly saveMessage = signal<string>('');

  /** Current upstreamHost from config.json, plus whether this dev server can restart itself. */
  async fetchCurrentHost(): Promise<CurrentHostResponse | null> {
    try {
      return await firstValueFrom(
        this.http.get<CurrentHostResponse>('/__kd-admin/current-host').pipe(timeout(4000))
      );
    } catch {
      // No admin server reachable — e.g. built/deployed app, or started via serve.sh.
      return null;
    }
  }

  /**
   * Save a new upstream host and, if the dev server supports it, restart
   * `ng serve` to apply it. Updates saveState/saveMessage as it goes so
   * the Settings UI can show progress without extra plumbing.
   */
  async saveHost(host: string, protocol?: 'http' | 'https'): Promise<void> {
    // Empty string is allowed: clears config.json "upstreamHost" to "" so the
    // next start falls back to KD_UPSTREAM_HOST env or the hardcoded default.
    const trimmed = (host ?? '').trim();
    const proto = protocol === 'http' || protocol === 'https' ? protocol : undefined;

    this.saveState.set('saving');
    this.saveMessage.set('');

    try {
      const res = await firstValueFrom(
        this.http
          .post<UpdateHostResponse>('/__kd-admin/update-host', {
            host: trimmed,
            ...(proto ? { protocol: proto } : {})
          })
          .pipe(timeout(8000))
      );

      if (!res.ok) {
        this.saveState.set('error');
        this.saveMessage.set(res.error || 'Failed to save.');
        return;
      }

      if (res.restarting) {
        this.saveState.set('restarting');
        this.saveMessage.set(
          trimmed
            ? 'Saved. Restarting dev server to apply the new host…'
            : 'Cleared upstreamHost (""). Restarting dev server to apply the fallback…'
        );
      } else {
        this.saveState.set('ok');
        this.saveMessage.set(
          trimmed
            ? 'Saved to config.json. Server restart required before the proxy uses the new host.'
            : 'Cleared upstreamHost (""). Server restart required before the fallback host is used.'
        );
      }
    } catch (err) {
      // A restart in progress can legitimately drop the connection before
      // the response is fully read — treat that as the expected outcome
      // rather than an error, since we already know from a prior 200 that
      // the dev.mjs restart flow kills its own HTTP server.
      if (this.saveState() === 'restarting') {
        return;
      }

      // Angular's HttpClient throws on any non-2xx response instead of
      // resolving it, so admin-server.mjs's {ok:false, error:"..."} body
      // (400 for a bad host, 500 for a write/generate-config failure)
      // never reaches the `!res.ok` branch above — it lands here. Pull
      // the real message out of the error body before falling back to a
      // generic string, so a validation or write failure doesn't get
      // reported as an unhelpful "Failed to save."
      let backendMessage: string | undefined;
      if (err instanceof HttpErrorResponse && err.error && typeof err.error === 'object') {
        const body = err.error as { error?: unknown };
        if (typeof body.error === 'string' && body.error) {
          backendMessage = body.error;
        }
      }

      const isUnreachable = err instanceof HttpErrorResponse && err.status === 0;
      const message = isUnreachable
        ? 'Could not reach the dev server admin endpoint. This only works when the app was started with `npm start` or `serve.sh` (which now also starts the admin server in save-only mode).'
        : (backendMessage ?? (err instanceof Error ? err.message : 'Failed to save.'));
      this.saveState.set(isUnreachable ? 'unavailable' : 'error');
      this.saveMessage.set(message);
    }
  }

  /**
   * Persist the live Content database catalog to config/databases.json
   * and apps/web/src/assets/config/databases.json (same admin server as
   * Backend upstream host). No ng serve restart required.
   */
  /**
   * Write Settings host:port edits into config/config.json (components[].upstream
   * + upstreamHost + protocol) via the admin server. No ng serve restart —
   * generate-config.mjs refreshes endpoint-health.json and the assets copy.
   */
  async persistEndpoints(payload: {
    host?: string;
    protocol?: 'http' | 'https';
    components: Array<{
      key: string;
      host?: string;
      port?: number;
      hostname?: string;
      protocol?: 'http' | 'https';
    }>;
  }): Promise<{ ok: boolean; changed?: string[]; error?: string }> {
    try {
      const res = await firstValueFrom(
        this.http
          .post<{ ok: boolean; changed?: string[]; error?: string }>(
            '/__kd-admin/update-endpoints',
            payload
          )
          .pipe(timeout(8000))
      );
      return res.ok ? res : { ok: false, error: res.error || 'Failed to update config.json.' };
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 0) {
        return { ok: false, error: 'Admin endpoint unavailable (start with npm start / serve.sh).' };
      }
      const body =
        err instanceof HttpErrorResponse && err.error && typeof err.error === 'object'
          ? (err.error as { error?: string }).error
          : undefined;
      return {
        ok: false,
        error: body || (err instanceof Error ? err.message : 'Failed to update config.json.')
      };
    }
  }

  async persistDatabases(file: {
    defaultScope?: string;
    databases: readonly object[];
  }): Promise<{ ok: boolean; count?: number; error?: string }> {
    try {
      const res = await firstValueFrom(
        this.http
          .post<{ ok: boolean; count?: number; error?: string }>(
            '/__kd-admin/update-databases',
            file
          )
          .pipe(timeout(8000))
      );
      return res.ok ? res : { ok: false, error: res.error || 'Failed to save databases.json.' };
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 0) {
        return { ok: false, error: 'Admin endpoint unavailable (start with npm start / serve.sh).' };
      }
      const body =
        err instanceof HttpErrorResponse && err.error && typeof err.error === 'object'
          ? (err.error as { error?: string }).error
          : undefined;
      return {
        ok: false,
        error: body || (err instanceof Error ? err.message : 'Failed to save databases.json.')
      };
    }
  }

  /** Current external LLM system (API key is never returned, only a hint). */
  async fetchExternalLlm(): Promise<{
    systemName: string;
    apiKeySet: boolean;
    apiKeyHint: string;
    systemNames: string;
  } | null> {
    try {
      return await firstValueFrom(
        this.http.get<{
          systemName: string;
          apiKeySet: boolean;
          apiKeyHint: string;
          systemNames: string;
        }>('/__kd-admin/current-answer').pipe(timeout(4000))
      );
    } catch {
      return null;
    }
  }

  /** Write the external LLM system into config/answer.json (+ assets copy). */
  async persistExternalLlm(payload: {
    systemName?: string;
    apiKey?: string;
    remove?: boolean;
  }): Promise<{
    ok: boolean;
    systemNames?: string;
    systemName?: string;
    apiKeySet?: boolean;
    error?: string;
  }> {
    try {
      const res = await firstValueFrom(
        this.http
          .post<{
            ok: boolean;
            systemNames?: string;
            systemName?: string;
            apiKeySet?: boolean;
            error?: string;
          }>('/__kd-admin/update-answer', payload)
          .pipe(timeout(8000))
      );
      return res.ok ? res : { ok: false, error: res.error || 'Failed to update answer.json.' };
    } catch (err) {
      if (err instanceof HttpErrorResponse && err.status === 0) {
        return { ok: false, error: 'Admin endpoint unavailable (start with npm start / serve.sh).' };
      }
      const body =
        err instanceof HttpErrorResponse && err.error && typeof err.error === 'object'
          ? (err.error as { error?: string }).error
          : undefined;
      return {
        ok: false,
        error: body || (err instanceof Error ? err.message : 'Failed to update answer.json.')
      };
    }
  }

  reset(): void {
    this.saveState.set('idle');
    this.saveMessage.set('');
  }
}
