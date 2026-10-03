import { Injectable } from '@angular/core';

const LAST_SEARCH_URL_KEY = 'kd_last_search_url';

/**
 * Optional hand-off helpers between login and search.
 *
 * Auto-running a search immediately after login was removed — post-login
 * lands on /home, and Content Query only runs once the user is on
 * /search (either via a submitted `?q=` term, or the results page's own
 * `*` match-all default — see SearchComponent.DEFAULT_QUERY). That is
 * unrelated to, and unaffected by, `pendingDefaultSearch` below.
 */
@Injectable({ providedIn: 'root' })
export class SearchInitService {
  /** @deprecated No longer used; kept for compatibility. */
  pendingDefaultSearch = false;

  markLoginSuccess(): void {
    this.pendingDefaultSearch = false;
  }

  consumePendingDefaultSearch(): boolean {
    this.pendingDefaultSearch = false;
    return false;
  }

  /** Remember `/search?q=…` so Recommendations can return to results. */
  rememberSearchUrl(url: string): void {
    const raw = (url ?? '').trim();
    if (!this.isSearchUrl(raw)) {
      return;
    }
    try {
      sessionStorage.setItem(LAST_SEARCH_URL_KEY, raw);
    } catch {
      /* ignore */
    }
  }

  lastSearchUrl(): string | null {
    try {
      const raw = sessionStorage.getItem(LAST_SEARCH_URL_KEY);
      return raw && this.isSearchUrl(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  isSearchUrl(url: string): boolean {
    const path = (url ?? '').split('?')[0].split('#')[0].replace(/\/+$/, '') || '/';
    return path === '/search' || path.endsWith('/search');
  }
}
