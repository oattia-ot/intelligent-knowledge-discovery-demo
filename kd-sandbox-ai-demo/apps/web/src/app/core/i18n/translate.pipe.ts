import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from './i18n.service';

/**
 * Pure: false so the view updates when the language signal changes
 * (Angular re-evaluates impure pipes on change detection).
 */
@Pipe({ name: 't', pure: false, standalone: true })
export class TranslatePipe implements PipeTransform {
  private readonly i18n = inject(I18nService);

  transform(key: string): string {
    return this.i18n.t(key);
  }
}
