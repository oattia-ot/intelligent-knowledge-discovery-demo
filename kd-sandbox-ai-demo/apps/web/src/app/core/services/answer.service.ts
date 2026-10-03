import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, timeout } from 'rxjs/operators';
import { AppSettingsService } from './app-settings.service';
import { AnswerConfigFile } from '../models/answer-config';
import { AuthService } from './auth.service';
import { ConfigService } from './config.service';

const AUTN_NS = 'http://schemas.autonomy.com/aci/';

/** One citation / passage from AnswerServer metadata.sources. */
export interface AnswerSource {
  ref: string;
  title: string;
  database: string;
  snippet: string;
}

/** True when Ask already gave a human title (not the DREREFERENCE). */
export function isUsableSourceTitle(title: string, ref: string): boolean {
  const t = (title ?? '').trim();
  const r = (ref ?? '').trim();
  if (!t || t === '(No title)') {
    return false;
  }
  if (r && t.toLowerCase() === r.toLowerCase()) {
    return false;
  }
  // Filesystem / UNC / drive-letter paths are unresolved refs, not titles
  if (t.startsWith('/') || t.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(t)) {
    return false;
  }
  return true;
}

/** Last path segment of a DREREFERENCE, without extension. */
export function fallbackTitleFromReference(ref: string): string {
  const raw = (ref ?? '').trim();
  if (!raw) {
    return 'Source';
  }
  const stripped = raw.replace(/[\\/]+$/, '');
  const base = stripped.split(/[\\/]/).pop() || stripped;
  const noExt = base.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const pretty = noExt.replace(/[_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  return pretty || base || 'Source';
}

/** Parsed NLQA answer from AnswerServer `action=Ask`. */
export interface AnswerHit {
  text: string;
  score: number | null;
  interpretation: string;
  systemName: string;
  answerType: string;
  /** Comma-separated source paths from the answer element. */
  source: string;
  sources: AnswerSource[];
}

export interface AnswerResponse {
  question: string;
  answers: AnswerHit[];
  warnings: string[];
}

/** Built-in fallback if answer.json is missing or incomplete. */
const DEFAULT_ANSWER_DETECTION: Required<
  Pick<
    AnswerConfigFile,
    | 'detectTrailingQuestionMark'
    | 'interrogatives'
    | 'imperatives'
    | 'allowPleasePrefix'
    | 'meRequestVerbs'
    | 'youRequestVerbs'
  >
> & { systemName: string } = {
  systemName: 'RAG',
  detectTrailingQuestionMark: true,
  interrogatives: [
    'what',
    'who',
    'when',
    'where',
    'why',
    'how',
    'is',
    'are',
    'am',
    'was',
    'were',
    'can',
    'could',
    'does',
    'do',
    'did',
    'which',
    'whose',
    'whom',
    'will',
    'would',
    'should',
    'may',
    'might',
    'shall',
    'has',
    'have',
    'had'
  ],
  imperatives: [
    'summarize',
    'summarise',
    'explain',
    'describe',
    'outline',
    'compare',
    'contrast',
    'define',
    'list',
    'provide',
    'generate',
    'write',
    'draft',
    'review',
    'analyze',
    'analyse',
    'extract',
    'translate',
    'paraphrase'
  ],
  allowPleasePrefix: true,
  meRequestVerbs: ['tell', 'give', 'show', 'walk', 'help', 'find'],
  youRequestVerbs: ['can', 'could', 'would']
};

/**
 * AnswerServer NLQA via `action=Ask`.
 *
 * Detection word lists live in `config/answer.json` (imperatives, interrogatives).
 * Demo systems (GetStatus): Grok (rag), Conversation, AnswerBank.
 *
 *   GET /answerserver/?action=Ask&SystemNames=Grok&Text=…&SecurityInfo=…
 *   ResponseFormat=simplejson preferred; XML also supported.
 */
@Injectable({ providedIn: 'root' })
export class AnswerService {
  private readonly http = inject(HttpClient);
  private readonly appSettings = inject(AppSettingsService);
  private readonly auth = inject(AuthService);
  private readonly config = inject(ConfigService);

  /** Fallback SystemNames if config has not loaded yet. */
  readonly defaultSystemName = DEFAULT_ANSWER_DETECTION.systemName;
  /** Ask can be slow (RAG); allow up to 90s. */
  readonly askTimeoutMs = 90_000;

  private detection = { ...DEFAULT_ANSWER_DETECTION };
  private interrogativeRe: RegExp = this.buildAlternationRe(
    DEFAULT_ANSWER_DETECTION.interrogatives
  );
  private imperativeRe: RegExp = this.buildImperativeRe(
    DEFAULT_ANSWER_DETECTION.imperatives,
    DEFAULT_ANSWER_DETECTION.allowPleasePrefix
  );
  private meRequestRe: RegExp = this.buildMeRequestRe(
    DEFAULT_ANSWER_DETECTION.meRequestVerbs
  );
  private youRequestRe: RegExp = this.buildYouRequestRe(
    DEFAULT_ANSWER_DETECTION.youRequestVerbs
  );
  private configLoadStarted = false;

  constructor() {
    this.ensureConfigLoaded();
  }

  /** Prefetch answer.json (also triggered from constructor). */
  preload(): void {
    this.ensureConfigLoaded();
  }

  /**
   * Heuristic: treat free text as a natural-language question / NLQA prompt
   * that should call AnswerServer Ask.
   *
   * Word lists come from `assets/config/answer.json` (see config/answer.json).
   * Skips multi-concept boolean/proximity expressions.
   */
  isQuestion(text: string): boolean {
    this.ensureConfigLoaded();
    const t = (text ?? '').trim();
    if (!t || t === '*') {
      return false;
    }
    // Multi-concept / operator joins are not a single NLQ
    if (
      /\s+(AND|OR|YNEAR|WNEAR|DNEAR|NEAR|BEFORE|AFTER|SENTENCE|PARAGRAPH)\s+/i.test(t)
    ) {
      return false;
    }
    if (this.detection.detectTrailingQuestionMark && t.endsWith('?')) {
      return true;
    }
    if (this.interrogativeRe.test(t)) {
      return true;
    }
    if (this.imperativeRe.test(t)) {
      return true;
    }
    if (this.meRequestRe.test(t)) {
      return true;
    }
    if (this.youRequestRe.test(t)) {
      return true;
    }
    return false;
  }

  /** SystemNames for Ask (from answer.json when loaded). */
  systemName(): string {
    return this.detection.systemName || this.defaultSystemName;
  }

  /** Apply new Ask SystemNames immediately (after Settings saves answer.json). */
  setSystemNames(names: string): void {
    const value = (names ?? '').trim();
    if (value) {
      this.detection = { ...this.detection, systemName: value };
    }
  }

  /**
   * Pick the best NLQ string from concept tags (prefer last question-like tag).
   */
  questionFromConcepts(concepts: string[]): string | null {
    for (let i = concepts.length - 1; i >= 0; i--) {
      const c = concepts[i]?.trim();
      if (c && this.isQuestion(c)) {
        return c;
      }
    }
    return null;
  }

  /**
   * Convert a natural-language question into freer Content Query text.
   *
   * Multi-word concepts are normally quoted for phrase match, which makes a
   * full question like `"What is Waikato Regional Council?"` match almost
   * nothing. For questions we send unquoted free text (strip trailing ?) so
   * IDOL can still return related documents alongside AnswerServer NLQA.
   */
  toDocumentQueryText(text: string): string {
    let t = (text ?? '').trim();
    if (!t || t === '*') {
      return t || '*';
    }
    // Already a multi-concept operator expression — leave as built
    if (
      /\s+(AND|OR|YNEAR|WNEAR|DNEAR|NEAR|BEFORE|AFTER|SENTENCE|PARAGRAPH)\s+/i.test(t)
    ) {
      return t;
    }
    if (!this.isQuestion(t)) {
      return t;
    }
    t = t
      .replace(/^["']+|["']+$/g, '')
      .replace(/\?+\s*$/g, '')
      .replace(/"/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return t || text.trim();
  }

  /**
   * Call AnswerServer Ask. Returns empty answers on soft failure when preferred;
   * hard errors still surface for the UI.
   *
   * - `databases` → DatabaseMatch (same left-panel filter as Content Query)
   * - SecurityInfo for Passage Extractor / Fact Bank goes in **CustomizationData**
   *   JSON (`system_name` + `security_info`), not as a top-level SecurityInfo param.
   */
  ask(
    question: string,
    options?: { systemName?: string; databases?: string[] }
  ): Observable<AnswerResponse> {
    this.ensureConfigLoaded();
    const q = (question ?? '').trim();
    if (!q || q === '*') {
      return of({ question: q, answers: [], warnings: [] });
    }

    const system =
      (options?.systemName || this.systemName()).trim() || this.defaultSystemName;
    const systemList = system
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const databases = (options?.databases ?? []).map((d) => d.trim()).filter(Boolean);
    const token = this.auth.getSecurityInfo();

    const base = this.appSettings.requestUrl('answerServerApiUrl').replace(/\/?$/, '/');
    const direct = this.appSettings.answerServerDirectOrigin();
    let params = new HttpParams()
      .set('action', 'Ask')
      .set('Text', q)
      // ACI param is plural SystemNames (comma-separated allowed)
      .set('SystemNames', systemList.join(',') || system)
      .set('ResponseFormat', 'simplejson');

    // Limit RAG retrieval to the databases selected in the UI filter.
    // Do not send DatabaseMatch=* — IDOL treats that as a DB named "*".
    const dbMatch = databases.filter((d) => d && d !== '*');
    if (dbMatch.length) {
      params = params.set('DatabaseMatch', dbMatch.join(','));
    }

    // Passage Extractor / Fact Bank: SecurityInfo via CustomizationData JSON
    // (must include system_name per Ask schema).
    const customization = this.buildCustomizationData(systemList, token);
    if (customization) {
      params = params.set('CustomizationData', JSON.stringify(customization));
    }

    console.info('%c[KD Ask] request → AnswerServer', 'color:#5f3dc4;font-weight:600', {
      proxyEndpoint: base,
      directEndpoint: `${direct}/`,
      method: 'GET',
      action: 'Ask',
      systemNames: systemList.join(',') || system,
      text: q,
      databaseMatch: dbMatch.join(',') || '(all databases — DatabaseMatch omitted)',
      url: `${base}?${params.toString()}`,
      directUrl: `${direct}/?${params.toString()}`
    });

    return this.http.get(base, { params, responseType: 'text' }).pipe(
      timeout(this.askTimeoutMs),
      map((body) => this.parseAskResponse(body, q)),
      catchError((err) => {
        // Retry once as XML without ResponseFormat if simplejson fails oddly
        if (err?.name === 'TimeoutError') {
          return throwError(
            () => new Error('Answer Server timed out. Try a shorter question.')
          );
        }
        const msg =
          err?.error?.message ||
          err?.message ||
          'Could not get an answer from Answer Server.';
        return throwError(() => new Error(typeof msg === 'string' ? msg : 'Ask failed.'));
      })
    );
  }

  private parseAskResponse(body: string, question: string): AnswerResponse {
    const trimmed = (body ?? '').trim();
    if (!trimmed) {
      return { question, answers: [], warnings: [] };
    }

    if (trimmed.startsWith('{')) {
      try {
        return this.parseAskJson(JSON.parse(trimmed), question);
      } catch {
        /* fall through to XML */
      }
    }
    return this.parseAskXml(trimmed, question);
  }

  private parseAskJson(json: unknown, question: string): AnswerResponse {
    const root = (json as { autnresponse?: Record<string, unknown> })?.autnresponse;
    const data = (root?.['responsedata'] ?? {}) as Record<string, unknown>;
    const response = String(root?.['response'] ?? '').toUpperCase();
    if (response && response !== 'SUCCESS') {
      return { question, answers: [], warnings: [response] };
    }

    const warnings = this.filterUserFacingWarnings(
      this.collectJsonWarnings(data['warnings'])
    );
    const answersRaw = (data['answers'] as { answer?: unknown } | undefined)?.answer;
    const list = Array.isArray(answersRaw)
      ? answersRaw
      : answersRaw
        ? [answersRaw]
        : [];

    const answers: AnswerHit[] = list
      .map((a) => this.mapJsonAnswer(a as Record<string, unknown>))
      .filter((a) => !!a.text);

    return { question, answers, warnings };
  }

  private mapJsonAnswer(a: Record<string, unknown>): AnswerHit {
    const text = String(a['text'] ?? a['$'] ?? '').trim();
    const scoreRaw = a['score'];
    const score =
      scoreRaw != null && scoreRaw !== '' ? Number(scoreRaw) : null;
    const sources = this.mapJsonSources(
      (a['metadata'] as { sources?: { source?: unknown } })?.sources?.source
    );
    return {
      text,
      score: Number.isFinite(score as number) ? (score as number) : null,
      interpretation: String(a['interpretation'] ?? '').trim(),
      systemName: String(a['@system_name'] ?? a['system_name'] ?? '').trim(),
      answerType: String(a['@answer_type'] ?? a['answer_type'] ?? '').trim(),
      source: String(a['source'] ?? '').trim(),
      sources
    };
  }

  private mapJsonSources(raw: unknown): AnswerSource[] {
    const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return list.map((s) => {
      const o = s as Record<string, unknown>;
      return {
        ref: String(o['@ref'] ?? o['ref'] ?? '').trim(),
        title: String(o['@title'] ?? o['title'] ?? '').trim(),
        database: String(o['@database'] ?? o['database'] ?? '').trim(),
        snippet: String(o['text'] ?? o['$'] ?? '').trim()
      };
    });
  }

  private collectJsonWarnings(warnings: unknown): string[] {
    if (!warnings) {
      return [];
    }
    const w = warnings as { warning?: unknown };
    const list = Array.isArray(w.warning) ? w.warning : w.warning ? [w.warning] : [];
    return list.map((item) => {
      if (typeof item === 'string') {
        return item;
      }
      const o = item as Record<string, unknown>;
      const sys = o['@system_name'] ? `[${o['@system_name']}] ` : '';
      return `${sys}${o['$'] ?? o['text'] ?? JSON.stringify(item)}`;
    });
  }

  private parseAskXml(xmlText: string, question: string): AnswerResponse {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return { question, answers: [], warnings: ['Invalid Answer Server response.'] };
    }
    const response = (doc.getElementsByTagName('response')[0]?.textContent || '')
      .trim()
      .toUpperCase();
    if (response && response !== 'SUCCESS') {
      return { question, answers: [], warnings: [response] };
    }

    const warnings: string[] = [];
    for (const el of Array.from(doc.getElementsByTagName('warning'))) {
      const sys = el.getAttribute('system_name') || '';
      const msg = (el.textContent || '').trim();
      if (msg) {
        warnings.push(sys ? `[${sys}] ${msg}` : msg);
      }
    }
    const userWarnings = this.filterUserFacingWarnings(warnings);

    const answerEls = [
      ...Array.from(doc.getElementsByTagNameNS(AUTN_NS, 'answer')),
      ...Array.from(doc.getElementsByTagName('answer'))
    ].filter((el, i, arr) => arr.indexOf(el) === i);

    // Prefer direct children of <answers>
    const underAnswers = Array.from(doc.getElementsByTagName('answers')).flatMap((parent) =>
      Array.from(parent.children).filter(
        (c) => c.localName === 'answer' || c.tagName.toLowerCase().endsWith('answer')
      )
    );
    const nodes = underAnswers.length ? underAnswers : answerEls;

    const answers: AnswerHit[] = [];
    for (const el of nodes) {
      if (!(el instanceof Element)) {
        continue;
      }
      const text =
        this.childText(el, 'text') ||
        (el.textContent || '').trim();
      // Prefer structured text child over full dump
      const textEl =
        el.getElementsByTagName('text')[0] ||
        el.getElementsByTagNameNS(AUTN_NS, 'text')[0];
      const answerText = (textEl?.textContent || text || '').trim();
      if (!answerText) {
        continue;
      }
      const scoreRaw = this.childText(el, 'score');
      const score = scoreRaw ? Number(scoreRaw) : null;
      answers.push({
        text: answerText,
        score: Number.isFinite(score as number) ? (score as number) : null,
        interpretation: this.childText(el, 'interpretation'),
        systemName: el.getAttribute('system_name') || '',
        answerType: el.getAttribute('answer_type') || '',
        source: this.childText(el, 'source'),
        sources: this.parseXmlSources(el)
      });
    }

    return { question, answers, warnings: userWarnings };
  }

  /**
   * Drop noisy backend warnings the user cannot act on — e.g. AnswerBank offline
   * while Grok RAG still returns a successful answer.
   */
  private filterUserFacingWarnings(warnings: string[]): string[] {
    return warnings.filter((w) => {
      const s = w.toLowerCase();
      if (s.includes('answerbank') && s.includes('cannot connect')) {
        return false;
      }
      if (s.includes('answerbank') && s.includes('aci error')) {
        return false;
      }
      return true;
    });
  }

  private parseXmlSources(answerEl: Element): AnswerSource[] {
    const sourceEls = Array.from(answerEl.getElementsByTagName('source')).filter(
      (el) => el.parentElement?.localName === 'sources' || el.parentElement?.tagName === 'sources'
    );
    return sourceEls.map((el) => ({
      ref: el.getAttribute('ref') || '',
      title: el.getAttribute('title') || '',
      database: el.getAttribute('database') || '',
      snippet: (el.getElementsByTagName('text')[0]?.textContent || el.textContent || '').trim()
    }));
  }

  private childText(parent: Element, local: string): string {
    const direct = Array.from(parent.children).find(
      (c) => c.localName === local || c.tagName.toLowerCase() === local
    );
    if (direct?.textContent) {
      return direct.textContent.trim();
    }
    return (parent.getElementsByTagName(local)[0]?.textContent || '').trim();
  }

  /**
   * Build CustomizationData for Ask.
   *
   * Answer Server schema requires the **root to be a JSON array** of objects.
   * Each object needs `system_name`; `security_info` applies SecurityInfo to the
   * Content / fact-store index for that system (Passage Extractor, Fact Bank).
   *
   * Example:
   *   [{"system_name":"Grok","security_info":"…"}]
   *
   * @see Answer Server Ask → CustomizationData (not top-level SecurityInfo)
   */
  private buildCustomizationData(
    systemNames: string[],
    securityInfo: string
  ): Array<Record<string, string>> | null {
    const token = (securityInfo ?? '').trim();
    // Only needed when we have a SecurityInfo string to pass into the system
    if (!token) {
      return null;
    }

    const names = systemNames.length
      ? systemNames
      : [this.defaultSystemName];

    // Root must be an array (schema: type = "array")
    return names.map((system_name) => ({
      system_name,
      security_info: token
    }));
  }

  private ensureConfigLoaded(): void {
    if (this.configLoadStarted) {
      return;
    }
    this.configLoadStarted = true;
    this.config.getAnswerConfig().subscribe({
      next: (file) => this.applyConfig(file),
      error: () => {
        // Keep built-in defaults
        this.applyConfig(DEFAULT_ANSWER_DETECTION);
      }
    });
  }

  private applyConfig(file: AnswerConfigFile): void {
    const interrogatives = this.normalizeWordList(
      file.interrogatives,
      DEFAULT_ANSWER_DETECTION.interrogatives
    );
    const imperatives = this.normalizeWordList(
      file.imperatives,
      DEFAULT_ANSWER_DETECTION.imperatives
    );
    const meRequestVerbs = this.normalizeWordList(
      file.meRequestVerbs,
      DEFAULT_ANSWER_DETECTION.meRequestVerbs
    );
    const youRequestVerbs = this.normalizeWordList(
      file.youRequestVerbs,
      DEFAULT_ANSWER_DETECTION.youRequestVerbs
    );
    const allowPleasePrefix =
      file.allowPleasePrefix !== undefined
        ? !!file.allowPleasePrefix
        : DEFAULT_ANSWER_DETECTION.allowPleasePrefix;
    const detectTrailingQuestionMark =
      file.detectTrailingQuestionMark !== undefined
        ? !!file.detectTrailingQuestionMark
        : DEFAULT_ANSWER_DETECTION.detectTrailingQuestionMark;
    const systemName =
      (file.systemNames || file.systemName || '').trim() ||
      DEFAULT_ANSWER_DETECTION.systemName;

    this.detection = {
      systemName,
      detectTrailingQuestionMark,
      interrogatives,
      imperatives,
      allowPleasePrefix,
      meRequestVerbs,
      youRequestVerbs
    };
    this.interrogativeRe = this.buildAlternationRe(interrogatives);
    this.imperativeRe = this.buildImperativeRe(imperatives, allowPleasePrefix);
    this.meRequestRe = this.buildMeRequestRe(meRequestVerbs);
    this.youRequestRe = this.buildYouRequestRe(youRequestVerbs);
  }

  private normalizeWordList(raw: string[] | undefined, fallback: string[]): string[] {
    const list = (raw?.length ? raw : fallback)
      .map((w) => String(w ?? '').trim().toLowerCase())
      .filter(Boolean)
      // Only allow simple tokens for safe regex alternation
      .filter((w) => /^[a-z][a-z'-]*$/i.test(w));
    return list.length ? list : fallback;
  }

  private escapeRe(s: string): string {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private buildAlternationRe(words: string[]): RegExp {
    const alt = words.map((w) => this.escapeRe(w)).join('|');
    return new RegExp(`^(?:${alt})\\b`, 'i');
  }

  private buildImperativeRe(words: string[], allowPlease: boolean): RegExp {
    const alt = words.map((w) => this.escapeRe(w)).join('|');
    const please = allowPlease ? '(?:please\\s+)?' : '';
    return new RegExp(`^${please}(?:${alt})\\b`, 'i');
  }

  private buildMeRequestRe(verbs: string[]): RegExp {
    const alt = verbs.map((w) => this.escapeRe(w)).join('|');
    return new RegExp(`^(?:${alt})\\s+me\\b`, 'i');
  }

  private buildYouRequestRe(verbs: string[]): RegExp {
    const alt = verbs.map((w) => this.escapeRe(w)).join('|');
    return new RegExp(`^(?:${alt})\\s+you\\b`, 'i');
  }
}
