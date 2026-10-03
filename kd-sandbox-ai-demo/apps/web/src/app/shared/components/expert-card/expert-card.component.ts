import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ExpertPerson } from '../../../core/models/expertise';

@Component({
  selector: 'app-expert-card',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './expert-card.component.html',
  styleUrl: './expert-card.component.scss'
})
export class ExpertCardComponent implements OnChanges {
  @Input({ required: true }) person!: ExpertPerson;
  /** When true, keyword chips stay hidden until the user expands them. */
  @Input() termsCollapsed = false;
  @Input() compact = false;
  /** When set, the card links to the full experts page for this topic. */
  @Input() expandQuery = '';

  termsOpen = false;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['person']) {
      this.termsOpen = false;
    }
  }

  get initials(): string {
    const parts = (this.person.displayName || this.person.username || '')
      .split(/\s+/)
      .filter(Boolean);
    if (!parts.length) {
      return '?';
    }
    if (parts.length === 1) {
      return parts[0].slice(0, 2).toUpperCase();
    }
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  get scoreLabel(): string {
    const n = Math.round(this.person.weight);
    if (!Number.isFinite(n) || n <= 0) {
      return '';
    }
    return `${n}% match`;
  }

  get showKeywordToggle(): boolean {
    return this.termsCollapsed && this.person.terms.length > 1;
  }

  get showTerms(): boolean {
    if (!this.person.terms.length) {
      return false;
    }
    if (this.person.terms.length === 1) {
      return true;
    }
    return !this.termsCollapsed || this.termsOpen;
  }

  toggleTerms(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.termsOpen = !this.termsOpen;
  }
}
