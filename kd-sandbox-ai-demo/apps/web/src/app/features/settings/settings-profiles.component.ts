import { Component, HostListener, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { Subscription, concat } from 'rxjs';
import { last } from 'rxjs/operators';
import { CommunityProfile, ProfileTerm } from '../../core/models/recommendation';
import { AuthService } from '../../core/services/auth.service';
import { CommunityProfileService } from '../../core/services/community-profile.service';
import { RecommendationsService } from '../../core/services/recommendations.service';

@Component({
  selector: 'app-settings-profiles',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './settings-profiles.component.html',
  styleUrl: './settings-profiles.component.scss'
})
export class SettingsProfilesComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly communityProfiles = inject(CommunityProfileService);
  private readonly recommendations = inject(RecommendationsService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  query = '';
  readonly filter = signal('');
  readonly signedInUser = signal('');
  readonly profiles = signal<CommunityProfile[]>([]);
  readonly profilesLoading = signal(false);
  readonly profilesError = signal<string | null>(null);
  readonly profilesStatus = signal<string | null>(null);
  readonly confirmOpen = signal(false);
  readonly confirmPid = signal<string | undefined>(undefined);
  readonly confirmAll = signal(false);
  readonly deleteBusy = signal(false);
  readonly expandedProfiles = signal<ReadonlySet<string>>(new Set());

  readonly visibleProfiles = computed(() => {
    const words = this.filterWords();
    const list = this.profiles();
    if (!words.length) {
      return list;
    }
    return list.filter((profile) => this.profileMatches(profile, words));
  });

  private profileSub?: Subscription;
  private deleteSub?: Subscription;
  private routeSub?: Subscription;
  private skipUrlWrite = false;

  ngOnInit(): void {
    this.signedInUser.set(this.auth.getUser()?.username?.trim() || '');
    this.reloadProfiles();
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const q = (params.get('q') || '').trim();
      if (q === this.filter().trim()) {
        return;
      }
      this.skipUrlWrite = true;
      this.query = q;
      this.filter.set(q);
      this.skipUrlWrite = false;
      this.expandMatches();
    });
  }

  ngOnDestroy(): void {
    this.routeSub?.unsubscribe();
    this.profileSub?.unsubscribe();
    this.deleteSub?.unsubscribe();
  }

  onFilterChange(value: string): void {
    this.query = value;
    this.filter.set(value);
    this.expandMatches();
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

  profilePid(profile: CommunityProfile): string | undefined {
    return this.communityProfiles.communityPid(profile, this.signedInUser());
  }

  profileLabel(profile: CommunityProfile): string {
    const name = (profile.name || profile.namedArea || 'Profile').trim();
    const pid = this.profilePid(profile);
    const terms = profile.terms.length;
    const termBit = terms ? `${terms} term${terms === 1 ? '' : 's'}` : 'no terms';
    return pid ? `${name} (${pid}) · ${termBit}` : `${name} · ${termBit}`;
  }

  profileKey(profile: CommunityProfile): string {
    return `${this.profilePid(profile) || profile.id}::${profile.name}`;
  }

  profileDomId(profile: CommunityProfile): string {
    return 'profile-terms-' + this.profileKey(profile).replace(/[^a-zA-Z0-9_-]+/g, '-');
  }

  isProfileExpanded(profile: CommunityProfile): boolean {
    return this.expandedProfiles().has(this.profileKey(profile));
  }

  toggleProfileExpand(profile: CommunityProfile, event?: Event): void {
    event?.preventDefault();
    const key = this.profileKey(profile);
    const next = new Set(this.expandedProfiles());
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    this.expandedProfiles.set(next);
  }

  sortedTerms(profile: CommunityProfile): ProfileTerm[] {
    return [...(profile.terms ?? [])].sort(
      (a, b) => b.weight - a.weight || a.value.localeCompare(b.value)
    );
  }

  termMatches(term: ProfileTerm): boolean {
    const words = this.filterWords();
    if (!words.length) {
      return false;
    }
    const value = (term.value ?? '').toLowerCase();
    return words.some((w) => value.includes(w));
  }

  askDeleteProfile(profile: CommunityProfile, event?: Event): void {
    event?.preventDefault();
    event?.stopPropagation();
    this.profilesStatus.set(null);
    this.confirmAll.set(false);
    this.confirmPid.set(this.profilePid(profile));
    this.confirmOpen.set(true);
  }

  askDeleteAllProfiles(event?: Event): void {
    event?.preventDefault();
    this.profilesStatus.set(null);
    this.confirmAll.set(true);
    this.confirmPid.set(undefined);
    this.confirmOpen.set(true);
  }

  cancelDelete(event?: Event): void {
    event?.preventDefault();
    if (this.deleteBusy()) {
      return;
    }
    this.confirmOpen.set(false);
    this.confirmPid.set(undefined);
    this.confirmAll.set(false);
  }

  confirmDelete(event?: Event): void {
    event?.preventDefault();
    if (this.deleteBusy()) {
      return;
    }
    const user = this.signedInUser();
    if (!user) {
      this.profilesError.set('You are not signed in. Please sign in again.');
      this.confirmOpen.set(false);
      return;
    }

    const all = this.confirmAll();
    const pid = this.confirmPid();
    const jobs = all
      ? this.pidsToClear().map((id) => this.communityProfiles.clearCurrentUserProfile(id))
      : [this.communityProfiles.clearCurrentUserProfile(pid)];
    if (all && jobs.length === 0) {
      jobs.push(this.communityProfiles.clearCurrentUserProfile());
    }

    this.deleteBusy.set(true);
    this.profilesError.set(null);
    this.deleteSub?.unsubscribe();
    this.deleteSub = concat(...jobs)
      .pipe(last())
      .subscribe({
        next: (result) => {
          this.deleteBusy.set(false);
          this.confirmOpen.set(false);
          this.recommendations.clearCache();
          this.profilesStatus.set(
            result.alreadyAbsent
              ? result.message
              : all
                ? `Deleted Community profile data for ${user}. Recommendations will be empty until you preview documents again.`
                : result.message
          );
          this.reloadProfiles();
        },
        error: (err: Error) => {
          this.deleteBusy.set(false);
          this.confirmOpen.set(false);
          this.profilesError.set(err?.message || 'Could not delete your profile.');
          this.reloadProfiles();
        }
      });
  }

  confirmCopy(): string {
    const user = this.signedInUser() || 'this user';
    const pid = this.confirmPid();
    if (this.confirmAll()) {
      return `Delete the Community interest profile for ${user}? This cannot be undone. Your sign-in is kept. Recommendations and expertise training for you will be cleared.`;
    }
    if (pid) {
      return `Delete Community profile ${pid} for ${user}? This cannot be undone.`;
    }
    return `Delete the Community interest profile for ${user}? This cannot be undone.`;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.confirmOpen() && !this.deleteBusy()) {
      this.cancelDelete();
    }
  }

  private filterWords(): string[] {
    return this.filter().trim().toLowerCase().split(/\s+/).filter(Boolean);
  }

  private profileMatches(profile: CommunityProfile, words: string[]): boolean {
    const hay = [
      profile.name,
      profile.namedArea,
      profile.id,
      this.profilePid(profile),
      ...(profile.terms ?? []).map((t) => t.value)
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return words.every((w) => hay.includes(w));
  }

  private expandMatches(): void {
    const words = this.filterWords();
    if (!words.length) {
      return;
    }
    const next = new Set(this.expandedProfiles());
    for (const profile of this.profiles()) {
      if (this.profileMatches(profile, words)) {
        next.add(this.profileKey(profile));
      }
    }
    this.expandedProfiles.set(next);
  }

  private pidsToClear(): string[] {
    const user = this.signedInUser();
    const ids = this.profiles()
      .map((p) => this.communityProfiles.communityPid(p, user))
      .filter((id): id is string => !!id);
    return [...new Set(ids)];
  }

  private reloadProfiles(): void {
    this.profileSub?.unsubscribe();
    this.profilesLoading.set(true);
    this.profileSub = this.communityProfiles.getCurrentUserProfiles().subscribe({
      next: (list) => {
        this.profiles.set(list);
        this.profilesLoading.set(false);
        this.expandMatches();
      },
      error: (err: Error) => {
        this.profiles.set([]);
        this.profilesLoading.set(false);
        if (!this.profilesError()) {
          this.profilesError.set(err?.message || 'Could not load your profile.');
        }
      }
    });
  }
}
