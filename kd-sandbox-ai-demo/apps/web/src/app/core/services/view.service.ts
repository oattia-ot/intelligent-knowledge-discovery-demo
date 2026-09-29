import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, catchError, throwError, tap, switchMap, of, forkJoin } from 'rxjs';
import { AppSettingsService } from './app-settings.service';
import { AuthService } from './auth.service';
import { DocumentViewerSettingsService } from './document-viewer-settings.service';

export type ViewCallKind = 'preview' | 'download' | 'open-tab';

export interface ViewPreviewMetrics {
  actionId: string;
  /** Wall time from request start to blob ready (ms). */
  loadMs: number;
  /** Parent View HTML size (bytes). */
  parentBytes: number;
  /** Number of getlink partitions fetched (0 = single-page HTML). */
  partitionCount: number;
  /** Sum of partition HTML sizes (bytes). */
  partitionBytes: number;
  /** Final HTML size shown in the iframe (bytes). */
  displayBytes: number;
  multiPage: boolean;
  reference: string;
  /** Backend used to obtain the preview. */
  via?: 'view' | 'redaction' | 'url';
}

/**
 * IDOL View preview / download.
 *
 * Parent View (with SecurityInfo) often returns a multi-page *shell* for xECM:
 *   <iframe src="/action=getlink&linkspec=…&reference=OpenText:…">
 * Embedding that shell in a blob: iframe leaves nested frames broken/blank.
 *
 * Fix: fetch the parent HTML, follow getlink partition URLs through our /view
 * proxy, and show the *partition document HTML* (or a stitched multi-page body).
 *
 * ActionID is always set for View log correlation, e.g.:
 *   KD_Search_Preview_20260811T115626_OpenText-290116_dty0
 */
