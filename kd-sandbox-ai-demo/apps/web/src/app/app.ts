import { Component, inject } from '@angular/core';
import { I18nService } from './core/i18n/i18n.service';
import { ThemeService } from './core/services/theme.service';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './shared/components/header/header.component';
import { FooterComponent } from './shared/components/footer/footer.component';
import { SettingsPanelComponent } from './features/settings/settings-panel.component';
import { NifiAiModalComponent } from './shared/components/nifi-ai-modal/nifi-ai-modal.component';
import { IdleTimeoutService } from './core/services/idle-timeout.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, HeaderComponent, FooterComponent, SettingsPanelComponent, NifiAiModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  /** Eager-init so <html dir/lang> and theme vars apply on load. */
  private readonly _i18n = inject(I18nService);
  private readonly _theme = inject(ThemeService);
  private readonly _idle = inject(IdleTimeoutService);

  constructor() {
    this._idle.start();
  }
}
