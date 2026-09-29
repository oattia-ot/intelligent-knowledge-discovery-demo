import { HttpErrorResponse, HttpInterceptorFn, HttpParams, HttpResponse } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

const SKIP = /\.(json|svg|png|jpe?g|gif|webp|ico|woff2?|ttf|css|js|map|hbs)(\?|$)/i;

function shouldLog(url: string): boolean {
  if (!url || SKIP.test(url)) {
    return false;
  }
  // Always log ACI / chat / probe traffic
  if (
    /answerserver|AnswerServer|community|content|qms|view|agentstore|category|__kd-/i.test(
      url
    )
  ) {
    return true;
  }
  // Skip same-origin static config fetches
  if (url.includes('/assets/')) {
    return false;
  }
  return true;
}

function decodeBase64Json(value: string): unknown {
  try {
    const padded = value.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json);
  } catch {
    return value;
  }
}

function summarizeValue(key: string, value: string): unknown {
  if (key.toLowerCase() === 'data' && value && !value.trim().startsWith('{')) {
    const decoded = decodeBase64Json(value);
    return { encoding: 'base64', decoded };
  }
  if (/securityinfo|password|token|authorization/i.test(key)) {
    return '***';
  }
  return value;
}

function parseBody(body: unknown): Record<string, unknown> | unknown {
  if (body == null || body === '') {
    return undefined;
  }
  if (typeof body !== 'string') {
    return body;
  }
  if (body.trim().startsWith('{') || body.trim().startsWith('[')) {
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }
  const params = new HttpParams({ fromString: body });
  const out: Record<string, unknown> = {};
  for (const key of params.keys()) {
    const values = params.getAll(key) ?? [];
    const first = values[0] ?? '';
    out[key] = summarizeValue(key, first);
  }
  return out;
}

function queryFromUrl(url: string): Record<string, unknown> | undefined {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) {
    return undefined;
  }
  const params = new HttpParams({ fromString: url.slice(qIndex + 1) });
  if (!params.keys().length) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const key of params.keys()) {
    out[key] = summarizeValue(key, params.get(key) ?? '');
  }
  return out;
}

/**
 * Browser console log of every ACI / chat request the SPA sends.
 * Filter DevTools with:  [KD]
 */
function redactUrl(url: string): string {
  return url
    .replace(/Password=[^&]*/gi, 'Password=***')
    .replace(/SecurityInfo=[^&]*/gi, 'SecurityInfo=***');
}

export const endpointLogInterceptor: HttpInterceptorFn = (req, next) => {
  if (environment.production || !shouldLog(req.url)) {
    return next(req);
  }

  const started = performance.now();
  const query = queryFromUrl(req.urlWithParams);
  const body = parseBody(req.body);
  const payload: Record<string, unknown> = {
    method: req.method,
    url: redactUrl(req.urlWithParams),
    endpoint: req.url
  };
  if (query) {
    payload['query'] = query;
  }
  if (body !== undefined) {
    payload['body'] = body;
  }

  console.info('%c[KD] request → server', 'color:#0b7285;font-weight:600', payload);

  return next(req).pipe(
    tap({
      next: (event) => {
        if (!(event instanceof HttpResponse)) {
          return;
        }
        const ms = Math.round(performance.now() - started);
        console.info('%c[KD] response ← server', 'color:#2b8a3e;font-weight:600', {
          method: req.method,
          url: redactUrl(req.url),
          status: event.status,
          ms,
          bodyPreview:
            typeof event.body === 'string'
              ? event.body.slice(0, 400)
              : event.body
        });
      },
      error: (err: unknown) => {
        const httpErr = err as HttpErrorResponse;
        const ms = Math.round(performance.now() - started);
        console.error('%c[KD] request FAILED', 'color:#c92a2a;font-weight:600', {
          method: req.method,
          url: redactUrl(req.urlWithParams),
          status: httpErr?.status,
          statusText: httpErr?.statusText,
          ms,
          message: httpErr?.message,
          error: httpErr?.error
        });
      }
    })
  );
};
