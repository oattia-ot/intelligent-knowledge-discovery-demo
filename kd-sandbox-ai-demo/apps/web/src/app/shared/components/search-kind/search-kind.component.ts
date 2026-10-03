import { Component, EventEmitter, Input, Output } from '@angular/core';

export type SearchKind = 'documents' | 'experts';

@Component({
  selector: 'app-search-kind',
  standalone: true,
  templateUrl: './search-kind.component.html',
  styleUrl: './search-kind.component.scss'
})
export class SearchKindComponent {
  @Input() value: SearchKind = 'documents';
  @Output() valueChange = new EventEmitter<SearchKind>();

  readonly options: { id: SearchKind; label: string }[] = [
    { id: 'documents', label: 'Documents' },
    { id: 'experts', label: 'Experts' }
  ];

  select(kind: SearchKind): void {
    if (kind === this.value) {
      return;
    }
    this.value = kind;
    this.valueChange.emit(kind);
  }
}
