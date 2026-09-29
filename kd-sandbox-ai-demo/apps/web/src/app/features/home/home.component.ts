import { Component, OnDestroy, OnInit, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { AnswerService } from '../../core/services/answer.service';
import { BrandingService } from '../../core/services/branding.service';
import { ResultUrlService } from '../../core/services/result-url.service';
import { ConceptSearchSettingsService } from '../../core/services/concept-search-settings.service';
import { ConfigService } from '../../core/services/config.service';
import {
  TypeaheadService,
  TypeaheadSuggestion
} from '../../core/services/typeahead.service';
import {
  SearchKind,
  SearchKindComponent
} from '../../shared/components/search-kind/search-kind.component';
import { MyRecommendationsComponent } from '../recommendations/my-recommendations.component';

/** Debounce before QMS TypeAhead while typing. */
const TYPEAHEAD_DEBOUNCE_MS = 220;

/**
 * Google-style search home (post-login).
 * Centered box + TypeAhead only — no Content Query until the user submits.
 */
@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, SearchKindComponent, MyRecommendationsComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly typeaheadService = inject(TypeaheadService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly config = inject(ConfigService);
  private readonly resultUrls = inject(ResultUrlService);
  private readonly answerService = inject(AnswerService);
  private readonly conceptSettings = inject(ConceptSearchSettingsService);
  private readonly branding = inject(BrandingService);

  readonly appTitle = this.branding.title;
  readonly appName = this.branding.subtitle;
  readonly logoUrl = this.branding.logoUrl;

  query = '';
  searchKind: SearchKind = 'documents';
  readonly expertsEnabled = this.conceptSettings.expertsEnabled;
  readonly recommendationsOnHome = this.conceptSettings.recommendationsOnHome;
  suggestions = signal<TypeaheadSuggestion[]>([]);
  suggestionsOpen = signal(false);
  suggestionsLoading = signal(false);
  suggestionIndex = signal(-1);

  private typeaheadSub?: Subscription;
  private typeaheadTimer?: ReturnType<typeof setTimeout>;
  private skipNextTypeahead = false;

  constructor() {
    effect(() => {
      if (!this.expertsEnabled() && this.searchKind === 'experts') {
        this.searchKind = 'documents';
      }
    });
  }

  ngOnInit(): void {
    // Warm config/templates while the user types (no Content Query).
    this.config.getDatabases().subscribe({ error: () => undefined });
    this.config.getParametricFilters().subscribe({ error: () => undefined });
    this.config.getFieldsConfig().subscribe({ error: () => undefined });
    this.config.getAnswerConfig().subscribe({ error: () => undefined });
    this.answerService.preload();
    this.resultUrls.preload().subscribe({ error: () => undefined });
  }

  ngOnDestroy(): void {
    this.clearTypeaheadTimer();
    this.typeaheadSub?.unsubscribe();
  }

  onSubmit(): void {
    this.clearTypeaheadTimer();
    this.closeSuggestions();
    const text = this.query.trim();
    if (!text) {
      return;
    }
    if (this.expertsEnabled() && this.searchKind === 'experts') {
      void this.router.navigate(['/experts'], { queryParams: { q: text } });
      return;
    }
    void this.router.navigate(['/search'], {
      queryParams: { q: text }
    });
  }

  onQueryInput(): void {
    const text = this.query.trim();
    if (!text) {
      this.clearTypeaheadTimer();
      this.typeaheadSub?.unsubscribe();
      this.closeSuggestions();
      this.suggestions.set([]);
      return;
    }
    if (this.skipNextTypeahead) {
      this.skipNextTypeahead = false;
      return;
    }
    this.scheduleTypeahead(text);
  }

  onQueryFocus(): void {
    if (this.suggestions().length > 0) {
      this.suggestionsOpen.set(true);
    } else if (this.query.trim().length >= this.typeaheadService.minChars) {
      this.scheduleTypeahead(this.query.trim());
    }
  }

  onQueryBlur(): void {
    setTimeout(() => this.closeSuggestions(), 150);
  }

  onQueryKeydown(event: KeyboardEvent): void {
    const list = this.suggestions();
    const open = this.suggestionsOpen() && list.length > 0;

    if (event.key === 'Escape') {
      if (open) {
        event.preventDefault();
        this.closeSuggestions();
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      if (!list.length) {
        return;
      }
      event.preventDefault();
      this.suggestionsOpen.set(true);
      const next = this.suggestionIndex() < 0 ? 0 : (this.suggestionIndex() + 1) % list.length;
      this.suggestionIndex.set(next);
      return;
    }

    if (event.key === 'ArrowUp') {
      if (!open) {
        return;
      }
      event.preventDefault();
      const idx = this.suggestionIndex();
      if (idx <= 0) {
        this.suggestionIndex.set(list.length - 1);
      } else {
        this.suggestionIndex.set(idx - 1);
      }
      return;
    }

    if (event.key === 'Enter' && open && this.suggestionIndex() >= 0) {
      event.preventDefault();
      const pick = list[this.suggestionIndex()];
      if (pick) {
        this.selectSuggestion(pick);
      }
    }
  }

  selectSuggestion(item: TypeaheadSuggestion, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.clearTypeaheadTimer();
    this.typeaheadSub?.unsubscribe();
    this.skipNextTypeahead = true;
    this.closeSuggestions();
    this.query = item.text;
    if (this.expertsEnabled() && this.searchKind === 'experts') {
      void this.router.navigate(['/experts'], { queryParams: { q: item.text } });
      return;
    }
    void this.router.navigate(['/search'], {
      queryParams: { q: item.text }
    });
  }

  suggestionLabelHtml(text: string): SafeHtml {
    const q = this.query.trim();
    if (!q || !text) {
      return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(text));
    }
    const lowerText = text.toLowerCase();
    const lowerQ = q.toLowerCase();
    const at = lowerText.indexOf(lowerQ);
    if (at < 0) {
      return this.sanitizer.bypassSecurityTrustHtml(this.escapeHtml(text));
    }
    const before = this.escapeHtml(text.slice(0, at));
    const match = this.escapeHtml(text.slice(at, at + q.length));
    const after = this.escapeHtml(text.slice(at + q.length));
    return this.sanitizer.bypassSecurityTrustHtml(
      `${before}<strong class="suggest-match">${match}</strong>${after}`
    );
  }

  private scheduleTypeahead(text: string): void {
    this.clearTypeaheadTimer();
    if (text.length < this.typeaheadService.minChars) {
      this.typeaheadSub?.unsubscribe();
      this.closeSuggestions();
      return;
    }
    this.typeaheadTimer = setTimeout(() => {
      this.typeaheadTimer = undefined;
      const current = this.query.trim();
      if (current !== text || current.length < this.typeaheadService.minChars) {
        return;
      }
      this.fetchTypeahead(current);
    }, TYPEAHEAD_DEBOUNCE_MS);
  }

  private fetchTypeahead(text: string): void {
    this.typeaheadSub?.unsubscribe();
    this.suggestionsLoading.set(true);
    this.typeaheadSub = this.typeaheadService.suggest(text).subscribe({
      next: (items) => {
        if (this.query.trim().toLowerCase() !== text.toLowerCase()) {
          return;
        }
        this.suggestions.set(items);
        this.suggestionIndex.set(-1);
        this.suggestionsOpen.set(items.length > 0);
        this.suggestionsLoading.set(false);
      },
      error: () => {
        this.suggestionsLoading.set(false);
        this.closeSuggestions();
      }
    });
  }

  private closeSuggestions(): void {
    this.suggestionsOpen.set(false);
    this.suggestionIndex.set(-1);
    this.suggestionsLoading.set(false);
    if (!this.query.trim()) {
      this.suggestions.set([]);
    }
  }

  private clearTypeaheadTimer(): void {
    if (this.typeaheadTimer !== undefined) {
      clearTimeout(this.typeaheadTimer);
      this.typeaheadTimer = undefined;
    }
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
