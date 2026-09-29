import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom, timeout } from 'rxjs';
import { AppSettingsService } from './app-settings.service';

export interface IdolDatabaseInfo {
  name: string;
  documents?: string;
  /** False when Content reports the DB as inactive / offline. */
  active?: boolean;
}

export interface IdolDatabaseListResult {
  ok: boolean;
  databases: IdolDatabaseInfo[];
  error?: string;
  source?: string;
}

export interface IdolDatabaseCreateResult {
  ok: boolean;
  name?: string;
  error?: string;
}

/**
 * Lists and creates IDOL Content databases via the Content ACI / index ports.
 * Delete is intentionally not implemented — that stays in the KD Admin UI.
 */
@Injectable({ providedIn: 'root' })
export class IdolDatabasesService {
  private readonly http = inject(HttpClient);
  private readonly appSettings = inject(AppSettingsService);
  private listCache: { at: number; result: IdolDatabaseListResult } | null = null;

  async listDatabases(force = false): Promise<IdolDatabaseListResult> {
    const now = Date.now();
    if (!force && this.listCache && now - this.listCache.at < 15000) {
      return this.listCache.result;
    }

    const base = this.normalizeBase(this.appSettings.requestUrl('contentApiUrl'));
    const params = new HttpParams().set('action', 'GetStatus');
    try {
      const body = await firstValueFrom(
        this.http.get(base, { params, responseType: 'text' }).pipe(timeout(4000))
      );
      if (this.isHtml(body) || !(body ?? '').trim()) {
        return {
          ok: false,
          databases: this.listCache?.result.databases ?? [],
          error:
            'Content ACI GetStatus did not return IDOL XML/JSON. ' +
            'The query port (usually 9100) is not reachable — a 200 on DRECREATEDBASE (:9101) is a different port.'
        };
      }
      const databases = this.parseDatabases(body).filter((row) => row.active !== false);
      const result: IdolDatabaseListResult = { ok: true, databases, source: base };
      this.listCache = { at: Date.now(), result };
      return result;
    } catch (err) {
      return {
        ok: false,
        databases: this.listCache?.result.databases ?? [],
        error: this.describeError(err, 'Could not list databases from the Content component.')
      };
    }
  }

  async createDatabase(rawName: string): Promise<IdolDatabaseCreateResult> {
    const name = this.sanitizeName(rawName);
    if (!name) {
      return {
        ok: false,
        error: 'Enter a database name using letters, numbers, or underscore.'
      };
    }

    const aci = await this.probeContentAci();
    if (!aci.ok) {
      return {
        ok: false,
        name,
        error:
          aci.error ||
          'Content ACI is not reachable on the query port (usually 9100). ' +
            'A 200 from /DRECREATEDBASE is the index port (9101) and does not mean Content is up.'
      };
    }

    const attempts = this.createUrls(name);
    let lastError = 'Create failed.';
    for (const url of attempts) {
      for (const method of ['GET', 'POST'] as const) {
        try {
          const req$ =
            method === 'POST'
              ? this.http.post(url, null, { responseType: 'text' })
              : this.http.get(url, { responseType: 'text' });
          const body = await firstValueFrom(req$.pipe(timeout(8000)));
          if (this.isHtml(body)) {
            lastError =
              `Index port returned an HTML page for ${url} (HTTP 200). ` +
              'That is not an IDOL DRECREATEDBASE response — Content is not serving this path.';
            continue;
          }
          const idolError = this.extractIdolIndexError(body);
          if (idolError) {
            lastError = idolError;
            continue;
          }
          if (this.isIdolCreateAck(body)) {
            this.listCache = null;
            return { ok: true, name };
          }
          lastError =
            this.extractError(body) ||
            `Index port returned HTTP 200 for ${url} but the body is not an IDOL create acknowledgement ` +
              `(expected INDEXID=… or an IDOL success line). Body: ${this.preview(body)}`;
        } catch (err) {
          lastError = this.describeCreateError(err, url, lastError);
        }
      }
    }
    return { ok: false, name, error: lastError };
  }