@Injectable({ providedIn: 'root' })
export class ViewService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly appSettings = inject(AppSettingsService);
  private readonly viewerSettings = inject(DocumentViewerSettingsService);

  lastActionId: string | null = null;

  private viewProxyBase(): string {
    const raw = (
      this.appSettings.requestUrl('viewServerUrl') ||
      this.appSettings.requestUrl('viewApiUrl') ||
      '/view'
    ).trim();
    if (raw.startsWith('/') && !/^https?:\/\//i.test(raw)) {
      return raw.replace(/^\/View\b/i, '/view').replace(/\/?$/, '/');
    }
    return raw.replace(/\/?$/, '/');
  }

  configuredViewEndpoint(): string {
    return this.viewProxyBase();
  }

  buildActionId(kind: ViewCallKind, reference: string): string {
    const kindLabel =
      kind === 'preview' ? 'Preview' : kind === 'download' ? 'Download' : 'OpenTab';
    const now = new Date();
    const ts =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      'T' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const refPart = (reference || 'noref')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48);
    const rand = Math.random().toString(36).slice(2, 6);
    return `KD_Search_${kindLabel}_${ts}_${refPart}_${rand}`;
  }

  buildViewActionUrl(
    reference: string,
    options: {
      outputType?: string;
      queryText?: string;
      kind?: ViewCallKind;
      actionId?: string;
    } = {}
  ): { url: string; actionId: string } {
    const token = this.auth.getSecurityInfo();
    const outputType = options.outputType || 'HTML';
    const queryText = options.queryText || '';
    const kind = options.kind || 'preview';
    const actionId = options.actionId || this.buildActionId(kind, reference);
    this.lastActionId = actionId;

    const links =
      queryText.trim() && queryText !== '*' ? queryText.replace(/ /g, '+') : '';

    let url =
      `${this.viewProxyBase()}?action=View` +
      `&ActionID=${encodeURIComponent(actionId)}` +
      `&OutputType=${encodeURIComponent(outputType)}` +
      `&EmbedImages=true` +
      `&StripScript=true` +
      `&NoACI=true` +
      `&OriginalBaseURL=true` +
      `&Boolean=true` +
      `&Reference=${encodeURIComponent(reference)}`;

    if (outputType === 'HTML' && links) {
      url +=
        `&Links=${encodeURIComponent(links)}` +
        `&StartTag=${encodeURIComponent("<mark class='kd-highlight'>")}` +
        `&EndTag=${encodeURIComponent('</mark>')}`;
    }

    if (token) {
      url += `&SecurityInfo=${encodeURIComponent(token)}`;
    }

    console.info('[KD View]', kind, actionId, { reference, outputType, url: url.replace(/SecurityInfo=[^&]+/, 'SecurityInfo=***') });

    return { url, actionId };
  }

  getViewUrl(reference: string, queryText?: string): string {
    return this.buildViewActionUrl(reference, {
      outputType: 'HTML',
      queryText,
      kind: 'open-tab'
    }).url;
  }

  /**
   * Load preview as a blob: URL of *displayable* HTML (not a broken multi-page shell).
   */
  getPreviewBlobUrl(
    reference: string,
    queryText?: string
  ): Observable<{ blobUrl: string; actionId: string; metrics: ViewPreviewMetrics }> {
    if (this.viewerSettings.mode() === 'redaction') {
      return this.getRedactedPreviewBlobUrl(reference);
    }
    const started = performance.now();
    const { url, actionId } = this.buildViewActionUrl(reference, {
      outputType: 'HTML',
      queryText,
      kind: 'preview'
    });

    return this.http.get(url, { responseType: 'text' }).pipe(
      tap((html) => {
        console.info('[KD View] parent HTML', {
          actionId,
          bytes: html?.length ?? 0,
          hasGetlink: /getlink/i.test(html || ''),
          sample: (html || '').slice(0, 160).replace(/\s+/g, ' ')
        });
      }),
      switchMap((html) => {
        if (!html?.trim()) {
          return throwError(
            () => new Error(`No preview content available. ActionID=${actionId}`)
          );
        }
        if (this.looksLikeAppShell(html)) {
          return throwError(
            () =>
              new Error(
                `Preview received the SPA instead of View HTML. ActionID=${actionId}. Check /view proxy.`
              )
          );
        }
        if (this.looksLikeViewError(html)) {
          return throwError(
            () =>
              new Error(
                (this.extractViewError(html) || 'View error') + ` ActionID=${actionId}`
              )
          );
        }

        const parentBytes = html.length;
        const partitionPaths = this.extractGetlinkPaths(html);
        if (partitionPaths.length === 0) {
          const flat = this.preparePreviewHtml(html, actionId);
          const loadMs = Math.round(performance.now() - started);
          const metrics: ViewPreviewMetrics = {
            actionId,
            loadMs,
            parentBytes,
            partitionCount: 0,
            partitionBytes: 0,
            displayBytes: flat.length,
            multiPage: false,
            reference
          };
          return of({ blobUrl: this.toBlobUrl(flat), actionId, metrics });
        }

        const fetches = partitionPaths.map((path, i) => {
          const nestedId = `${actionId}_p${i}`;
          const nestedUrl = this.toProxiedViewPath(path, nestedId);
          console.info('[KD View] partition fetch', {
            actionId: nestedId,
            nestedUrl: nestedUrl.slice(0, 160)
          });
          return this.http.get(nestedUrl, { responseType: 'text' }).pipe(
            map((partHtml) => ({ index: i, html: partHtml || '' })),
            catchError((err) => {
              console.warn('[KD View] partition failed', nestedId, err);
              return of({
                index: i,
                html: `<p style="color:#c62828">Failed to load page ${i + 1}. ActionID=${nestedId}</p>`
              });
            })
          );
        });

        return forkJoin(fetches).pipe(
          map((parts) => {
            parts.sort((a, b) => a.index - b.index);
            const partitionBytes = parts.reduce((n, p) => n + (p.html?.length || 0), 0);
            const bodies = parts.map((p) => this.extractBodyInner(p.html));
            const combined = this.preparePreviewHtml(
              bodies
                .map(
                  (b, i) =>
                    `<section class="kd-view-page" data-page="${i + 1}">${b}</section>`
                )
                .join('<hr class="kd-view-page-break" />'),
              actionId
            );
            const loadMs = Math.round(performance.now() - started);
            const metrics: ViewPreviewMetrics = {
              actionId,
              loadMs,
              parentBytes,
              partitionCount: parts.length,
              partitionBytes,
              displayBytes: combined.length,
              multiPage: true,
              reference
            };
            console.info('[KD View] combined partitions', metrics);
            return { blobUrl: this.toBlobUrl(combined), actionId, metrics };
          })
        );
      }),
      catchError((err) =>
        throwError(() => this.previewFailure(err, actionId, reference, url))
      )
    );
  }

  private getRedactedPreviewBlobUrl(
    reference: string
  ): Observable<{ blobUrl: string; actionId: string; metrics: ViewPreviewMetrics }> {
    const username = this.auth.getUser()?.username?.trim();
    if (!username) {
      return throwError(() => new Error('A signed-in user is required for redacted preview.'));
    }
    const started = performance.now();
    const actionId = this.buildActionId('preview', reference);
    const base = (this.viewerSettings.redactionApiUrl() || '').replace(/\/+$/, '');
    this.lastActionId = actionId;
    if (!base) {
      return throwError(() => new Error('Redaction API URL is not configured.'));
    }
    return this.http
      .post(
        `${base}/api/v1/redactions/html`,
        { username, DREREFERENCE: reference },
        { responseType: 'text' }
      )
      .pipe(
        map((html) => {
          const blob = new Blob([html], { type: 'text/html;charset=UTF-8' });
          const blobUrl = URL.createObjectURL(blob);
          const metrics: ViewPreviewMetrics = {
            actionId,
            loadMs: Math.round(performance.now() - started),
            parentBytes: blob.size,
            partitionCount: 0,
            partitionBytes: 0,
            displayBytes: blob.size,
            multiPage: false,
            reference,
            via: 'redaction'
          };
          return { blobUrl, actionId, metrics };
        })
      );
  }


  getDownloadUrl(reference: string): string {
    return this.buildViewActionUrl(reference, {
      outputType: 'raw',
      kind: 'download'
    }).url;
  }

  openDownload(reference: string): void {
    window.open(this.getDownloadUrl(reference), '_blank', 'noopener,noreferrer');
  }

  openInNewTab(reference: string, queryText?: string): void {
    window.open(
      this.buildViewActionUrl(reference, {
        outputType: 'HTML',
        queryText,
        kind: 'open-tab'
      }).url,
      '_blank',
      'noopener,noreferrer'
    );
  }

  /** Paths like /action=getlink&… from View shell HTML. */
  private extractGetlinkPaths(html: string): string[] {
    const paths: string[] = [];
    const re = /(?:src|href)=['"]([^'"]*getlink[^'"]*)['"]/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      let raw = m[1]
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim();
      if (!raw) {
        continue;
      }
      // Ensure leading slash for root-relative IDOL path style
      if (!raw.startsWith('/') && !/^https?:/i.test(raw)) {
        raw = '/' + raw;
      }
      if (!paths.includes(raw)) {
        paths.push(raw);
      }
    }
    return paths;
  }

  /**
   * Map /action=getlink&… → /view/action=getlink&…&ActionID=…
   * so the existing /view proxy forwards to View (pathRewrite strips /view).
   */
  private toProxiedViewPath(pathOrUrl: string, actionId: string): string {
    let path = pathOrUrl;
    if (/^https?:\/\//i.test(path)) {
      try {
        const u = new URL(path);
        path = u.pathname + u.search;
      } catch {
        /* keep */
      }
    }
    // Already proxied?
    if (path.startsWith('/view/') || path.startsWith('/View/')) {
      return this.appendActionId(path, actionId);
    }
    // /action=… → /view/action=…
    if (/^\/(action|Action)=/i.test(path)) {
      return this.appendActionId(`/view${path}`, actionId);
    }
    if (/^(action|Action)=/i.test(path)) {
      return this.appendActionId(`/view/${path}`, actionId);
    }
    return this.appendActionId(`/view${path.startsWith('/') ? path : '/' + path}`, actionId);
  }

  private appendActionId(path: string, actionId: string): string {
    if (/ActionID=/i.test(path)) {
      return path;
    }
    const joiner = path.includes('?') || path.includes('&') ? '&' : '&';
    // path-style IDOL URLs already use & as separators
    return `${path}${path.endsWith('&') || path.endsWith('?') ? '' : joiner}ActionID=${encodeURIComponent(actionId)}`;
  }

  private extractBodyInner(html: string): string {
    if (!html) {
      return '';
    }
    const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
    if (bodyMatch) {
      return bodyMatch[1];
    }
    // Many getlink partitions omit full html/body wrappers
    return html
      .replace(/^[\s\S]*?<head[^>]*>[\s\S]*?<\/head>/i, '')
      .replace(/<\/?html[^>]*>/gi, '');
  }

  /** Rewrite View asset URLs so PPT/PDF slide images load inside a blob iframe. */
  private preparePreviewHtml(html: string, actionId: string): string {
    return this.wrapPreviewDocument(this.rewriteViewAssets(html, actionId), actionId);
  }

  private rewriteViewAssets(html: string, actionId: string): string {
    const rewrite = (raw: string): string => {
      const trimmed = (raw || '').trim().replace(/^['"]|['"]$/g, '');
      if (
        !trimmed ||
        trimmed.startsWith('#') ||
        /^(data:|blob:|javascript:|mailto:)/i.test(trimmed)
      ) {
        return raw;
      }
      return this.toProxiedViewPath(trimmed, actionId);
    };
    return html
      .replace(/\b(src|href|poster)=(["'])([^"']+)\2/gi, (_m, attr, q, url) => `${attr}=${q}${rewrite(url)}${q}`)
      .replace(/url\((['"]?)([^'")]+)\1\)/gi, (_m, q, url) => `url(${q}${rewrite(url)}${q})`);
  }

  private wrapPreviewDocument(innerOrFullHtml: string, actionId: string): string {
    const hasHtml = /<html[\s>]/i.test(innerOrFullHtml);
    if (hasHtml && !/getlink/i.test(innerOrFullHtml)) {
      const style =
        `<style data-kd-preview>html,body{background:#fff!important;color:#1a1a1a!important}` +
        `img,svg{max-width:100%;height:auto;background:#fff}</style>`;
      if (/<head[^>]*>/i.test(innerOrFullHtml)) {
        return innerOrFullHtml.replace(
          /<head([^>]*)>/i,
          `<head$1><!-- KD ActionID=${actionId} -->${style}`
        );
      }
      return `${style}${innerOrFullHtml}`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="kd-action-id" content="${actionId.replace(/"/g, '')}" />
  <title>Preview</title>
  <style>
    html, body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; margin: 0; color: #1a1a1a !important; background: #fff !important; }
    body { padding: 1.25rem; }
    img, svg { max-width: 100%; height: auto; background: #fff; }
    .kd-view-page { margin-bottom: 1.5rem; background: #fff; }
    .kd-view-page-break { border: none; border-top: 1px solid #e2d9c8; margin: 1.5rem 0; }
    mark.kd-highlight { background: #fff3cd; padding: 0 0.12em; }
  </style>
</head>
<body data-kd-action-id="${actionId.replace(/"/g, '')}">
${innerOrFullHtml}
</body>
</html>`;
  }

  private toBlobUrl(html: string): string {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    return URL.createObjectURL(blob);
  }

  private previewFailure(
    err: unknown,
    actionId: string,
    reference: string,
    requestUrl: string
  ): Error {
    const safeUrl = (requestUrl || '').replace(/SecurityInfo=[^&]+/gi, 'SecurityInfo=***');
    const parts = [
      'Failed to load document preview.',
      'operation=preview',
      `service=${this.configuredViewEndpoint()}`,
      `Preview ActionID=${actionId}`,
      `Reference=${reference}`
    ];
    if (err instanceof HttpErrorResponse) {
      parts.push(`HTTP status=${err.status}`);
      const ctype = err.headers?.get?.('content-type') || err.headers?.get?.('Content-Type') || '';
      if (ctype) parts.push(`responseType=${ctype}`);
      if (err.status === 0) {
        parts.push('cause=endpoint unavailable or proxy/CORS/certificate failure');
      } else if (err.status === 404) {
        parts.push('cause=document not found or View path not proxied');
      } else if (err.status >= 500) {
        parts.push('cause=View service error');
      }
      if (err.message) parts.push(err.message);
    } else if (err instanceof Error && err.message) {
      if (!/Failed to load document preview/i.test(err.message)) {
        parts.push(err.message);
      } else {
        return err;
      }
    }
    parts.push(`request=${safeUrl}`);
    return new Error(parts.join(' '));
  }

  private looksLikeAppShell(html: string): boolean {
    const lower = html.toLowerCase();
    return (
      lower.includes('<app-root') ||
      lower.includes('kd enterprise search') ||
      (lower.includes('sign in') && lower.includes('knowledge discovery'))
    );
  }

  private looksLikeViewError(html: string): boolean {
    const lower = html.toLowerCase();
    return (
      lower.includes('viewing service encountered an error') ||
      lower.includes('input url or file not found')
    );
  }

  private extractViewError(html: string): string | null {
    const m = /<p>([^<]{5,200})<\/p>/i.exec(html);
    return m ? m[1].trim() : null;
  }
}
