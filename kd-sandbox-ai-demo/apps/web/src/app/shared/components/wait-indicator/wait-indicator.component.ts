import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-wait-indicator',
  standalone: true,
  template: `
    <div class="kd-wait" role="status" [attr.aria-label]="label">
      <span class="kd-wait__ring" aria-hidden="true"></span>
      <span class="kd-wait__dot" aria-hidden="true"></span>
      @if (label) {
        <p class="kd-wait__label">{{ label }}</p>
      }
    </div>
  `,
  styles: [`
    .kd-wait {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      padding: 1.25rem 0.5rem;
    }
    .kd-wait__ring {
      width: 42px;
      height: 42px;
      box-sizing: border-box;
      border: 3px solid #e2d9c8;
      border-top-color: #0b2c4d;
      border-right-color: #c5a572;
      border-radius: 50%;
      animation: kd-wait-spin 0.85s linear infinite;
    }
    .kd-wait__dot {
      width: 8px;
      height: 8px;
      margin-top: -34px;
      border-radius: 50%;
      background: #c5a572;
      animation: kd-wait-pulse 0.85s ease-in-out infinite;
    }
    .kd-wait__label {
      margin: 0.35rem 0 0;
      font: 600 0.88rem/1.3 Inter, "Segoe UI", Roboto, Arial, sans-serif;
      color: #0b2c4d;
    }
    @keyframes kd-wait-spin {
      to { transform: rotate(360deg); }
    }
    @keyframes kd-wait-pulse {
      0%, 100% { opacity: 0.35; transform: scale(0.85); }
      50% { opacity: 1; transform: scale(1.15); }
    }
  `]
})
export class WaitIndicatorComponent {
  @Input() label = 'Please wait…';
}
