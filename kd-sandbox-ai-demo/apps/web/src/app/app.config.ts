import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter, withInMemoryScrolling } from '@angular/router';

import { routes } from './app.routes';
import { endpointLogInterceptor } from './core/interceptors/endpoint-log.interceptor';
import { AppSettingsService } from './core/services/app-settings.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(
      routes,
      withInMemoryScrolling({
        anchorScrolling: 'enabled',
        scrollPositionRestoration: 'enabled'
      })
    ),
    provideHttpClient(withInterceptors([endpointLogInterceptor])),
    provideAppInitializer(() => {
      const settings = inject(AppSettingsService);
      return settings.ready;
    })
  ]
};
