import { Routes } from '@angular/router';
import { adminGuard } from './core/guards/admin.guard';
import { authGuard } from './core/guards/auth.guard';
import { expertsEnabledGuard } from './core/guards/experts-enabled.guard';
import { recommendationsEnabledGuard } from './core/guards/recommendations-enabled.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/login/login.component').then((m) => m.LoginComponent)
  },
  {
    path: 'home',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/home/home.component').then((m) => m.HomeComponent)
  },
  {
    path: 'search',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/search/search.component').then((m) => m.SearchComponent)
  },
  {
    path: 'chat',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/chat/chat.component').then((m) => m.ChatComponent)
  },
  {
    path: 'settings/profiles',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/settings-profiles.component').then(
        (m) => m.SettingsProfilesComponent
      )
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/settings.component').then((m) => m.SettingsComponent)
  },
  {
    path: 'admin',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/admin/admin.component').then((m) => m.AdminComponent)
  },
  {
    path: 'recommendations',
    canActivate: [authGuard, recommendationsEnabledGuard],
    loadComponent: () =>
      import('./features/recommendations/my-recommendations.component').then(
        (m) => m.MyRecommendationsComponent
      )
  },
  {
    path: 'experts',
    canActivate: [authGuard, expertsEnabledGuard],
    loadComponent: () =>
      import('./features/experts/experts.component').then((m) => m.ExpertsComponent)
  },
  { path: '**', redirectTo: 'login' }
];
