import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ExpertField, ExpertPerson } from '../models/expertise';
import { AuthService } from './auth.service';
import { ConceptSearchSettingsService } from './concept-search-settings.service';
import { ConfigService, ExpertiseDisplayField } from './config.service';

const AUTN_NS = 'http://schemas.autonomy.com/aci/';
const PROFILE_DB = 'Profile';
const MAX_PEOPLE = 8;
const MAX_TERMS = 8;

/**
 * IDOL expertise locator:
 * - Community `ProfileUser` on document interaction
 * - Community `Community&Profiles=True` for people with similar profiles
 * - Agentstore Query `DatabaseMatch=Profile` for experts in a topic
 */
@Injectable({ providedIn: 'root' })
export class ExpertiseService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly config = inject(ConfigService);
  private readonly conceptSettings = inject(ConceptSearchSettingsService);
  private readonly userFieldCache = new Map<string, ExpertField[]>();

  /** Train the signed-in user's profile from a Content document they opened. */
  profileFromDocument(documentId: string | number | undefined | null): Observable<boolean> {
    if (!this.conceptSettings.expertsEnabled()) {
      return of(false);
    }
    const id = String(documentId ?? '').trim();
    const username = this.auth.getUser()?.username?.trim();
    if (!id || !/^\d+$/.test(id) || !username) {
      return of(false);
    }

    const base = this.communityUrl();
    const params = new HttpParams()
      .set('action', 'ProfileUser')
      .set('UserName', username)
      .set('Document', id);

    return this.http.get(base, { params, responseType: 'text' }).pipe(
      map((xml) => /<response>\s*SUCCESS\s*<\/response>/i.test(xml)),
      catchError(() => of(false))
    );
  }

  /** Users whose profiles match the signed-in user (People like you). */
  similarPeople(): Observable<ExpertPerson[]> {
    if (!this.conceptSettings.expertsEnabled()) {
      return of([]);
    }
    const username = this.auth.getUser()?.username?.trim();
    if (!username) {
      return of([]);
    }

    const base = this.communityUrl();
    const params = new HttpParams()
      .set('action', 'Community')
      .set('UserName', username)
      .set('Profiles', 'True');

    return this.http.get(base, { params, responseType: 'text' }).pipe(
      map((xml) => this.excludeSelf(this.mergePeople(this.parseCommunityXml(xml)))),
      switchMap((people) => this.enrichWithCommunity(people)),
      catchError(() => of([] as ExpertPerson[]))
    );
  }

  /** Users whose Agentstore profiles match an interest / search topic. */
  expertsByInterest(text: string): Observable<ExpertPerson[]> {
    if (!this.conceptSettings.expertsEnabled()) {
      return of([]);
    }
    const q = (text ?? '').trim();
    if (!q || q === '*') {
      return of([]);
    }

    const token = this.auth.getSecurityInfo();
    const base = this.agentstoreUrl();
    let params = new HttpParams()
      .set('action', 'Query')
      .set('Text', q)
      .set('DatabaseMatch', PROFILE_DB)
      .set('AnyLanguage', 'true')
      .set('Print', 'Fields')
      .set('PrintFields', 'USERNAME,EMAILADDRESS,TRAINING,NAMEDAREA')
      .set('MaxResults', '20')
      .set('TotalResults', 'True')
      .set('ResponseFormat', 'simplejson');
    if (token) {
      params = params.set('SecurityInfo', token);
    }

    return this.http.get<unknown>(base, { params }).pipe(
      map((response) => this.excludeSelf(this.mergePeople(this.parseAgentstoreJson(response)))),
      switchMap((people) => this.enrichWithCommunity(people)),
      catchError(() => of([] as ExpertPerson[]))
    );
  }

  private enrichWithCommunity(people: ExpertPerson[]): Observable<ExpertPerson[]> {
    if (!people.length) {
      return of(people);
    }
    return this.config.getExpertiseConfig().pipe(
      map((cfg) => (cfg.displayFields ?? []).filter((f) => (f.name || '').trim())),
      switchMap((defs) => {
        if (!defs.length) {
          return of(people);
        }
        return forkJoin(
          people.map((person) =>
            this.readUserFields(person.username, defs).pipe(
              map((fields) => ({ ...person, fields })),
              catchError(() => of(person))
            )
          )
        );
      }),
      catchError(() => of(people))
    );
  }

  private readUserFields(
    username: string,
    defs: ExpertiseDisplayField[]
  ): Observable<ExpertField[]> {
    const key = username.trim().toLowerCase();
    const cached = this.userFieldCache.get(key);
    if (cached) {
      return of(cached);
    }
    const base = this.communityUrl();
    const params = new HttpParams()
      .set('action', 'UserRead')
      .set('UserName', username)
      .set('ResponseFormat', 'simplejson');
    return this.http.get<unknown>(base, { params }).pipe(
      map((response) => {
        const fields = this.parseUserReadFields(response, defs);
        this.userFieldCache.set(key, fields);
        return fields;
      }),
      catchError(() => of([] as ExpertField[]))
    );
  }

  private parseUserReadFields(
    response: unknown,
    defs: ExpertiseDisplayField[]
  ): ExpertField[] {
    const root = response as Record<string, unknown>;
    const autn = (root?.['autnresponse'] ?? root) as Record<string, unknown> | undefined;
    const status = String(autn?.['response'] ?? '').toUpperCase();
    if (status && status !== 'SUCCESS') {
      return [];
    }
    const data = (autn?.['responsedata'] ?? {}) as Record<string, unknown>;
    const custom = this.flattenUserFields(data['fields'] ?? data['autn:fields']);
    const out: ExpertField[] = [];
    for (const def of defs) {
      const name = def.name.trim();
      const raw =
        custom[name] ||
        custom[name.toLowerCase()] ||
        String(data[name] ?? data[`autn:${name}`] ?? '').trim();
      const value = this.formatFieldValue(raw, def.type);
      if (!value) {
        continue;
      }
      const field: ExpertField = {
        name,
        label: (def.label || name).trim(),
        value
      };
      if (def.type === 'tel') {
        const digits = value.replace(/[^\d+]/g, '');
        if (digits) {
          field.href = `tel:${digits}`;
        }
      }
      out.push(field);
    }
    return out;
  }

  private flattenUserFields(raw: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!raw || typeof raw !== 'object') {
      return out;
    }
    const add = (k: string, v: unknown) => {
      const key = k.replace(/^autn:/, '').trim();
      if (!key) {
        return;
      }
      let text = '';
      if (v && typeof v === 'object' && '$' in (v as Record<string, unknown>)) {
        text = String((v as Record<string, unknown>)['$'] ?? '').trim();
      } else if (Array.isArray(v)) {
        text = v.map((x) => String(x)).join(', ').trim();
      } else if (v != null) {
        text = String(v).trim();
      }
      if (text) {
        out[key] = text;
        out[key.toLowerCase()] = text;
      }
    };
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (!item || typeof item !== 'object') {
          continue;
        }
        for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
          add(k, v);
        }
      }
      return out;
    }
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      add(k, v);
    }
    return out;
  }

  private formatFieldValue(raw: string, type?: string): string {
    const text = (raw ?? '').trim();
    if (!text) {
      return '';
    }
    if (type === 'unix') {
      const sec = Number(text);
      if (!Number.isFinite(sec) || sec <= 0) {
        return '';
      }
      const d = new Date(sec * 1000);
      if (Number.isNaN(d.getTime())) {
        return '';
      }
      return d.toLocaleString();
    }
    return text;
  }

  private communityUrl(): string {
    return environment.communityApiUrl.replace(/\/?$/, '/');
  }

  private agentstoreUrl(): string {
    return environment.agentstoreApiUrl.replace(/\/?$/, '/');
  }

  private excludeSelf(people: ExpertPerson[]): ExpertPerson[] {
    const me = (this.auth.getUser()?.username ?? '').trim().toLowerCase();
    if (!me) {
      return people.slice(0, MAX_PEOPLE);
    }
    return people.filter((p) => p.username.toLowerCase() !== me).slice(0, MAX_PEOPLE);
  }

  private mergePeople(people: ExpertPerson[]): ExpertPerson[] {
    const map = new Map<string, ExpertPerson>();
    for (const person of people) {
      const key = person.username.toLowerCase();
      if (!key) {
        continue;
      }
      const prev = map.get(key);
      if (!prev) {
        map.set(key, { ...person, terms: [...person.terms] });
        continue;
      }
      prev.weight = Math.max(prev.weight, person.weight);
      prev.terms = this.uniqueTerms([...prev.terms, ...person.terms]);
      if (!prev.email && person.email) {
        prev.email = person.email;
      }
      if (!prev.profileRef && person.profileRef) {
        prev.profileRef = person.profileRef;
      }
    }
    return [...map.values()].sort((a, b) => b.weight - a.weight);
  }

  private parseCommunityXml(xmlText: string): ExpertPerson[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    if (this.xmlFailed(doc)) {
      return [];
    }
    const hits = this.xmlHits(doc);
    const people: ExpertPerson[] = [];
    for (const hit of hits) {
      const username = this.xmlField(hit, 'USERNAME') || this.xmlField(hit, 'username');
      if (!username) {
        continue;
      }
      const links = this.xmlNsText(hit, 'links');
      const training = this.xmlField(hit, 'TRAINING');
      const terms = this.termsFrom(links, training);
      const weight = parseFloat(this.xmlNsText(hit, 'weight') || '0') || 0;
      const reference = this.xmlNsText(hit, 'reference');
      people.push(this.toPerson(username, this.xmlField(hit, 'EMAILADDRESS'), terms, weight, reference));
    }
    return people;
  }

  private parseAgentstoreJson(response: unknown): ExpertPerson[] {
    const root = response as Record<string, unknown>;
    const autn = (root?.['autnresponse'] ?? root) as Record<string, unknown> | undefined;
    const status = String(autn?.['response'] ?? '').toUpperCase();
    if (status && status !== 'SUCCESS') {
      return [];
    }
    const data = (autn?.['responsedata'] ?? {}) as Record<string, unknown>;
    let rawHits = data['hit'] ?? data['autn:hit'] ?? [];
    if (!Array.isArray(rawHits)) {
      rawHits = rawHits ? [rawHits] : [];
    }
    const people: ExpertPerson[] = [];
    for (const raw of rawHits as unknown[]) {
      const hit = (raw ?? {}) as Record<string, unknown>;
      const fields = this.flattenDocument(hit);
      const username = (fields['USERNAME'] || '')[0] || '';
      if (!username) {
        continue;
      }
      const links = String(hit['links'] ?? hit['autn:links'] ?? '').trim();
      const training = (fields['TRAINING'] || [])[0] || '';
      const terms = this.termsFrom(links, training);
      const weight = parseFloat(String(hit['weight'] ?? hit['autn:weight'] ?? '0')) || 0;
      const reference = String(hit['reference'] ?? hit['autn:reference'] ?? '').trim();
      const email = (fields['EMAILADDRESS'] || [])[0] || '';
      people.push(this.toPerson(username, email, terms, weight, reference));
    }
    return people;
  }

  private toPerson(
    username: string,
    email: string,
    terms: string[],
    weight: number,
    profileRef: string
  ): ExpertPerson {
    const user = username.trim();
    const mail = (email || '').trim();
    return {
      username: user,
      displayName: this.displayName(user),
      email: mail && mail.includes('@') ? mail : user.includes('@') ? user : '',
      terms: terms.slice(0, MAX_TERMS),
      weight,
      profileRef
    };
  }

  private displayName(username: string): string {
    const local = username.includes('@') ? username.slice(0, username.indexOf('@')) : username;
    return local.replace(/[._]+/g, ' ').trim() || username;
  }

  private termsFrom(links: string, training: string): string[] {
    const fromLinks = links
      .split(/[,;]+/)
      .map((t) => this.titleCaseTerm(t))
      .filter(Boolean);
    if (fromLinks.length) {
      return this.uniqueTerms(fromLinks);
    }
    const scored: { term: string; score: number }[] = [];
    const re = /(\S+)~\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(training || ''))) {
      const term = this.titleCaseTerm(m[1]);
      if (term) {
        scored.push({ term, score: parseInt(m[2], 10) || 0 });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return this.uniqueTerms(scored.map((s) => s.term));
  }

  private titleCaseTerm(raw: string): string {
    const t = (raw ?? '').trim();
    if (t.length < 3) {
      return '';
    }
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(t)) {
      return '';
    }
    const lower = t.toLowerCase();
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }

  private uniqueTerms(terms: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of terms) {
      const key = t.toLowerCase();
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(t);
    }
    return out;
  }

  private flattenDocument(hit: Record<string, unknown>): Record<string, string[]> {
    const doc: Record<string, string[]> = {};
    const content = hit['content'] as Record<string, unknown> | undefined;
    let docs = content?.['DOCUMENT'] ?? content?.['document'];
    if (!docs) {
      return doc;
    }
    if (!Array.isArray(docs)) {
      docs = [docs];
    }
    for (const item of docs as unknown[]) {
      if (!item || typeof item !== 'object') {
        continue;
      }
      for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
        const key = k.toUpperCase();
        const values = Array.isArray(v) ? v.map(String) : [String(v)];
        doc[key] = [...(doc[key] ?? []), ...values];
      }
    }
    return doc;
  }

  private xmlFailed(doc: Document): boolean {
    const response = (doc.getElementsByTagName('response')[0]?.textContent ?? '').trim().toUpperCase();
    return response !== '' && response !== 'SUCCESS';
  }

  private xmlHits(doc: Document): Element[] {
    const nsHits = Array.from(doc.getElementsByTagNameNS(AUTN_NS, 'hit'));
    if (nsHits.length) {
      return nsHits;
    }
    return Array.from(doc.getElementsByTagName('hit'));
  }

  private xmlNsText(el: Element, local: string): string {
    const ns = el.getElementsByTagNameNS(AUTN_NS, local)[0];
    if (ns?.textContent) {
      return ns.textContent.trim();
    }
    return (el.getElementsByTagName(local)[0]?.textContent ?? '').trim();
  }

  private xmlField(el: Element, name: string): string {
    const nodes = [
      ...Array.from(el.getElementsByTagName(name)),
      ...Array.from(el.getElementsByTagName(name.toLowerCase()))
    ];
    for (const n of nodes) {
      const t = (n.textContent ?? '').trim();
      if (t) {
        return t;
      }
    }
    return '';
  }
}
