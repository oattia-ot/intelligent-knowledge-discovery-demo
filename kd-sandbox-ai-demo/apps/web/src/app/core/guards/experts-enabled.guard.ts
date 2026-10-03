import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { ConceptSearchSettingsService } from '../services/concept-search-settings.service';

/** Block /experts when Settings (or expertise.json) has experts search off. */
export const expertsEnabledGuard: CanActivateFn = () => {
  const settings = inject(ConceptSearchSettingsService);
  const router = inject(Router);
  return settings.whenExpertsFeatureReady().pipe(
    map(() =>
      settings.expertsEnabled() ? true : router.createUrlTree(['/home'])
    )
  );
};
