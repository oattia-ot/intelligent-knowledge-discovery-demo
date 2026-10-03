import { Injectable, inject, signal } from '@angular/core';
import { ChatLaunch, ChatMessage, ChatPersistedState, ChatSeed } from '../models/chat';

const LAUNCH_KEY = 'kd_kdchat_launch';
const STATE_KEY = 'kd_kdchat_state';
const LAST_DB_KEY = 'kd_kdchat_last_databases';
const LAST_RESULTS_URL_KEY = 'kd_kdchat_last_results_url';

/**
 * In-memory + sessionStorage bridge between the Answer panel and `/chat`.
 * Launch payload is one-shot (consumed by the chat page).
 */
@Injectable({ providedIn: 'root' })
export class ChatSessionService {
  readonly messages = signal<ChatMessage[]>([]);
  readonly sessionId = signal<string | null>(null);
  readonly databases = signal<string[]>([]);
  readonly lockedRefs = signal<string[]>([]);
  readonly continuedFromSearch = signal(false);
  readonly returnUrl = signal<string | null>(null);
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);

  peekLaunch(): ChatLaunch | null {
    return this.readJson<ChatLaunch>(LAUNCH_KEY);
  }

  consumeLaunch(): ChatLaunch | null {
    const launch = this.peekLaunch();
    sessionStorage.removeItem(LAUNCH_KEY);
    return launch;
  }

  /** Seed a new conversation from the current Answer panel (does not Ask again). */
  queueContinue(seed: ChatSeed): void {
    const launch: ChatLaunch = { mode: 'continue', seed };
    sessionStorage.setItem(LAUNCH_KEY, JSON.stringify(launch));
    this.rememberDatabases(seed.databases);
  }

  /** Open an empty conversation (header or “New conversation”). */
  queueNew(databases?: string[]): void {
    const launch: ChatLaunch = { mode: 'new' };
    sessionStorage.setItem(LAUNCH_KEY, JSON.stringify(launch));
    if (databases?.length) {
      this.rememberDatabases(databases);
    }
  }

  lastDatabases(): string[] {
    const raw = sessionStorage.getItem(LAST_DB_KEY);
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? parsed.map((d) => String(d)).filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  rememberDatabases(databases: string[]): void {
    const clean = (databases ?? []).map((d) => d.trim()).filter(Boolean);
    if (clean.length) {
      sessionStorage.setItem(LAST_DB_KEY, JSON.stringify(clean));
    }
  }

  /** Persist the results URL separately so New conversation still can go back. */
  rememberResultsUrl(url: string): void {
    const clean = (url ?? '').trim();
    if (clean.startsWith('/search')) {
      sessionStorage.setItem(LAST_RESULTS_URL_KEY, clean);
    }
  }

  lastResultsUrl(): string | null {
    const raw = sessionStorage.getItem(LAST_RESULTS_URL_KEY);
    return raw && raw.startsWith('/search') ? raw : null;
  }

  loadPersisted(): ChatPersistedState | null {
    return this.readJson<ChatPersistedState>(STATE_KEY);
  }

  persist(): void {
    const sid = this.sessionId();
    if (!sid) {
      sessionStorage.removeItem(STATE_KEY);
      return;
    }
    const state: ChatPersistedState = {
      sessionId: sid,
      systemName: 'KDChat',
      messages: this.messages(),
      databases: this.databases(),
      lockedRefs: this.lockedRefs(),
      continuedFromSearch: this.continuedFromSearch(),
      returnUrl: this.returnUrl() || undefined
    };
    sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
  }

  applyPersisted(state: ChatPersistedState): void {
    this.sessionId.set(state.sessionId);
    this.messages.set(state.messages ?? []);
    this.databases.set(state.databases ?? []);
    this.lockedRefs.set(state.lockedRefs ?? []);
    this.continuedFromSearch.set(!!state.continuedFromSearch);
    this.returnUrl.set(state.returnUrl ?? null);
    this.sending.set(false);
    this.error.set(null);
  }

  resetLocal(): void {
    this.sessionId.set(null);
    this.messages.set([]);
    this.databases.set([]);
    this.lockedRefs.set([]);
    this.continuedFromSearch.set(false);
    this.returnUrl.set(null);
    this.sending.set(false);
    this.error.set(null);
    sessionStorage.removeItem(STATE_KEY);
  }

  clearAll(): void {
    this.resetLocal();
    sessionStorage.removeItem(LAUNCH_KEY);
    sessionStorage.removeItem(LAST_DB_KEY);
    sessionStorage.removeItem(LAST_RESULTS_URL_KEY);
  }

  newMessage(partial: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
    return {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      ...partial
    };
  }

  private readJson<T>(key: string): T | null {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      sessionStorage.removeItem(key);
      return null;
    }
  }
}
