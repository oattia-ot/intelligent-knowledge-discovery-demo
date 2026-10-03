import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map } from 'rxjs/operators';
import { AuthService } from '../services/auth.service';

/**
 * `/admin` is only for Community members of `environment.adminRole` (KDUIAdmin).
 * JSON config writes are checked again on the admin-config API.
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }

  return auth.ensureRoles().pipe(
    map(() => (auth.hasAdminRole() ? true : router.createUrlTree(['/home'])))
  );
};
