import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, firstValueFrom, from, of, throwError } from 'rxjs';
import { catchError, delay, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { AuthUser } from '../models/auth-user';
import { hasCommunityRole, parseCommunityRoleNames } from '../utils/community-roles';
import { AppSettingsService } from './app-settings.service';
import { EndpointHealthService } from './endpoint-health.service';

const AUTN_NS = 'http://schemas.autonomy.com/aci/';

/**
 * Community authentication (UserRead → SecurityInfo).
 * Token is kept in sessionStorage and attached to Content/View calls (Milestone 3+).
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly appSettings = inject(AppSettingsService);
  private readonly endpointHealth = inject(EndpointHealthService);
  private readonly sessionKey = environment.sessionKey;

  /**
   * Sign in via IDOL Community `action=UserRead&SecurityInfo=true`.
   * When `environment.useStubAuth` is true, accepts any credentials (local shell only).
   */
  login(username: string, password: string): Observable<AuthUser> {
    const user = username.trim();
    if (!user || !password) {
      return throwError(() => new Error('Please enter your username and password.'));
    }

    if (environment.useStubAuth) {
      const session: AuthUser = {
        username: user,
        token: '',
        stub: true,
        roles: [this.adminRoleName()],
        rolesLoaded: true
      };
      this.persist(session);
      return of(session).pipe(delay(250));
    }

    // Same-origin /community (dev proxy / Nginx). Do not call a saved
    // https://host/community URL from the browser — that is CORS + wrong port.
    const base = this.appSettings.requestUrl('communityApiUrl').replace(/\/?$/, '/');
    const params = new HttpParams()
      .set('action', 'UserRead')
      .set('UserName', user)
      .set('Password', password)
      // IDOL docs use True; some Community builds ignore lowercase true.
      .set('SecurityInfo', 'True')
      .set('RoleList', 'true');

    return this.http.get(base, { params, responseType: 'text' }).pipe(
      map((xmlText) => this.parseUserRead(xmlText, user)),
      switchMap((session) => this.withRoles(session)),
      catchError((err) => {
        // Do not send UserName/Password through /__kd-probe (open proxy / log leak).
        return throwError(() => this.toLoginError(err));
      })
    );
  }

  private canProbeFallback(err: unknown): boolean {
    if (!(err instanceof HttpErrorResponse)) return true;
    return err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504 || err.status === 500;
  }

  /**
   * Settings → Test path: Node probe talks HTTPS to host:9030 so the browser
   * never makes a cross-origin Community call.
   */
  private async loginViaProbe(user: string, password: string): Promise<AuthUser> {
    await this.endpointHealth.ensureLoaded();
    const statusUrl = this.endpointHealth.statusUrl(
      this.appSettings.communityApiUrl(),
      'communityApiUrl'
    );
    if (!statusUrl) {
      throw new Error('Community upstream is not configured.');
    }
    let origin: string;
    try {
      origin = new URL(statusUrl).origin;
    } catch {
      throw new Error('Community upstream URL is invalid.');
    }
    const test =
      `/?action=UserRead&UserName=${encodeURIComponent(user)}` +
      `&Password=${encodeURIComponent(password)}&SecurityInfo=True`;
    try {
      const xmlText = await firstValueFrom(
        this.http.get('/__kd-probe', {
          responseType: 'text',
          headers: {
            'X-KD-Probe-Target': origin,
            'X-KD-Probe-Test': test
          }
        })
      );
      const session = this.parseUserRead(xmlText, user);
      return await firstValueFrom(this.withRoles(session));
    } catch (err) {
      throw this.toLoginError(err);
    }
  }

  logout(): void {
    sessionStorage.removeItem(this.sessionKey);
  }

  getUser(): AuthUser | null {
    const raw = sessionStorage.getItem(this.sessionKey);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as AuthUser;
    } catch {
      return null;
    }
  }

  /** SecurityInfo token for downstream ACI calls (URL-encode once at use site). */
  getSecurityInfo(): string {
    return this.getUser()?.token ?? '';
  }

  adminRoleName(): string {
    return ((environment as { adminRole?: string }).adminRole || 'KDUIAdmin').trim();
  }

  hasRole(roleName: string): boolean {
    return hasCommunityRole(this.getUser()?.roles, roleName);
  }

  hasAdminRole(): boolean {
    return this.hasRole(this.adminRoleName());
  }

  /**
   * Load Community roles when an existing session was created before RoleList.
   * Failures leave the user signed in without admin access.
   */
  ensureRoles(): Observable<AuthUser | null> {
    const session = this.getUser();
    if (!session || !this.isAuthenticated()) {
      return of(null);
    }
    if (session.rolesLoaded) {
      return of(session);
    }
    return this.withRoles(session).pipe(catchError(() => of(this.getUser())));
  }

  private withRoles(session: AuthUser): Observable<AuthUser> {
    if (session.stub) {
      const stub: AuthUser = {
        ...session,
        roles: session.roles?.length ? session.roles : [this.adminRoleName()],
        rolesLoaded: true
      };
      this.persist(stub);
      return of(stub);
    }
    if (session.rolesLoaded) {
      return of(session);
    }
    if (session.roles?.length) {
      const loaded = { ...session, rolesLoaded: true };
      this.persist(loaded);
      return of(loaded);
    }

    const base = this.appSettings.requestUrl('communityApiUrl').replace(/\/?$/, '/');
    let params = new HttpParams()
      .set('action', 'RoleUserGetRoleList')
      .set('UserName', session.username);
    if (session.token) {
      params = params.set('SecurityInfo', session.token);
    }

    return this.http.get(base, { params, responseType: 'text' }).pipe(
      map((xmlText) => {
        const roles = parseCommunityRoleNames(xmlText);
        const next: AuthUser = { ...session, roles, rolesLoaded: true };
        this.persist(next);
        return next;
      }),
      catchError(() => {
        const next: AuthUser = { ...session, roles: session.roles ?? [], rolesLoaded: true };
        this.persist(next);
        return of(next);
      })
    );
  }

  isAuthenticated(): boolean {
    const u = this.getUser();
    if (!u?.username) {
      return false;
    }
    if (u.stub || u.unsecured) {
      return true;
    }
    return !!u.token;
  }

  /** True when ACI calls should omit SecurityInfo (stub or unsecured Community). */
  allowsUnauthedAci(): boolean {
    const u = this.getUser();
    return !!u && (u.stub === true || u.unsecured === true);
  }

  private persist(user: AuthUser): void {
    sessionStorage.setItem(this.sessionKey, JSON.stringify(user));
  }

  private parseUserRead(xmlText: string, username: string): AuthUser {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');

    if (doc.querySelector('parsererror')) {
      // Sometimes a proxy returns HTML error pages with HTTP 200
      if (xmlText.includes('<html') || xmlText.includes('<HTML')) {
        throw new Error(
          'Community proxy returned HTML instead of ACI XML. Restart ./serve.sh after proxy changes.'
        );
      }
      throw new Error('Unexpected response from Community. Please try again.');
    }

    const responseStatus = doc.querySelector('response')?.textContent?.trim();
    if (responseStatus !== 'SUCCESS') {
      const errorEl =
        doc.getElementsByTagNameNS(AUTN_NS, 'error')[0] ??
        doc.querySelector('errordescription') ??
        doc.querySelector('error');
      const detail =
        doc.querySelector('errordescription')?.textContent?.trim() ||
        errorEl?.textContent?.trim();
      throw new Error(
        detail
          ? detail.replace(/^Error:\s*/i, '')
          : 'Authentication failed. Please check your credentials.'
      );
    }

    const isAuthenticated = this.xmlFlag(doc, 'authenticate');

    if (!isAuthenticated) {
      throw new Error('Invalid credentials. Please try again.');
    }

    const token = this.extractSecurityInfo(doc, xmlText);

    if (!token) {
      // Community verified the password but is not configured to mint tokens
      // (no SecurityInfoKeys / security module). Still open a session so the
      // sandbox UI works against unsecured Content.
      console.warn(
        '[KD Auth] Community UserRead succeeded without SecurityInfo. Continuing with an unsecured session.'
      );
      const roles = parseCommunityRoleNames(xmlText);
      const session: AuthUser = {
        username,
        token: '',
        stub: false,
        unsecured: true,
        roles,
        rolesLoaded: roles.length > 0
      };
      this.persist(session);
      return session;
    }

    const roles = parseCommunityRoleNames(xmlText);
    const session: AuthUser = {
      username,
      token,
      stub: false,
      unsecured: false,
      roles,
      rolesLoaded: roles.length > 0
    };
    this.persist(session);
    return session;
  }

  /** True when an ACI boolean-like element equals "true" (any namespace/case). */
  private xmlFlag(doc: Document, localName: string): boolean {
    const el = this.findElement(doc, localName);
    return el?.textContent?.trim().toLowerCase() === 'true';
  }

  /**
   * Read the SecurityInfo token from UserRead XML.
   * Community versions differ: namespaced autn:securityinfo, bare securityinfo,
   * nested securitystring, or mixed case.
   */
  private extractSecurityInfo(doc: Document, xmlText: string): string {
    const direct = this.elementToken(this.findElement(doc, 'securityinfo'));
    if (direct) {
      return direct;
    }
    const nested = this.elementToken(this.findElement(doc, 'securitystring'));
    if (nested) {
      return nested;
    }

    const tagged = xmlText.match(
      /<(?:[\w.]+:)?securityinfo\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?securityinfo>/i
    );
    if (tagged) {
      const inner = tagged[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
        .replace(/<(?:[\w.]+:)?securitystring\b[^>]*>([\s\S]*?)<\/(?:[\w.]+:)?securitystring>/i, '$1')
        .replace(/<[^>]+>/g, '')
        .trim();
      if (inner) {
        return inner;
      }
    }
    return '';
  }

  private elementToken(el: Element | null): string {
    if (!el) {
      return '';
    }
    const child = this.findElement(el, 'securitystring');
    const raw = (child?.textContent ?? el.textContent ?? '').trim();
    return raw;
  }

  private findElement(root: ParentNode, localName: string): Element | null {
    const want = localName.toLowerCase();
    if (root instanceof Document) {
      const ns = root.getElementsByTagNameNS(AUTN_NS, localName)[0];
      if (ns) {
        return ns;
      }
      const nsLower = root.getElementsByTagNameNS(AUTN_NS, want)[0];
      if (nsLower) {
        return nsLower;
      }
    }
    const all = (root as Document | Element).getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const local = (el.localName || el.tagName || '').replace(/^.*:/, '').toLowerCase();
      if (local === want) {
        return el;
      }
    }
    return null;
  }

  private toLoginError(err: unknown): Error {
    if (err instanceof Error && !(err instanceof HttpErrorResponse)) {
      return err;
    }
    if (err instanceof HttpErrorResponse) {
      // Prefer ACI error text if the body is XML even on non-2xx
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

      if (err.status === 0) {
        return new Error(
          'Cannot reach Community (network or proxy). Restart ./serve.sh and check Community is up.'
        );
      }
      if (err.status === 401 || err.status === 403) {
        return new Error('Invalid credentials. Please try again.');
      }
      if (err.status === 500 || err.status === 502 || err.status === 504) {
        return new Error(
          `Community proxy error (HTTP ${err.status}). The dev proxy was updated to call Community directly — restart ./serve.sh and try again.`
        );
      }
      return new Error(
        `Authentication request failed (HTTP ${err.status}). Please try again.`
      );
    }
    return new Error('Authentication request failed.');
  }
}
