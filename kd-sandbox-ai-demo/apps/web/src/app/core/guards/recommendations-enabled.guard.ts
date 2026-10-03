import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { ConceptSearchSettingsService } from '../services/concept-search-settings.service';

/** Block /recommendations when Settings (or recommendations.json) has the feature off. */
export const recommendationsEnabledGuard: CanActivateFn = () => {
  const settings = inject(ConceptSearchSettingsService);
  const router = inject(Router);
  return settings.whenRecommendationsFeatureReady().pipe(
    map(() =>
      settings.recommendationsEnabled() ? true : router.createUrlTree(['/home'])
    )
  );
};
