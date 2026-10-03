import { Location } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  CONCEPT_OPERATORS,
  ConceptOperator,
  ConceptSearchSettingsService,
  SUMMARY_LENGTH_OPTIONS,
  SUMMARY_TYPES,
  SummaryType
} from '../../core/services/concept-search-settings.service';
import { SearchInitService } from '../../core/services/search-init.service';

export type SettingId =
  | 'operator'
  | 'summary-type'
  | 'summary-length'
  | 'troubleshooting'
  | 'recommendations'
  | 'experts'
  | 'profiles';

interface SettingSection {
  id: SettingId;
  title: string;
  hint: string;
  keywords: string;
}

const SETTING_SECTIONS: readonly SettingSection[] = [
  {
    id: 'operator',
    title: 'Join concepts with',
    hint: 'Operator between concept tags.',
    keywords:
      'AND OR YNEAR WNEAR DNEAR NEAR join concepts tags multi-concept proximity boolean query operator'
  },
  {
    id: 'summary-type',
    title: 'Summary type',
    hint: 'How result snippets are generated.',
    keywords: 'summary snippet context concept quick paragraph sentence off idol'
  },
  {
    id: 'summary-length',
    title: 'Summary length',
    hint: 'Maximum characters for each result snippet.',
    keywords: 'summary length characters 50 100 150 200 300 400 500 800 snippet size'
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    hint: 'Last expanded query from QMS synonym / replacement rules.',
    keywords: 'troubleshooting expanded query qms synonym cooked text debug'
  },
  {
    id: 'recommendations',
    title: 'Recommendations',
    hint: 'Show or hide My Recommendations in the app and on the home page.',
    keywords:
      'recommendations my recommendations landing home panel for you profile terms hide show'
  },
  {
    id: 'experts',
    title: 'Experts search',
    hint: 'Show people whose interests match a topic.',
    keywords: 'experts expertise people like you topic profiles community agentstore hide show'
  },
  {
    id: 'profiles',
    title: 'My profile',
    hint: 'Search terms and delete your Community interest profile.',
    keywords:
      'delete profile clear reset ProfileClear pid interest terms recommendations expertise privacy erase'
  }
];

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit, OnDestroy {
  private readonly conceptSettings = inject(ConceptSearchSettingsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly searchInit = inject(SearchInitService);

  readonly conceptOperators = CONCEPT_OPERATORS;
  readonly summaryTypes = SUMMARY_TYPES;
  readonly summaryLengthOptions = SUMMARY_LENGTH_OPTIONS;
  readonly lastExpandedQuery = this.conceptSettings.lastExpandedQuery;
  readonly operator = this.conceptSettings.operator;
  readonly summaryType = this.conceptSettings.summaryType;
  readonly summaryLength = this.conceptSettings.summaryLength;
  readonly expertsSearchEnabled = this.conceptSettings.expertsSearchUserEnabled;
  readonly recommendationsUserEnabled = this.conceptSettings.recommendationsUserEnabled;
  readonly recommendationsOnHomeUserEnabled =
    this.conceptSettings.recommendationsOnHomeUserEnabled;

  query = '';
  readonly filter = signal('');
  readonly backLabel = signal('← Back to search home');
  readonly backHref = signal('/home');

  readonly visibleSections = computed(() => {
    const recsOn = this.conceptSettings.recommendationsFeatureAvailable();
    const expertsOn = this.conceptSettings.expertsFeatureAvailable();
    const words = this.filter()
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return SETTING_SECTIONS.filter((section) => {
      if (section.id === 'recommendations' && !recsOn) {
        return false;
      }
      if (section.id === 'experts' && !expertsOn) {
        return false;
      }
      if (!words.length) {
        return true;
      }
      const hay = `${section.title} ${section.hint} ${section.keywords}`.toLowerCase();
      return words.every((word) => hay.includes(word));
    });
  });

  private useHistoryBack = false;
  private routeSub?: Subscription;
  private skipUrlWrite = false;

  ngOnInit(): void {
    this.captureBackTarget();
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const q = (params.get('q') || '').trim();
      if (q === this.filter().trim()) {
        return;
      }
      this.skipUrlWrite = true;
      this.query = q;
      this.filter.set(q);
      this.skipUrlWrite = false;
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
  }

  onFilterChange(value: string): void {
    this.query = value;
    this.filter.set(value);
    if (this.skipUrlWrite) {
      return;
    }
    const q = value.trim();
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: q || null },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  sectionVisible(id: SettingId): boolean {
    return this.visibleSections().some((s) => s.id === id);
  }

  goBack(event?: Event): void {
    event?.preventDefault();
    if (this.useHistoryBack) {
      this.location.back();
      return;
    }
    void this.router.navigateByUrl(this.backHref());
  }

  setConceptOperator(op: ConceptOperator, event?: Event): void {
    event?.preventDefault();
    this.conceptSettings.setOperator(op);
  }

  setSummaryType(type: SummaryType, event?: Event): void {
    event?.preventDefault();
    this.conceptSettings.setSummaryType(type);
  }

  setSummaryLength(length: number, event?: Event): void {
    event?.preventDefault();
    this.conceptSettings.setSummaryLength(length);
  }

  setExpertsSearchEnabled(on: boolean, event?: Event): void {
    event?.preventDefault();
    this.conceptSettings.setExpertsSearchEnabled(on);
  }

  setRecommendationsEnabled(on: boolean, event?: Event): void {
    event?.preventDefault();
    this.conceptSettings.setRecommendationsEnabled(on);
  }

  setRecommendationsOnHome(on: boolean, event?: Event): void {
    event?.preventDefault();
    this.conceptSettings.setRecommendationsOnHome(on);
  }

  private captureBackTarget(): void {
    const nav = this.router.lastSuccessfulNavigation();
    const prev = nav?.previousNavigation;
    const tree = prev?.finalUrl ?? prev?.extractedUrl;
    const previousUrl = tree ? this.router.serializeUrl(tree) : '';
    const path = this.pathOnly(previousUrl);

    if (this.searchInit.isSearchUrl(previousUrl)) {
      this.useHistoryBack = true;
      this.backHref.set(previousUrl);
      this.backLabel.set('← Back to search results');
      return;
    }

    if (
      path === '/home' ||
      path === '/chat' ||
      path === '/experts' ||
      path === '/recommendations' ||
      path === '/settings/profiles' ||
      path === '/admin'
    ) {
      this.useHistoryBack = true;
      this.backHref.set(previousUrl || path);
      this.backLabel.set(path === '/home' ? '← Back to search home' : '← Back');
      return;
    }
    const lastSearch = this.searchInit.lastSearchUrl();
    if (lastSearch) {
      this.useHistoryBack = false;
      this.backHref.set(lastSearch);
      this.backLabel.set('← Back to search results');
      return;
    }
    this.useHistoryBack = false;
    this.backHref.set('/home');
    this.backLabel.set('← Back to search home');
  }

  private pathOnly(url: string): string {
    const path = (url ?? '').split('?')[0].split('#')[0].replace(/\/+$/, '');
    return path || '/';
  }
}
