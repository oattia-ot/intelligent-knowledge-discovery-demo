import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/** Old /experts links keep the keyword and open search in Experts mode. */
export const expertsRedirectGuard: CanActivateFn = (route) => {
  const router = inject(Router);
  const q = (route.queryParamMap.get('q') || '').trim();
  return router.createUrlTree(['/search'], {
    queryParams: q ? { q } : {},
    fragment: 'experts-side-heading'
  });
};
