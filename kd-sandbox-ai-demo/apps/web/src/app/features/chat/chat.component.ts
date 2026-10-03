import { Component, ElementRef, OnDestroy, OnInit, ViewChild, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ChatMessage, ChatSeed } from '../../core/models/chat';
import { AnswerService, AnswerSource, isUsableSourceTitle } from '../../core/services/answer.service';
import { ChatSessionService } from '../../core/services/chat-session.service';
import { ConversationService } from '../../core/services/conversation.service';
import { IdolDatabasesService } from '../../core/services/idol-databases.service';
import { SearchService } from '../../core/services/search.service';
import { MarkdownPipe } from '../../shared/pipes/markdown.pipe';
import {
  displayTitle,
  isMostlyHtml,
  markdownToHtml,
  prepareAssistantText,
  replaceReferencesWithTitles
} from '../../core/utils/chat-format';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [FormsModule, MarkdownPipe],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss'
})
export class ChatComponent implements OnInit, OnDestroy {
  private readonly chat = inject(ChatSessionService);
  private readonly conversation = inject(ConversationService);
  private readonly answers = inject(AnswerService);
  private readonly idolDatabases = inject(IdolDatabasesService);
  private readonly searchService = inject(SearchService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  @ViewChild('thread') private threadEl?: ElementRef<HTMLElement>;
  @ViewChild('composer') private composerEl?: ElementRef<HTMLTextAreaElement>;

  draft = '';
  private sessionSub?: Subscription;
  private converseSub?: Subscription;
  private titleSub?: Subscription;
  private bootstrapped = false;

  messages = this.chat.messages;
  sending = this.chat.sending;
  error = this.chat.error;
  databases = this.chat.databases;
  lockedRefs = this.chat.lockedRefs;
  continuedFromSearch = this.chat.continuedFromSearch;
  returnUrl = this.chat.returnUrl;

  ngOnInit(): void {
    const forceNew = this.route.snapshot.queryParamMap.get('new') === '1';
    this.bootstrap(forceNew);
  }

  ngOnDestroy(): void {
    this.sessionSub?.unsubscribe();
    this.converseSub?.unsubscribe();
    this.titleSub?.unsubscribe();
  }

  scopeLabel(): string {
    const locked = this.lockedRefs();
    if (locked.length) {
      return locked.length === 1
        ? '1 source document from the previous answer'
        : `${locked.length} source documents from the previous answer`;
    }
    const dbs = this.databases();
    return dbs.length ? dbs.join(', ') : 'all selected databases';
  }

  private sourceRefs(sources: { ref?: string }[] | undefined): string[] {
    const seen = new Set<string>();
    const refs: string[] = [];
    for (const src of sources ?? []) {
      const ref = (src.ref ?? '').trim();
      if (ref && !seen.has(ref)) {
        seen.add(ref);
        refs.push(ref);
      }
    }
    return refs;
  }

  canGoBackToResults(): boolean {
    return !!this.backHref();
  }

  backHref(): string {
    const stored = (this.returnUrl() || this.chat.lastResultsUrl() || '').trim();
    if (stored.startsWith('/search')) {
      return stored;
    }
    return '';
  }

  goBackToResults(event?: Event): void {
    event?.preventDefault();
    const url = this.backHref() || '/search';
    void this.router.navigateByUrl(url);
  }

  private resultsUrlFromSeed(seed: ChatSeed): string {
    const q = (seed.question || '').trim();
    if (q && q !== '*') {
      return `/search?q=${encodeURIComponent(q)}`;
    }
    const given = (seed.returnUrl || '').trim();
    if (given.startsWith('/search')) {
      return given;
    }
    return this.chat.lastResultsUrl() || '/search';
  }

  looksLikeHtml(text: string): boolean {
    return /^\s*</.test(text || '');
  }

  sourceLabel(src: AnswerSource): string {
    return displayTitle(src);
  }

  onComposerKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.shiftKey) {
      return;
    }
    event.preventDefault();
    this.send();
  }

  send(): void {
    const text = this.draft.trim();
    if (!text || this.sending()) {
      return;
    }
    this.draft = '';
    this.resizeComposer();
    const userMsg = this.chat.newMessage({ role: 'user', text });
    this.chat.messages.update((list) => [...list, userMsg]);
    this.scrollToEnd();
    if (this.handleLocalCommand(text)) {
      return;
    }
    this.ensureSessionThen(() => this.converse(text));
  }

  /**
   * Short control phrases must not go to Grok RAG.
   * "What database" (singular) used to miss the server trigger and search documents.
   */
  private handleLocalCommand(text: string): boolean {
    const t = text.trim().replace(/[.?!]+$/, '');
    if (this.isDatabaseListCommand(t)) {
      void this.replyLiveDatabases();
      return true;
    }
    if (/^(help|options|what can you do|how (do i|to) use this)$/i.test(t)) {
      this.replyLocal(this.helpHtml());
      return true;
    }
    if (/^(search all( databases)?|all databases|use all databases|reset databases)$/i.test(t)) {
      this.chat.lockedRefs.set([]);
      this.replyLocal(
        `<p>Searching <strong>${this.escape(this.scopeLabel())}</strong> again. Ask a question whenever you're ready.</p>`
      );
      return true;
    }
    return false;
  }

  /**
   * Match Settings → Databases phrasing as well as short commands.
   * "list searchable KD databases" used to miss the regex and go to RAG.
   */
  private isDatabaseListCommand(t: string): boolean {
    if (/^(what can you search|what do you know)$/i.test(t)) {
      return true;
    }
    const asksList = /\b(what|which|list|show|available|searchable|active)\b/i.test(t);
    const mentionsDb = /\b(data\s*bases?|dbs?|knowledge\s*bases?|kd\s+data\s*bases?)\b/i.test(t);
    return asksList && mentionsDb;
  }

  private async replyLiveDatabases(): Promise<void> {
    this.chat.sending.set(true);
    try {
      const result = await this.idolDatabases.listDatabases();
      this.replyLocal(this.databasesHelpHtml(result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not list databases.';
      this.replyLocal(`<p>${this.escape(msg)}</p>`);
    } finally {
      this.chat.sending.set(false);
    }
  }

  private databasesHelpHtml(result?: {
    ok: boolean;
    databases: { name: string; documents?: string; active?: boolean }[];
    error?: string;
  }): string {
    const locked = this.lockedRefs();
    const live = (result?.databases ?? []).filter((row) => row.active !== false);
    const items = live.length
      ? live
          .map((row) => {
            const docs = (row.documents ?? '').trim();
            const count = docs && docs !== '—' ? ` <span>(${this.escape(docs)} documents)</span>` : '';
            return `<li><strong>${this.escape(row.name)}</strong>${count}</li>`;
          })
          .join('')
      : '<li><em>No active databases returned by Content GetStatus.</em></li>';
    const sourceNote = result?.ok
      ? '<p>Names come from the live Content engine (same list as Settings → Databases), not from databases.json.</p>'
      : `<p>${this.escape(result?.error || 'Could not reach Content GetStatus.')}</p>`;
    const lock = locked.length
      ? `<p>This thread is also limited to <strong>${locked.length} source document${locked.length === 1 ? '' : 's'}</strong> from the previous answer.</p>`
      : '';
    return (
      `<p>Active Knowledge Discovery databases:</p><ul>${items}</ul>` +
      sourceNote +
      `<p>Currently searching: <strong>${this.escape(this.scopeLabel())}</strong>.</p>` +
      lock +
      `<p>Say <strong>use database IAEA</strong> or <strong>search all</strong> to change scope.</p>`
    );
  }

  private helpHtml(): string {
    return (
      `<p>I answer questions from your knowledge bases, then stay ready for the next one.</p><ul>` +
      `<li>Ask anything — I retrieve from <strong>${this.escape(this.scopeLabel())}</strong>.</li>` +
      `<li><strong>what databases</strong> — list searchable KD databases.</li>` +
      `<li><strong>use database xECM</strong> — persist a filter.</li>` +
      `<li><strong>search all</strong> — clear the filter and any source lock.</li>` +
      `<li><strong>New conversation</strong> — start over.</li>` +
      `</ul>`
    );
  }

  private replyLocal(html: string): void {
    this.chat.messages.update((list) => [
      ...list,
      this.chat.newMessage({ role: 'assistant', text: html })
    ]);
    this.chat.persist();
    this.scrollToEnd();
  }

  newConversation(): void {
    this.converseSub?.unsubscribe();
    this.sessionSub?.unsubscribe();
    const dbs = this.databases().length ? this.databases() : this.chat.lastDatabases();
    this.chat.resetLocal();
    this.startFresh(dbs);
  }

  private bootstrap(forceNew: boolean): void {
    if (this.bootstrapped) {
      return;
    }
    this.bootstrapped = true;

    const launch = this.chat.consumeLaunch();
    if (forceNew || launch?.mode === 'new') {
      this.startFresh(launch?.seed?.databases || this.chat.lastDatabases());
      return;
    }
    if (launch?.mode === 'continue' && launch.seed) {
      this.startFromAnswer(launch.seed);
      return;
    }

    const persisted = this.chat.loadPersisted();
    if (persisted?.sessionId && persisted.messages?.length) {
      this.chat.applyPersisted(persisted);
      queueMicrotask(() => {
        this.scrollToEnd();
        this.focusComposer();
      });
      return;
    }

    this.startFresh(this.chat.lastDatabases());
  }

  private startFromAnswer(seed: ChatSeed): void {
    this.chat.resetLocal();
    this.chat.databases.set(seed.databases ?? []);
    const locked = this.sourceRefs(seed.sources);
    this.chat.lockedRefs.set(locked);
    this.chat.continuedFromSearch.set(true);
    const back = this.resultsUrlFromSeed(seed);
    this.chat.returnUrl.set(back);
    this.chat.rememberResultsUrl(back);
    this.chat.rememberDatabases(seed.databases ?? []);

    const question = (seed.question || '').trim();
    const answer = (seed.answerText || '').trim();
    const seeded: ChatMessage[] = [];
    if (question) {
      seeded.push(this.chat.newMessage({ role: 'user', text: question }));
    }
    if (answer) {
      const sources = seed.sources ?? [];
      seeded.push(
        this.chat.newMessage({
          role: 'assistant',
          text: this.formatAssistantBody(answer, sources),
          markdown: true,
          sources
        })
      );
    }
    this.chat.messages.set(seeded);
    this.chat.persist();
    if (answer) {
      const last = seeded[seeded.length - 1];
      this.enrichSourceTitles(last.id, last.sources ?? []);
    }
    const sessionVars: Record<string, string> = {
      KEEP_CONTEXT: '1',
      SELECTED_DATABASE: (seed.databases ?? []).join(',') || '*',
      SELECTED_DATABASE_LABEL: (seed.databases ?? []).join(', ') || 'all databases',
      LAST_ANSWER: this.stripTags(answer).slice(0, 8000),
      LAST_SOURCES: locked.join(',')
    };
    if (locked.length) {
      sessionVars['LOCKED_REFERENCES'] = locked.join(',');
    }
    this.createSession(sessionVars);
    queueMicrotask(() => {
      this.scrollToEnd();
      this.focusComposer();
    });
  }

  private startFresh(databases: string[]): void {
    this.chat.resetLocal();
    this.chat.databases.set(databases ?? []);
    this.chat.lockedRefs.set([]);
    this.chat.continuedFromSearch.set(false);
    const previousResults = this.chat.lastResultsUrl();
    this.chat.returnUrl.set(previousResults);
    const scope = databases?.length ? databases.join(', ') : 'your selected knowledge bases';
    this.chat.messages.set([
      this.chat.newMessage({
        role: 'assistant',
        text:
          `<p>Ask a question about <strong>${this.escape(scope)}</strong>. ` +
          `I will search Knowledge Discovery, then stay ready for the next question or task.</p>` +
          `<p>Try <strong>what databases</strong>, <strong>use database xECM</strong>, or just ask.</p>`
      })
    ]);
    this.createSession({
      SELECTED_DATABASE: (databases ?? []).join(',') || '*',
      SELECTED_DATABASE_LABEL: (databases ?? []).join(', ') || 'all databases'
    });
    queueMicrotask(() => this.focusComposer());
  }

  private createSession(variables: Record<string, string>): void {
    this.sessionSub?.unsubscribe();
    this.chat.error.set(null);
    this.sessionSub = this.conversation.createSession({ variables }).subscribe({
      next: (id) => {
        this.chat.sessionId.set(id);
        this.chat.persist();
      },
      error: (err: Error) => {
        this.chat.error.set(err.message || 'Could not start a chat session.');
      }
    });
  }

  private ensureSessionThen(run: () => void): void {
    if (this.chat.sessionId()) {
      run();
      return;
    }
    this.chat.sending.set(true);
    this.sessionSub?.unsubscribe();
    const dbs = this.databases();
    this.sessionSub = this.conversation
      .createSession({
        variables: {
          SELECTED_DATABASE: dbs.join(',') || '*',
          SELECTED_DATABASE_LABEL: dbs.join(', ') || 'all databases'
        }
      })
      .subscribe({
        next: (id) => {
          this.chat.sessionId.set(id);
          this.chat.persist();
          run();
        },
        error: (err: Error) => {
          this.chat.sending.set(false);
          this.chat.error.set(err.message || 'Could not start a chat session.');
        }
      });
  }

  private converse(text: string): void {
    const sid = this.chat.sessionId();
    if (!sid) {
      this.chat.sending.set(false);
      this.chat.error.set('Chat session is not ready yet.');
      return;
    }
    this.chat.sending.set(true);
    this.chat.error.set(null);
    this.converseSub?.unsubscribe();

    const dbs = this.databases().filter((d) => d && d !== '*');
    // Direct AnswerServer Ask (same ACI as Settings Test :12000, via /answerserver proxy).
    // KDChat Converse wraps Ask and often returns the "couldn't find anything" stub
    // when Lua used DatabaseMatch=*.
    this.converseSub = this.answers.ask(text, { databases: dbs }).subscribe({
      next: (askRes) => {
        const askText = askRes.answers.map((a) => a.text).filter(Boolean).join('\n\n');
        const askSources = askRes.answers.flatMap((a) => a.sources ?? []);
        if (askText.trim()) {
          this.pushAssistant(askText, askSources);
          return;
        }
        this.fallbackConverse(sid, text);
      },
      error: () => this.fallbackConverse(sid, text)
    });
  }

  private fallbackConverse(sid: string, text: string): void {
    this.converseSub?.unsubscribe();
    this.converseSub = this.conversation.converse(sid, text).subscribe({
      next: (prompts) => {
        const raw = prompts.join('\n') || 'I did not get a reply. Try again.';
        const parsed = this.parseAssistantReply(raw);
        this.pushAssistant(parsed.body, parsed.sources);
      },
      error: (err: Error) => {
        this.chat.sending.set(false);
        this.chat.error.set(err.message || 'Chat request failed.');
        this.chat.persist();
      }
    });
  }

  private pushAssistant(body: string, sources: AnswerSource[] = []): void {
    const msg = this.chat.newMessage({
      role: 'assistant',
      text: this.formatAssistantBody(body, sources),
      markdown: true,
      sources
    });
    this.chat.messages.update((list) => [...list, msg]);
    this.chat.sending.set(false);
    this.chat.persist();
    this.scrollToEnd();
    this.enrichSourceTitles(msg.id, sources);
  }

  private scrollToEnd(): void {
    requestAnimationFrame(() => {
      const el = this.threadEl?.nativeElement;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    });
  }

  private focusComposer(): void {
    requestAnimationFrame(() => this.composerEl?.nativeElement.focus());
  }

  private resizeComposer(): void {
    const el = this.composerEl?.nativeElement;
    if (!el) {
      return;
    }
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }

  /**
   * KDChat wraps the model reply in a div and appends source <a href> links.
   * Keep real HTML in the body (so lists/tables stay intact). Flatten to
   * markdown text only when there are no tags left.
   */
  private parseAssistantReply(raw: string): { body: string; sources: AnswerSource[] } {
    const text = prepareAssistantText(raw);
    if (!text) {
      return { body: 'I did not get a reply. Try again.', sources: [] };
    }
    if (!/^\s*</.test(text)) {
      return { body: text, sources: [] };
    }
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const wrapped = doc.body.querySelector(
      'div[style*="font-family"], div[style*="font-family"]'
    );
    const root =
      wrapped && doc.body.children.length === 1 ? (wrapped as HTMLElement) : doc.body;
    const sources: AnswerSource[] = [];
    const seen = new Set<string>();
    for (const anchor of Array.from(root.querySelectorAll('a[href]'))) {
      const href = (anchor.getAttribute('href') || '').trim();
      if (!href || seen.has(href)) {
        continue;
      }
      seen.add(href);
      sources.push({
        ref: href,
        title: (anchor.textContent || '').trim(),
        database: '',
        snippet: ''
      });
    }
    for (const p of Array.from(root.querySelectorAll('p'))) {
      if ((p.textContent || '').trim().toLowerCase().startsWith('searched:')) {
        p.remove();
      }
    }
    // Only drop the citation list we appended (links whose href is a source ref).
    for (const list of Array.from(root.querySelectorAll('ul'))) {
      const hrefs = Array.from(list.querySelectorAll('a[href]')).map((a) =>
        (a.getAttribute('href') || '').trim()
      );
      if (hrefs.length && hrefs.every((h) => seen.has(h))) {
        list.remove();
      }
    }
    const html = (root.innerHTML || '').trim();
    const body = isMostlyHtml(html)
      ? html
      : (root.textContent || '').replace(/\n{3,}/g, '\n\n').trim() || text;
    return { body, sources };
  }

  private formatAssistantBody(raw: string, sources: AnswerSource[]): string {
    return replaceReferencesWithTitles(markdownToHtml(raw), sources);
  }

  private enrichSourceTitles(messageId: string, sources: AnswerSource[]): void {
    const refs = [
      ...new Set(
        sources
          .filter((s) => s.ref && !isUsableSourceTitle(s.title, s.ref))
          .map((s) => s.ref.trim())
      )
    ];
    if (!refs.length) {
      return;
    }
    // Locked continue-from-answer refs may live outside the left-panel DB list.
    const lookupDbs = this.lockedRefs().length ? [] : this.databases();
    this.titleSub?.unsubscribe();
    this.titleSub = this.searchService.getByReferences(refs, lookupDbs).subscribe({
      next: (hits) => {
        this.chat.messages.update((list) =>
          list.map((m) => {
            if (m.id !== messageId || !m.sources?.length) {
              return m;
            }
            const sources = m.sources.map((src) => {
              const hit = hits.find(
                (h) => this.normalizeReference(h.reference) === this.normalizeReference(src.ref)
              );
              const title = (hit?.title || '').trim();
              if (!isUsableSourceTitle(title, src.ref)) {
                return src;
              }
              return {
                ...src,
                title,
                database: hit?.database || src.database
              };
            });
            return {
              ...m,
              sources,
              text: replaceReferencesWithTitles(markdownToHtml(m.text), sources)
            };
          })
        );
        this.chat.persist();
      }
    });
  }

  private normalizeReference(ref: string): string {
    const raw = (ref ?? '').trim();
    if (!raw) {
      return '';
    }
    try {
      return decodeURIComponent(raw).replace(/[\\/]+$/, '').toLowerCase();
    } catch {
      return raw.replace(/[\\/]+$/, '').toLowerCase();
    }
  }

  private stripTags(html: string): string {
    return (html || '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private escape(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