  sanitizeName(raw: string): string {
    return (raw ?? '').trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_]/g, '');
  }

  private createUrls(name: string): string[] {
    // Always go through the index proxy prefixes so Vite/Nginx strip them
    // and IDOL sees /DRECREATEDBASE on :9101 — never a bare /DRECREATEDBASE
    // that can hit some other process and return a meaningless HTTP 200.
    const encoded = encodeURIComponent(name);
    const configured = this.normalizeBase(
      this.appSettings.contentIndexApiUrl() || '/content/Index'
    );
    const urls = [`${configured}DRECREATEDBASE?DREDBNAME=${encoded}`];
    for (const prefix of ['/content/Index/', '/content-index/']) {
      const candidate = `${prefix}DRECREATEDBASE?DREDBNAME=${encoded}`;
      if (!urls.includes(candidate)) urls.push(candidate);
    }
    return urls;
  }

  /** Content ACI GetStatus — required before create so a lone :9101 200 cannot look healthy. */
  private async probeContentAci(): Promise<{ ok: boolean; error?: string }> {
    const base = this.normalizeBase(this.appSettings.requestUrl('contentApiUrl'));
    const params = new HttpParams().set('action', 'GetStatus');
    try {
      const body = await firstValueFrom(
        this.http.get(base, { params, responseType: 'text' }).pipe(timeout(4000))
      );
      if (this.isHtml(body)) {
        return {
          ok: false,
          error:
            'Content ACI returned the SPA HTML instead of GetStatus XML/JSON. ' +
            'The query port (usually 9100) is not reachable through /content.'
        };
      }
      const text = (body ?? '').toLowerCase();
      if (text.includes('responsedata') || text.includes('<autn:') || text.includes('productversion')) {
        return { ok: true };
      }
      if (!text.trim()) {
        return { ok: false, error: 'Content ACI GetStatus returned an empty body. The query port is not serving IDOL.' };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: this.describeError(
          err,
          'Content ACI is not reachable (query port, usually 9100). Fix Application Configuration before creating a database.'
        )
      };
    }
  }

  private normalizeBase(url: string): string {
    const trimmed = (url || '/content').trim() || '/content';
    return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
  }

  private parseDatabases(body: string): IdolDatabaseInfo[] {
    const text = (body ?? '').trim();
    if (!text) return [];
    if (text.startsWith('{') || text.startsWith('[')) {
      try {
        return this.fromJson(JSON.parse(text));
      } catch {
        /* fall through to XML */
      }
    }
    return this.fromXml(text);
  }

  private fromJson(data: unknown): IdolDatabaseInfo[] {
    const section = this.findDatabasesSection(data);
    const raw = section?.['database'] ?? section?.['Database'];
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    return this.unique(
      rows.map((row) => this.fromDatabaseRecord(row)).filter((row): row is IdolDatabaseInfo => !!row)
    );
  }

  /**
   * GetStatus also lists language types (`afrikaansUTF8`, …). Those live under
   * `language_type_settings` and must not be treated as IDOL databases.
   * Only `responsedata.databases.database` is the admin Databases page list.
   */
  private findDatabasesSection(data: unknown): Record<string, unknown> | null {
    const walk = (node: unknown, inheritedKey?: string): Record<string, unknown> | null => {
      if (!node || typeof node !== 'object') return null;
      if (Array.isArray(node)) {
        for (const item of node) {
          const found = walk(item, inheritedKey);
          if (found) return found;
        }
        return null;
      }
      const rec = node as Record<string, unknown>;
      if (inheritedKey === 'databases' && ('database' in rec || 'Database' in rec)) {
        return rec;
      }
      if ('database' in rec || 'Database' in rec) {
        const parentLooksLikeLang =
          inheritedKey === 'language_type_settings' ||
          inheritedKey === 'language_types' ||
          'language_type' in rec;
        if (!parentLooksLikeLang && inheritedKey !== 'language_type') {
          // Prefer an explicit `databases` wrapper when present.
          if (inheritedKey === 'databases' || inheritedKey === 'responsedata') {
            return rec;
          }
        }
      }
      if ('databases' in rec) {
        const inner = rec['databases'];
        if (inner && typeof inner === 'object' && !Array.isArray(inner)) {
          return inner as Record<string, unknown>;
        }
      }
      for (const [key, value] of Object.entries(rec)) {
        if (key === 'language_type_settings' || key === 'language_types' || key === 'language_type') {
          continue;
        }
        const found = walk(value, key);
        if (found) return found;
      }
      return null;
    };
    return walk(data);
  }

  private fromDatabaseRecord(row: unknown): IdolDatabaseInfo | null {
    if (!row || typeof row !== 'object') return null;
    const rec = row as Record<string, unknown>;
    if (String(rec['internal'] ?? '').toLowerCase() === 'true') return null;
    const name = this.asString(rec['name'] ?? rec['Name'] ?? rec['NAME']);
    if (!name) return null;
    return {
      name,
      documents: this.asString(
        rec['documents'] ?? rec['Documents'] ?? rec['DOCUMENTCOUNT'] ?? rec['documentcount']
      ),
      active: this.asActive(rec['active'] ?? rec['Active'] ?? rec['status'] ?? rec['Status'])
    };
  }

  private fromXml(xml: string): IdolDatabaseInfo[] {
    // Restrict to the <databases> block so <language_type><name>… is ignored.
    const section =
      xml.match(/<(?:[\w-]+:)?databases\b[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?databases>/i)?.[1] ?? '';
    const source = section || xml;
    const found: IdolDatabaseInfo[] = [];
    const blockRe =
      /<(?:[\w-]+:)?database\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?database>/gi;
    let match: RegExpExecArray | null;
    while ((match = blockRe.exec(source))) {
      const attrs = match[1] ?? '';
      const inner = match[2] ?? '';
      const name =
        this.xmlAttr(attrs, 'name') ||
        this.xmlTag(inner, 'name') ||
        this.xmlTag(inner, 'dbname');
      if (!name) continue;
      found.push({
        name,
        documents:
          this.xmlAttr(attrs, 'documents') ||
          this.xmlTag(inner, 'documents') ||
          this.xmlTag(inner, 'documentcount'),
        active: this.asActive(
          this.xmlAttr(attrs, 'active') ||
            this.xmlTag(inner, 'active') ||
            this.xmlTag(inner, 'status')
        )
      });
    }
    return this.unique(found);
  }

  private unique(rows: IdolDatabaseInfo[]): IdolDatabaseInfo[] {
    const seen = new Set<string>();
    const out: IdolDatabaseInfo[] = [];
    for (const row of rows) {
      const key = row.name.toLowerCase();
      if (!row.name || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  private xmlTag(xml: string, localName: string): string | undefined {
    const re = new RegExp(`<(?:[\\w-]+:)?${localName}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w-]+:)?${localName}>`, 'i');
    const match = xml.match(re);
    return match?.[1]?.replace(/<[^>]+>/g, '').trim() || undefined;
  }

  private xmlAttr(attrs: string, name: string): string | undefined {
    const re = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i');
    return attrs.match(re)?.[1]?.trim() || undefined;
  }

  private asString(value: unknown): string | undefined {
    if (value == null) return undefined;
    if (typeof value === 'string' || typeof value === 'number') {
      const text = String(value).trim();
      return text || undefined;
    }
    if (typeof value === 'object' && '#' in (value as object)) {
      return this.asString((value as { '#': unknown })['#']);
    }
    return undefined;
  }

  /** Missing/unknown treated as active so we do not hide live DBs. */
  private asActive(value: unknown): boolean {
    const text = this.asString(value)?.toLowerCase();
    if (!text) return true;
    return text !== 'false' && text !== '0' && text !== 'inactive' && text !== 'offline' && text !== 'no';
  }

  private isHtml(body: string): boolean {
    const text = (body ?? '').slice(0, 200).toLowerCase();
    return (
      text.includes('<html') ||
      text.includes('<!doctype') ||
      text.includes('ng-version') ||
      text.includes('<app-root')
    );
  }

  /** Real IDOL index-port create ack only — never a generic HTTP 200 / HTML page. */
  private isIdolCreateAck(body: string): boolean {
    const text = (body ?? '').trim();
    if (!text || this.isHtml(text)) return false;
    if (/INDEXID\s*=\s*\d+/i.test(text)) return true;
    if (/index\s*queued/i.test(text)) return true;
    if (/<response>\s*success\s*<\/response>/i.test(text)) return true;
    if (/"response"\s*:\s*"success"/i.test(text)) return true;
    return false;
  }

  private extractIdolIndexError(body: string): string | undefined {
    const text = (body ?? '').trim();
    if (!text) return 'Index port returned HTTP 200 with an empty body — not an IDOL create acknowledgement.';
    const labeled = text.match(/\bERROR\s*[:=]\s*([^\r\n]+)/i)?.[1]?.trim();
    if (labeled) return labeled;
    if (/already exists/i.test(text)) return text.slice(0, 240);
    if (/\bERR(?:OR|MSG)?\b/i.test(text) && !this.isIdolCreateAck(text)) {
      return text.slice(0, 240);
    }
    return this.extractError(text);
  }

  private preview(body: string): string {
    const text = (body ?? '').replace(/\s+/g, ' ').trim();
    if (!text) return '(empty)';
    return text.length > 180 ? `${text.slice(0, 180)}…` : text;
  }

  private describeCreateError(err: unknown, url: string, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 404) {
        return (
          `Content Index returned 404 for ${url}. ` +
          'DRECREATEDBASE must be sent to the Content index port (usually 9101) as ' +
          '/DRECREATEDBASE?DREDBNAME=… — not /Index/DRECREATEDBASE on the ACI port (9100). ' +
          'Restart the dev server so the /content/Index → :9101 proxy rule is loaded.'
        );
      }
      if (err.status === 0) {
        return 'Could not reach the Content index port. Check Application Configuration (Content Index) and that port 9101 is open.';
      }
      const fromBody =
        typeof err.error === 'string' ? this.extractError(err.error) : undefined;
      return fromBody || err.message || fallback;
    }
    return err instanceof Error ? err.message : fallback;
  }

  private extractError(body: string): string | undefined {
    const xml = this.xmlTag(body, 'error') || this.xmlTag(body, 'errordescription');
    if (xml) return xml;
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const err = this.asString(parsed['error'] ?? parsed['errordescription']);
      if (err) return err;
    } catch {
      /* ignore */
    }
    return undefined;
  }

  private describeError(err: unknown, fallback: string): string {
    if (err instanceof HttpErrorResponse) {
      if (err.status === 0) {
        return 'Could not reach the Content component. Check Application Configuration.';
      }
      const fromBody =
        typeof err.error === 'string' ? this.extractError(err.error) : undefined;
      return fromBody || err.message || fallback;
    }
    return err instanceof Error ? err.message : fallback;
  }
}
