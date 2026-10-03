import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import { ExpertPerson } from '../../core/models/expertise';
import { ConceptSearchSettingsService } from '../../core/services/concept-search-settings.service';
import { ExpertiseService } from '../../core/services/expertise.service';
import { ExpertCardComponent } from '../../shared/components/expert-card/expert-card.component';

@Component({
  selector: 'app-experts',
  standalone: true,
  imports: [FormsModule, ExpertCardComponent],
  templateUrl: './experts.component.html',
  styleUrl: './experts.component.scss'
})
export class ExpertsComponent implements OnInit, OnDestroy {
  private readonly expertise = inject(ExpertiseService);
  private readonly conceptSettings = inject(ConceptSearchSettingsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  query = '';
  similar = signal<ExpertPerson[]>([]);
  similarLoading = signal(false);
  experts = signal<ExpertPerson[]>([]);
  expertsLoading = signal(false);
  lastInterest = signal('');

  private similarSub?: Subscription;
  private expertsSub?: Subscription;
  private routeSub?: Subscription;

  goBackToSearch(event?: Event): void {
    event?.preventDefault();
    const q = (this.lastInterest() || this.query || '').trim();
    void this.router.navigate(['/search'], {
      queryParams: q ? { q } : {}
    });
  }

  ngOnInit(): void {
    this.conceptSettings.onExpertsEnabledChange(() => {
      if (!this.conceptSettings.expertsEnabled()) {
        void this.router.navigate(['/home']);
      }
    });
    this.loadSimilar();
    this.routeSub = this.route.queryParamMap.subscribe((params) => {
      const q = (params.get('q') || '').trim();
      this.query = q;
      if (q) {
        this.loadExperts(q);
      } else {
        this.experts.set([]);
        this.lastInterest.set('');
      }
    });
  }

  ngOnDestroy(): void {
    this.conceptSettings.onExpertsEnabledChange(null);
    this.similarSub?.unsubscribe();
    this.expertsSub?.unsubscribe();
    this.routeSub?.unsubscribe();
  }

  onSubmit(): void {
    const q = this.query.trim();
    void this.router.navigate(['/experts'], {
      queryParams: q ? { q } : {}
    });
  }

  private loadSimilar(): void {
    this.similarSub?.unsubscribe();
    this.similarLoading.set(true);
    this.similarSub = this.expertise.similarPeople().subscribe({
      next: (people) => {
        this.similar.set(people);
        this.similarLoading.set(false);
      },
      error: () => {
        this.similar.set([]);
        this.similarLoading.set(false);
      }
    });
  }

  private loadExperts(text: string): void {
    this.expertsSub?.unsubscribe();
    this.expertsLoading.set(true);
    this.lastInterest.set(text);
    this.expertsSub = this.expertise.expertsByInterest(text).subscribe({
      next: (people) => {
        this.experts.set(people);
        this.expertsLoading.set(false);
      },
      error: () => {
        this.experts.set([]);
        this.expertsLoading.set(false);
      }
    });
  }
}
