import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/**
 * Clears the Community session after idleTimeoutMinutes of no user activity.
 */
@Injectable({ providedIn: 'root' })
export class IdleTimeoutService {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly minutes = Math.max(1, Number(environment.idleTimeoutMinutes) || 30);

  start(): void {
    if (typeof window === 'undefined') {
      return;
    }
    const bump = () => this.schedule();
    for (const event of ['pointerdown', 'keydown', 'click', 'scroll', 'touchstart']) {
      window.addEventListener(event, bump, { passive: true });
    }
    this.schedule();
  }

  private schedule(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => this.expire(), this.minutes * 60_000);
  }

  private expire(): void {
    if (!this.auth.isAuthenticated()) {
      this.schedule();
      return;
    }
    this.auth.logout();
    void this.router.navigateByUrl('/login');
  }
}
