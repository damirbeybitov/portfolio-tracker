import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';
import { ApiService } from '../../../core/services/api.service';
import { Portfolio } from '../../../core/models';

@Component({
  selector: 'app-layout',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="layout">
      <!-- Sidebar -->
      <nav class="sidebar" [class.collapsed]="sidebarCollapsed()">
        <div class="sidebar-header">
          <div class="logo">
            <div class="logo-mark">P</div>
            @if (!sidebarCollapsed()) {
              <span class="logo-text">Portfolio</span>
            }
          </div>
          <button class="btn btn-ghost collapse-btn" (click)="toggleSidebar()">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="nav-section">
          @if (!sidebarCollapsed()) {
            <div class="nav-label">Overview</div>
          }
          <a routerLink="/dashboard" routerLinkActive="active" class="nav-item" title="Dashboard">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
              <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
            </svg>
            @if (!sidebarCollapsed()) { <span>Dashboard</span> }
          </a>
        </div>

        @if (portfolios().length > 0) {
          <div class="nav-section">
            @if (!sidebarCollapsed()) {
              <div class="nav-label">Portfolios</div>
            }
            @for (p of portfolios(); track p.id) {
              <a [routerLink]="['/portfolio', p.id]" routerLinkActive="active" class="nav-item portfolio-item" [title]="p.name">
                <div class="portfolio-dot"></div>
                @if (!sidebarCollapsed()) {
                  <span>{{ p.name }}</span>
                }
              </a>
            }
          </div>
        }

        <div class="nav-section">
          @if (!sidebarCollapsed()) {
            <div class="nav-label">Finance</div>
          }
          <a routerLink="/bank" routerLinkActive="active" class="nav-item" title="Bank Accounts">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/>
              <line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/>
            </svg>
            @if (!sidebarCollapsed()) { <span>Bank Accounts</span> }
          </a>
        </div>

        <div class="sidebar-footer">
          <div class="user-info" [class.compact]="sidebarCollapsed()">
            <div class="user-avatar">{{ userInitial() }}</div>
            @if (!sidebarCollapsed()) {
              <div class="user-details">
                <div class="user-name">{{ currentUser()?.username }}</div>
                <div class="user-email">{{ currentUser()?.email }}</div>
              </div>
            }
          </div>
          <button class="btn btn-ghost logout-btn" (click)="logout()" title="Sign out">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </button>
        </div>
      </nav>

      <!-- Main content -->
      <main class="main-content">
        <router-outlet />
      </main>
    </div>
  `,
  styles: [`
    .layout {
      display: flex;
      min-height: 100vh;
    }

    .sidebar {
      width: var(--nav-width);
      min-height: 100vh;
      background: var(--bg-surface);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      position: sticky;
      top: 0;
      height: 100vh;
      overflow-y: auto;
      overflow-x: hidden;
      transition: width var(--transition);
      flex-shrink: 0;

      &.collapsed {
        width: 64px;
      }
    }

    .sidebar-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 16px;
      border-bottom: 1px solid var(--border);
      gap: 8px;
      min-height: 72px;
    }

    .logo {
      display: flex;
      align-items: center;
      gap: 10px;
      overflow: hidden;

      .logo-mark {
        width: 32px; height: 32px;
        background: var(--accent);
        border-radius: 9px;
        display: flex; align-items: center; justify-content: center;
        font-family: var(--font-display);
        font-size: 18px; font-weight: 800;
        color: var(--text-inverse);
        flex-shrink: 0;
      }

      .logo-text {
        font-family: var(--font-display);
        font-size: 16px; font-weight: 700;
        white-space: nowrap;
      }
    }

    .collapse-btn {
      padding: 6px; flex-shrink: 0;
      border-radius: 6px;
    }

    .nav-section {
      padding: 12px 8px;
      border-bottom: 1px solid var(--border);
    }

    .nav-label {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-muted);
      padding: 4px 10px 8px;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 10px;
      border-radius: var(--radius-sm);
      color: var(--text-secondary);
      text-decoration: none;
      font-size: 13px;
      font-weight: 500;
      transition: all var(--transition);
      white-space: nowrap;
      overflow: hidden;

      svg { flex-shrink: 0; }

      &:hover {
        color: var(--text-primary);
        background: var(--bg-elevated);
      }

      &.active {
        color: var(--accent);
        background: var(--accent-dim);
      }
    }

    .portfolio-item .portfolio-dot {
      width: 8px; height: 8px;
      border-radius: 50%;
      background: var(--accent);
      opacity: 0.5;
      flex-shrink: 0;
    }
    .portfolio-item.active .portfolio-dot { opacity: 1; }

    .sidebar-footer {
      margin-top: auto;
      padding: 16px 8px;
      border-top: 1px solid var(--border);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      overflow: hidden;
      min-width: 0;
    }

    .user-avatar {
      width: 32px; height: 32px;
      border-radius: 50%;
      background: var(--bg-overlay);
      border: 1px solid var(--border-active);
      display: flex; align-items: center; justify-content: center;
      font-size: 13px; font-weight: 600;
      color: var(--text-primary);
      flex-shrink: 0;
    }

    .user-details {
      overflow: hidden;
      .user-name { font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .user-email { font-size: 11px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    }

    .logout-btn { padding: 6px; flex-shrink: 0; }

    .main-content {
      flex: 1;
      min-width: 0;
      overflow-x: hidden;
    }
  `]
})
export class LayoutComponent {
  sidebarCollapsed = signal(false);
  portfolios = signal<Portfolio[]>([]);
  currentUser = computed(() => this.auth.currentUser());
  userInitial = computed(() => {
    const u = this.auth.currentUser();
    return u?.username?.[0]?.toUpperCase() ?? 'U';
  });

  constructor(private auth: AuthService, private api: ApiService, private router: Router) {
    this.loadPortfolios();
  }

  loadPortfolios(): void {
    this.api.listPortfolios().subscribe({
      next: (p) => this.portfolios.set(p)
    });
  }

  toggleSidebar(): void {
    this.sidebarCollapsed.update(v => !v);
  }

  logout(): void {
    this.auth.logout();
  }
}
