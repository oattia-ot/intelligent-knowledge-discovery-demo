import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';
import { AppSettingsService } from './app-settings.service';
import { AuthService } from './auth.service';
import { ConfigService } from './config.service';

const DEFAULT_CONVERSATION_SYSTEM = 'KDChat';

const FORM_HEADERS = new HttpHeaders({
  'Content-Type': 'application/x-www-form-urlencoded'
});

export interface ConversationSessionOptions {
  systemName?: string;
  variables?: Record<string, string>;
}

/**
 * AnswerServer conversation ACI.
 *
 * Conversation systems do not support `action=Ask`. Flow:
 *   1. ManageResources operation=add type=conversation_session
 *   2. Converse SystemName + SessionID + Text
 *
 * ManageResources MUST be POST (OpenText Answer Server). Converse is also
 * POST so long questions / SecurityInfo never sit on the query string.
 * Same-origin proxy only (`/answerserver` dev, `/AnswerServer/` prod).
 */
@Injectable({ providedIn: 'root' })
export class ConversationService {
  private readonly http = inject(HttpClient);
  private readonly appSettings = inject(AppSettingsService);
  private readonly auth = inject(AuthService);
  private readonly config = inject(ConfigService);

  readonly converseTimeoutMs = 180_000;
  private conversationSystemName = DEFAULT_CONVERSATION_SYSTEM;
  private configLoadStarted = false;

  constructor() {
    this.ensureConfigLoaded();
  }

  systemName(): string {
    this.ensureConfigLoaded();
    return this.conversationSystemName || DEFAULT_CONVERSATION_SYSTEM;
  }

  createSession(options?: ConversationSessionOptions): Observable<string> {
    const system = (options?.systemName || this.systemName()).trim();
    const user = this.auth.getUser();
    const variables: Array<{ name: string; value: string }> = [
      { name: 'USER_NAME', value: user?.username || 'staff' }
    ];
    const token = this.auth.getSecurityInfo();
    if (token) {
      variables.push({ name: 'SECURITY_INFO', value: token });
    }
    for (const [name, value] of Object.entries(options?.variables ?? {})) {
      if (name && value != null && value !== '') {
        variables.push({ name, value: String(value) });
      }
    }

    const payload = {
      operation: 'add',
      type: 'conversation_session',
      session_variables: variables
    };
    const params = new HttpParams()
      .set('action', 'ManageResources')
      .set('SystemName', system)
      .set('Data', this.encodeManageData(payload))
      .set('ResponseFormat', 'simplejson');

    return this.post(params).pipe(
      timeout(30_000),
      map((body) => this.parseSessionId(body)),
      catchError((err) =>
        throwError(() => new Error(this.toErrorMessage(err, 'Could not start a chat session.')))
      )
    );
  }

  converse(sessionId: string, text: string, systemName?: string): Observable<string[]> {
    const sid = (sessionId ?? '').trim();
    const msg = (text ?? '').trim();
    if (!sid) {
      return throwError(() => new Error('Chat session is missing.'));
    }
    if (!msg) {
      return throwError(() => new Error('Type a message first.'));
    }

    const system = (systemName || this.systemName()).trim();
    const params = new HttpParams()
      .set('action', 'Converse')
      .set('SystemName', system)
      .set('SessionID', sid)
      .set('Text', msg)
      .set('ResponseFormat', 'simplejson');

    return this.post(params).pipe(
      timeout(this.converseTimeoutMs),
      map((body) => this.parsePrompts(body)),
      catchError((err) => {
        if (err?.name === 'TimeoutError') {
          return throwError(
            () => new Error('The chat timed out. Try a shorter follow-up.')
          );
        }
        return throwError(() => new Error(this.toErrorMessage(err, 'Chat request failed.')));
      })
    );
  }

