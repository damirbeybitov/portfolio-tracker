import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import { UserSettings } from '../../core/models';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Settings</h1>
          <p class="page-subtitle">Preferences for how data is displayed</p>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-overlay"><div class="spinner"></div><span>Loading settings...</span></div>
      } @else {
        @if (error()) {
          <div class="alert alert-error" style="margin-bottom:20px">{{ error() }}</div>
        }
        @if (saved()) {
          <div class="alert alert-success" style="margin-bottom:20px">Settings saved.</div>
        }

        <div class="card">
          <div class="card-header">
            <h2>Bank Accounts</h2>
          </div>
          <div class="modal-body">
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Hide inactive bank accounts</div>
                <div class="setting-desc">
                  When enabled, accounts you've deleted (soft-deleted, marked inactive)
                  will no longer appear on the Dashboard or Bank Accounts page.
                </div>
              </div>
              <button
                type="button"
                class="toggle"
                [class.on]="settings().hide_inactive_bank_accounts"
                [disabled]="saving()"
                (click)="toggleHideInactive()"
                role="switch"
                [attr.aria-checked]="settings().hide_inactive_bank_accounts"
              >
                <span class="toggle-knob"></span>
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .card-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 18px 20px; border-bottom: 1px solid var(--border);
      h2 { font-family: var(--font-display); font-size: 15px; }
    }

    .setting-row {
      display: flex; align-items: flex-start; justify-content: space-between;
      gap: 24px;
    }

    .setting-info {
      display: flex; flex-direction: column; gap: 6px;
      max-width: 480px;
    }

    .setting-label {
      font-size: 14px;
      font-weight: 600;
      color: var(--text-primary);
    }

    .setting-desc {
      font-size: 12px;
      color: var(--text-secondary);
      line-height: 1.6;
    }

    /* Toggle switch */
    .toggle {
      flex-shrink: 0;
      width: 44px;
      height: 26px;
      border-radius: 999px;
      border: 1px solid var(--border-active);
      background: var(--bg-base);
      position: relative;
      cursor: pointer;
      transition: background var(--transition), border-color var(--transition);
      padding: 0;
      outline: none;

      &:disabled { opacity: 0.6; cursor: not-allowed; }

      .toggle-knob {
        position: absolute;
        top: 2px; left: 2px;
        width: 20px; height: 20px;
        border-radius: 50%;
        background: var(--text-secondary);
        transition: transform var(--transition), background var(--transition);
      }

      &.on {
        background: var(--accent-dim);
        border-color: var(--accent-border);

        .toggle-knob {
          transform: translateX(18px);
          background: var(--accent);
        }
      }
    }
  `]
})
export class SettingsComponent implements OnInit {
  loading = signal(true);
  saving = signal(false);
  saved = signal(false);
  error = signal('');
  settings = signal<UserSettings>({ hide_inactive_bank_accounts: false });

  private savedTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.getSettings().subscribe({
      next: (s) => { this.settings.set(s); this.loading.set(false); },
      error: (e) => {
        this.error.set(e.error?.detail || 'Failed to load settings.');
        this.loading.set(false);
      }
    });
  }

  toggleHideInactive(): void {
    const next = !this.settings().hide_inactive_bank_accounts;
    this.saving.set(true);
    this.error.set('');
    this.saved.set(false);

    this.api.updateSettings({ hide_inactive_bank_accounts: next }).subscribe({
      next: (s) => {
        this.settings.set(s);
        this.saving.set(false);
        this.saved.set(true);
        if (this.savedTimeout) clearTimeout(this.savedTimeout);
        this.savedTimeout = setTimeout(() => this.saved.set(false), 2000);
      },
      error: (e) => {
        this.error.set(e.error?.detail || 'Failed to update settings.');
        this.saving.set(false);
      }
    });
  }
}
