import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { CommunityProfile, ProfileClearResult, ProfileTerm } from '../models/recommendation';
import {
  parseWeightedTermString,
  uniqueProfileTerms
} from '../utils/recommendation-query';
import { AuthService } from './auth.service';

const AUTN_NS = 'http://schemas.autonomy.com/aci/';

/**
 * Community `ProfileRead` for the signed-in user.
 * Returns profile documents with terms + weights (ShowTerms=true).
 */
@Injectable({ providedIn: 'root' })
export class CommunityProfileService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  /** All Community profiles for the current user, strongest first. */
  getCurrentUserProfiles(namedArea?: string): Observable<CommunityProfile[]> {
    const username = this.auth.getUser()?.username?.trim();
    if (!username) {
      return throwError(() => new Error('You are not signed in. Please sign in again.'));
    }

    const base = environment.communityApiUrl.replace(/\/?$/, '/');
    let params = new HttpParams()
      .set('action', 'ProfileRead')
      .set('UserName', username)
      .set('ShowTerms', 'true');
    const area = (namedArea ?? '').trim();
    if (area) {
      params = params.set('NamedArea', area);
    }

    return this.http.get(base, { params, responseType: 'text' }).pipe(
      map((body) => this.parseProfileRead(body, username)),
      catchError((err) => {
        const mapped = this.toProfileError(err);
        if (this.isMissingCommunityAction(mapped, String((err as HttpErrorResponse)?.error ?? ''))) {
          return this.queryAgentstoreProfiles(username);
        }
        return throwError(() => mapped);
      }),
      switchMap((profiles) =>
        profiles.length ? of(profiles) : this.queryAgentstoreProfiles(username).pipe(catchError(() => of(profiles)))
      )
    );
  }

  /** Primary (highest-weight) profile, or an empty profile when none exist. */
  getCurrentUserProfile(namedArea?: string): Observable<CommunityProfile> {
    return this.getCurrentUserProfiles(namedArea).pipe(
      map((profiles) => profiles[0] ?? emptyProfile(this.auth.getUser()?.username ?? ''))
    );
  }

  /**
   * Delete a Community profile for the **signed-in** user (`ProfileClear`).
   * Never accepts another username (FR-9). Optional `PID` clears one profile only.
   */
  clearCurrentUserProfile(pid?: string): Observable<ProfileClearResult> {
    const username = this.auth.getUser()?.username?.trim();
    if (!username) {
      return throwError(() => new Error('You are not signed in. Please sign in again.'));
    }
    if (username.includes('*')) {
      return throwError(() => new Error('Invalid username.'));
    }

    const profileId = (pid ?? '').trim();
    const actionId = this.buildActionId(username, profileId);
    const base = environment.communityApiUrl.replace(/\/?$/, '/');
    let params = new HttpParams()
      .set('action', 'ProfileClear')
      .set('UserName', username)
      .set('ActionID', actionId);
    if (profileId) {
      params = params.set('PID', profileId);
    }
    const token = this.auth.getSecurityInfo();
    if (token) {
      params = params.set('SecurityInfo', token);
    }

    return this.http.get(base, { params, responseType: 'text' }).pipe(
      map((body) => this.parseProfileClear(body, username, actionId, profileId)),
      catchError((err) => {
        const mapped = this.toProfileError(err, 'Could not delete your profile.');
        this.auditProfileClear({
          ok: false,
          alreadyAbsent: false,
          actionId,
          userName: username,
          pid: profileId || undefined,
          message: mapped.message
        });
        return throwError(() => mapped);
      })
    );
  }

  /** Community PID if the profile id is not just the username. */
  communityPid(profile: CommunityProfile, username?: string): string | undefined {
    const id = (profile.id ?? '').trim();
    const user = (username ?? this.auth.getUser()?.username ?? '').trim();
    if (!id) {
      return undefined;
    }
    if (user && id.toLowerCase() === user.toLowerCase()) {
      return undefined;
    }
    if (id.includes('/') || id.includes('\\') || id.includes('*')) {
      return undefined;
    }
    return id;
  }

  parseProfileRead(body: string, username: string): CommunityProfile[] {
    const text = (body ?? '').trim();
    if (!text) {
      return [];
    }
    if (text.startsWith('{')) {
      try {
        return this.parseProfileJson(JSON.parse(text) as unknown, username);
      } catch {
        throw new Error('Unexpected profile response from Community.');
      }
    }
    if (text.includes('<html') || text.includes('<HTML')) {
      throw new Error(
        'Community proxy returned HTML instead of ACI XML. Restart ./serve.sh after proxy changes.'
      );
    }
    return this.parseProfileXml(text, username);
  }

  private parseProfileXml(xmlText: string, username: string): CommunityProfile[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    if (doc.querySelector('parsererror')) {
      throw new Error('Unexpected profile response from Community.');
    }

    const status = (doc.querySelector('response')?.textContent ?? '').trim().toUpperCase();
    if (status && status !== 'SUCCESS') {
      const detail =
        doc.querySelector('errordescription')?.textContent?.trim() ||
        doc.getElementsByTagNameNS(AUTN_NS, 'error')[0]?.textContent?.trim();
      throw new Error(
        detail
          ? detail.replace(/^Error:\s*/i, '')
          : 'Could not load your profile from Community.'
      );
    }

    const profiles: CommunityProfile[] = [];
    const profileEls = [
      ...Array.from(doc.getElementsByTagNameNS(AUTN_NS, 'profile')),
      ...Array.from(doc.getElementsByTagName('profile'))
    ];
    const seen = new Set<Element>();
    for (const el of profileEls) {
      if (seen.has(el)) {
        continue;
      }
      seen.add(el);
      const parsed = this.profileFromElement(el, username);
      if (parsed) {
        profiles.push(parsed);
      }
    }

    const hits = [
      ...Array.from(doc.getElementsByTagNameNS(AUTN_NS, 'hit')),
      ...Array.from(doc.getElementsByTagName('hit'))
    ];
    for (const hit of hits) {
      if (seen.has(hit)) {
        continue;
      }
      const parsed = this.profileFromElement(hit, username);
      if (parsed) {
        profiles.push(parsed);
      }
    }

    if (!profiles.length) {
      const terms = this.collectTerms(doc.documentElement);
      if (terms.length) {
        profiles.push({
          id: username,
          name: username,
          weight: 0,
          terms
        });
      }
    }

    return profiles.sort((a, b) => b.weight - a.weight);
  }

  private parseProfileJson(response: unknown, username: string): CommunityProfile[] {
    const root = (response ?? {}) as Record<string, unknown>;
    const autn = (root['autnresponse'] ?? root) as Record<string, unknown>;
    const status = String(autn['response'] ?? '').toUpperCase();
    if (status && status !== 'SUCCESS') {
      const data = (autn['responsedata'] ?? {}) as Record<string, unknown>;
      const detail = String(
        data['autn_errorstring'] ?? data['errorstring'] ?? data['errordescription'] ?? ''
      ).trim();
      throw new Error(detail || 'Could not load your profile from Community.');
    }

    const data = (autn['responsedata'] ?? autn) as Record<string, unknown>;
    const bags: unknown[] = [];
    for (const key of ['profile', 'autn:profile', 'hit', 'autn:hit']) {
      const raw = data[key];
      if (raw == null) {
        continue;
      }
      bags.push(...(Array.isArray(raw) ? raw : [raw]));
    }

    const profiles: CommunityProfile[] = [];
    for (const bag of bags) {
      const parsed = this.profileFromRecord(bag, username);
      if (parsed) {
        profiles.push(parsed);
      }
    }

    if (!profiles.length) {
      const terms = this.termsFromUnknown(data);
      if (terms.length) {
        profiles.push({ id: username, name: username, weight: 0, terms });
      }
    }

    return profiles.sort((a, b) => b.weight - a.weight);
  }

  private profileFromElement(el: Element, username: string): CommunityProfile | null {
    const terms = this.collectTerms(el);
    const id =
      this.childText(el, 'pid') ||
      this.childText(el, 'id') ||
      this.childText(el, 'reference') ||
      username;
    const name =
      this.childText(el, 'name') ||
      this.childText(el, 'title') ||
      this.fieldText(el, 'NAMEDAREA') ||
      this.fieldText(el, 'USERNAME') ||
      username;
    const namedArea = this.fieldText(el, 'NAMEDAREA') || this.childText(el, 'namedarea');
    const weight =
      parseFloat(this.childText(el, 'weight') || this.fieldText(el, 'WEIGHT') || '0') || 0;

    if (!terms.length && !id) {
      return null;
    }
    return {
      id,
      name,
      namedArea: namedArea || undefined,
      weight,
      terms
    };
  }

  private profileFromRecord(raw: unknown, username: string): CommunityProfile | null {
    if (!raw || typeof raw !== 'object') {
      return null;
    }
    const rec = raw as Record<string, unknown>;
    const fields = this.flattenDocument(rec);
    const terms = this.termsFromUnknown(rec).concat(
      parseWeightedTermString((fields['TRAINING'] || [])[0] || '')
    );
    const id = String(
      rec['pid'] ?? rec['autn:pid'] ?? rec['id'] ?? rec['autn:id'] ?? rec['reference'] ?? rec['autn:reference'] ?? username
    ).trim();
    const name = String(
      rec['name'] ??
        rec['autn:name'] ??
        rec['title'] ??
        rec['autn:title'] ??
        (fields['NAMEDAREA'] || [])[0] ??
        (fields['USERNAME'] || [])[0] ??
        username
    ).trim();
    const namedArea = String(
      rec['namedarea'] ?? rec['autn:namedarea'] ?? (fields['NAMEDAREA'] || [])[0] ?? ''
    ).trim();
    const weight =
      parseFloat(String(rec['weight'] ?? rec['autn:weight'] ?? (fields['WEIGHT'] || [])[0] ?? '0')) ||
      0;

    return {
      id: id || username,
      name: name || username,
      namedArea: namedArea || undefined,
      weight,
      terms: uniqueProfileTerms(terms)
    };
  }

  private collectTerms(root: Element): ProfileTerm[] {
    const terms: ProfileTerm[] = [];
    const termEls = [
      ...Array.from(root.getElementsByTagNameNS(AUTN_NS, 'term')),
      ...Array.from(root.getElementsByTagName('term'))
    ];
    const seen = new Set<Element>();
    for (const el of termEls) {
      if (seen.has(el)) {
        continue;
      }
      seen.add(el);
      const parsed = this.termFromElement(el);
      if (parsed) {
        terms.push(parsed);
      }
    }

    const training = this.fieldText(root, 'TRAINING');
    if (training) {
      terms.push(...parseWeightedTermString(training));
    }

    return uniqueProfileTerms(terms);
  }

  private termFromElement(el: Element): ProfileTerm | null {
    const nameChild = this.childText(el, 'name') || this.childText(el, 'value');
    const weightChild = this.childText(el, 'weight') || this.childText(el, 'score');
    const attrWeight =
      el.getAttribute('weight') ||
      el.getAttribute('autn:weight') ||
      Array.from(el.attributes).find((a) => a.localName === 'weight')?.value ||
      '';
    const rawText = (el.textContent ?? '').trim();
    const fromText = parseWeightedTermString(rawText);

    if (nameChild) {
      const weight = parseFloat(weightChild || attrWeight || '0') || 0;
      return { value: nameChild.trim(), weight };
    }
    if (fromText.length === 1) {
      return fromText[0];
    }
    if (fromText.length > 1) {
      return fromText[0];
    }
    const value = rawText.replace(/~\[\d+\]$/, '').trim();
    const weight = parseFloat(attrWeight || '0') || 0;
    if (!value || value.includes('\n') || value.length > 80) {
      return null;
    }
    if (weight <= 0) {
      return null;
    }
    return { value, weight };
  }

  private termsFromUnknown(raw: unknown): ProfileTerm[] {
    if (raw == null) {
      return [];
    }
    if (typeof raw === 'string') {
      return parseWeightedTermString(raw);
    }
    if (Array.isArray(raw)) {
      return uniqueProfileTerms(raw.flatMap((item) => this.termsFromUnknown(item)));
    }
    if (typeof raw !== 'object') {
      return [];
    }
    const rec = raw as Record<string, unknown>;
    const terms: ProfileTerm[] = [];
    for (const key of ['term', 'autn:term', 'terms', 'autn:terms', 'TRAINING', 'training']) {
      if (key in rec) {
        terms.push(...this.termsFromUnknown(rec[key]));
      }
    }
    const fields = this.flattenDocument(rec);
    terms.push(...parseWeightedTermString((fields['TRAINING'] || [])[0] || ''));
    if (typeof rec['name'] === 'string' && rec['weight'] != null) {
      terms.push({ value: rec['name'], weight: parseFloat(String(rec['weight'])) || 0 });
    }
    return uniqueProfileTerms(terms);
  }

  private flattenDocument(hit: Record<string, unknown>): Record<string, string[]> {
    const doc: Record<string, string[]> = {};
    const content = hit['content'] as Record<string, unknown> | undefined;
    let docs = content?.['DOCUMENT'] ?? content?.['document'] ?? hit['DOCUMENT'] ?? hit['document'];
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

  private childText(el: Element, local: string): string {
    const ns = el.getElementsByTagNameNS(AUTN_NS, local)[0];
    if (ns?.textContent) {
      return ns.textContent.trim();
    }
    return (el.getElementsByTagName(local)[0]?.textContent ?? '').trim();
  }

  private fieldText(el: Element, name: string): string {
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

  parseProfileClear(
    body: string,
    username: string,
    actionId: string,
    pid?: string
  ): ProfileClearResult {
    const text = (body ?? '').trim();
    const resultPid = (pid ?? '').trim() || undefined;
    const fail = (message: string, alreadyAbsent = false): ProfileClearResult => {
      const result: ProfileClearResult = {
        ok: alreadyAbsent,
        alreadyAbsent,
        actionId,
        userName: username,
        pid: resultPid,
        message
      };
      this.auditProfileClear(result);
      if (!alreadyAbsent) {
        throw new Error(message);
      }
      return result;
    };

    if (!text) {
      return fail('Empty response from Community.');
    }
    if (text.includes('<html') || text.includes('<HTML')) {
      return fail(
        'Community proxy returned HTML instead of ACI XML. Restart ./serve.sh after proxy changes.'
      );
    }

    let status = '';
    let detail = '';
    if (text.startsWith('{')) {
      try {
        const root = JSON.parse(text) as Record<string, unknown>;
        const autn = (root['autnresponse'] ?? root) as Record<string, unknown>;
        status = String(autn['response'] ?? '').toUpperCase();
        const data = (autn['responsedata'] ?? {}) as Record<string, unknown>;
        detail = String(
          data['autn_errorstring'] ??
            data['errorstring'] ??
            data['errordescription'] ??
            ''
        ).trim();
      } catch {
        return fail('Unexpected profile-clear response from Community.');
      }
    } else {
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      if (doc.querySelector('parsererror')) {
        return fail('Unexpected profile-clear response from Community.');
      }
      status = (doc.querySelector('response')?.textContent ?? '').trim().toUpperCase();
      detail =
        doc.querySelector('errordescription')?.textContent?.trim() ||
        doc.getElementsByTagNameNS(AUTN_NS, 'error')[0]?.textContent?.trim() ||
        '';
    }

    if (status === 'SUCCESS') {
      const result: ProfileClearResult = {
        ok: true,
        alreadyAbsent: false,
        actionId,
        userName: username,
        pid: resultPid,
        message: resultPid
          ? `Deleted profile ${resultPid} for ${username}.`
          : `Deleted the Community profile for ${username}.`
      };
      this.auditProfileClear(result);
      return result;
    }

    const message = (detail || 'Could not delete your profile.').replace(/^Error:\s*/i, '');
    if (this.isAlreadyAbsent(message)) {
      return fail(
        resultPid
          ? `No profile ${resultPid} found for ${username}.`
          : `No Community profile found for ${username}.`,
        true
      );
    }
    return fail(message);
  }

  private isMissingCommunityAction(err: Error, raw = ''): boolean {
    const text = `${err.message} ${raw}`;
    return /not recognized|unknown action|axeprofileread|0x8000a305/i.test(text);
  }

  /**
   * This lab's profile documents live in Agentstore (`DatabaseMatch=profile`,
   * refs like 1-p0). Community `ProfileRead` is not enabled on that ACI port.
   */
  private queryAgentstoreProfiles(username: string): Observable<CommunityProfile[]> {
    const base = environment.agentstoreApiUrl.replace(/\/?$/, '/');
    const params = new HttpParams()
      .set('action', 'Query')
      .set('Text', '*')
      .set('DatabaseMatch', 'profile')
      .set('AnyLanguage', 'true')
      .set('Print', 'all')
      .set('MaxResults', '50');
    return this.http.get(base, { params, responseType: 'text' }).pipe(
      map((body) => this.parseAgentstoreProfiles(body, username))
    );
  }

  private parseAgentstoreProfiles(xmlText: string, username: string): CommunityProfile[] {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText || '', 'text/xml');
    if (doc.querySelector('parsererror')) {
      return [];
    }
    const hits = [
      ...Array.from(doc.getElementsByTagNameNS(AUTN_NS, 'hit')),
      ...Array.from(doc.getElementsByTagName('hit'))
    ];
    const wanted = username.trim().toLowerCase();
    const profiles: CommunityProfile[] = [];
    for (const hit of hits) {
      const parsed = this.profileFromAgentstoreHit(hit, username);
      if (!parsed) {
        continue;
      }
      const owner = (parsed.name || parsed.id || '').trim().toLowerCase();
      if (wanted && owner && owner !== wanted && !owner.includes(wanted) && !wanted.includes(owner)) {
        continue;
      }
      profiles.push(parsed);
    }
    if (!profiles.length) {
      for (const hit of hits) {
        const parsed = this.profileFromAgentstoreHit(hit, username);
        if (parsed?.terms.length) {
          profiles.push(parsed);
        }
      }
    }
    return profiles.sort((a, b) => b.weight - a.weight);
  }

  private profileFromAgentstoreHit(hit: Element, username: string): CommunityProfile | null {
    const field = (name: string): string => {
      const nodes = [
        ...Array.from(hit.getElementsByTagNameNS(AUTN_NS, name)),
        ...Array.from(hit.getElementsByTagName(name))
      ];
      for (const node of nodes) {
        const text = (node.textContent || '').trim();
        if (text) {
          return text;
        }
      }
      const contentNodes = [
        ...Array.from(hit.getElementsByTagNameNS(AUTN_NS, 'content')),
        ...Array.from(hit.getElementsByTagName('content'))
      ];
      for (const node of contentNodes) {
        const n = (node.getAttribute('name') || node.getAttribute('field') || '').toLowerCase();
        if (n === name.toLowerCase()) {
          return (node.textContent || '').trim();
        }
      }
      return '';
    };
    const reference = field('reference') || field('DREREFERENCE');
    const owner = field('USERNAME') || field('USER') || field('DREUSERNAME') || field('NAME') || username;
    const training = field('TRAINING') || field('LINKS') || field('TERMS') || field('DRETERMS');
    const terms = uniqueProfileTerms([
      ...parseWeightedTermString(training),
      ...this.collectTerms(hit)
    ]);
    if (!reference && !terms.length) {
      return null;
    }
    const weight = Number(field('weight') || field('WEIGHT') || 0);
    return {
      id: reference || owner || username,
      name: owner || username,
      weight: Number.isFinite(weight) ? weight : 0,
      terms
    };
  }

  private isAlreadyAbsent(message: string): boolean {
    const m = (message ?? '').toLowerCase();
    return (
      m.includes('not found') ||
      m.includes('does not exist') ||
      m.includes('no profile') ||
      m.includes('unknown profile') ||
      m.includes('unknown user')
    );
  }

  private buildActionId(username: string, pid: string): string {
    const now = new Date();
    const ts =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, '0') +
      String(now.getDate()).padStart(2, '0') +
      'T' +
      String(now.getHours()).padStart(2, '0') +
      String(now.getMinutes()).padStart(2, '0') +
      String(now.getSeconds()).padStart(2, '0');
    const userPart = username.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 40);
    const pidPart = pid.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 24) || 'default';
    const rand = Math.random().toString(36).slice(2, 6);
    return `KD_ProfileClear_${ts}_${userPart}_${pidPart}_${rand}`;
  }

  private auditProfileClear(result: ProfileClearResult): void {
    console.info('[Community] ProfileClear', {
      timestamp: new Date().toISOString(),
      actor: this.auth.getUser()?.username ?? '',
      userName: result.userName,
      pid: result.pid ?? '',
      actionId: result.actionId,
      status: result.ok ? (result.alreadyAbsent ? 'absent' : 'SUCCESS') : 'FAILED',
      message: result.message
    });
  }

  private toProfileError(err: unknown, fallback = 'Could not load your profile from Community.'): Error {
    if (err instanceof Error && !(err instanceof HttpErrorResponse)) {
      return err;
    }
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return new Error(
          'Cannot reach Community (network or proxy). Restart ./serve.sh and check Community is up.'
        );
      }
      const body = typeof err.error === 'string' ? err.error : '';
      if (body.includes('errordescription') || body.includes('autnresponse')) {
        try {
          const parser = new DOMParser();
          const doc = parser.parseFromString(body, 'text/xml');
          const detail = doc.querySelector('errordescription')?.textContent?.trim();
          if (detail) {
            return new Error(detail.replace(/^Error:\s*/i, ''));
          }
        } catch {
          /* fall through */
        }
      }
      return new Error(`${fallback.replace(/\.$/, '')} (HTTP ${err.status}).`);
    }
    return new Error(fallback);
  }
}

function emptyProfile(username: string): CommunityProfile {
  return { id: username, name: username, weight: 0, terms: [] };
}