  /**
   * Answer Server requires POST for ManageResources. Converse uses the same
   * path so RAG (often >20s) is not cut off by a huge GET URL or a short proxy.
   * Data must still be standard base64 of the UTF-8 JSON (AS 26.3 rejects raw JSON).
   */
  private post(params: HttpParams) {
    const base = this.appSettings.requestUrl('answerServerApiUrl').replace(/\/?$/, '/');
    const action = params.get('action') || '';
    const direct = this.appSettings.answerServerDirectOrigin();
    console.info(
      `%c[KDChat] ${action} → AnswerServer`,
      'color:#5c4b00;font-weight:600',
      {
        proxyEndpoint: base,
        directEndpoint: `${direct}/`,
        method: 'POST',
        action,
        system: params.get('SystemName'),
        sessionId: params.get('SessionID') || undefined,
        text: params.get('Text') || undefined,
        url: base,
        directUrl: `${direct}/`
      }
    );
    return this.http.post(base, params.toString(), {
      headers: FORM_HEADERS,
      responseType: 'text'
    });
  }

  private encodeManageData(payload: unknown): string {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    bytes.forEach((b) => {
      binary += String.fromCharCode(b);
    });
    return btoa(binary);
  }

  private parseSessionId(body: string): string {
    const json = this.parseJson(body);
    const response = String(json?.autnresponse?.response ?? '').toUpperCase();
    if (response && response !== 'SUCCESS') {
      throw new Error(this.extractAciError(json) || 'ManageResources failed.');
    }
    const id =
      json?.autnresponse?.responsedata?.result?.managed_resources?.id ??
      json?.autnresponse?.responsedata?.managed_resources?.id;
    if (id == null || String(id).trim() === '') {
      throw new Error('Answer Server did not return a conversation session id.');
    }
    return String(id);
  }

  private parsePrompts(body: string): string[] {
    const json = this.parseJson(body);
    const response = String(json?.autnresponse?.response ?? '').toUpperCase();
    if (response && response !== 'SUCCESS') {
      throw new Error(this.extractAciError(json) || 'Converse failed.');
    }
    const data = (json?.autnresponse?.responsedata ?? {}) as Record<string, unknown>;
    const promptsRaw = data['prompts'];
    if (Array.isArray(promptsRaw)) {
      return promptsRaw
        .map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          const o = item as Record<string, unknown>;
          return String(o['prompt'] ?? o['$'] ?? '').trim();
        })
        .filter(Boolean);
    }
    const single = data['prompt'] ?? data['response'];
    if (typeof single === 'string' && single.trim()) {
      return [single.trim()];
    }
    return [];
  }

  private parseJson(body: string): any {
    const trimmed = (body ?? '').trim();
    if (!trimmed) {
      throw new Error('Empty response from Answer Server.');
    }
    if (!trimmed.startsWith('{')) {
      throw new Error('Unexpected Answer Server response.');
    }
    return JSON.parse(trimmed);
  }

  private extractAciError(json: any): string {
    const err = json?.autnresponse?.responsedata?.error;
    const list = Array.isArray(err) ? err : err ? [err] : [];
    const first = list[0] as Record<string, unknown> | undefined;
    if (!first) {
      return '';
    }
    return String(
      first['errordescription'] || first['errorstring'] || first['errorcode'] || ''
    ).trim();
  }

  private toErrorMessage(err: unknown, fallback: string): string {
    const anyErr = err as {
      status?: number;
      message?: string;
      error?: { message?: string };
    };
    if (anyErr?.status === 0) {
      return (
        'Answer Server did not return a response (HTTP status 0). ' +
        'Use the same-origin /answerserver proxy (do not call :12000 from the browser), ' +
        'trust the IDOL certificate or leave proxy TLS verify off, ' +
        'and allow at least 180s for Converse/RAG.'
      );
    }
    const msg = anyErr?.error?.message || anyErr?.message;
    return typeof msg === 'string' && msg.trim() ? msg : fallback;
  }

  private ensureConfigLoaded(): void {
    if (this.configLoadStarted) {
      return;
    }
    this.configLoadStarted = true;
    this.config.getAnswerConfig().subscribe({
      next: (file) => {
        const name = (file.conversationSystemName || '').trim();
        if (name) {
          this.conversationSystemName = name;
        }
      },
      error: () => {
        this.conversationSystemName = DEFAULT_CONVERSATION_SYSTEM;
      }
    });
  }
}
