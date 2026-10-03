import { Component, inject } from '@angular/core';
import { BrandingService } from '../../../core/services/branding.service';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.scss'
})
export class FooterComponent {
  private readonly branding = inject(BrandingService);
  readonly primary = this.branding.footerPrimaryResolved;
  readonly powered = this.branding.footerPowered;
}
