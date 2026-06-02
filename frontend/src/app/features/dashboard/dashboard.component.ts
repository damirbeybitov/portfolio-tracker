import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { Portfolio, PortfolioSummary, BankAccount } from '../../core/models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">Your financial overview</p>
        </div>
        <button class="btn btn-primary" (click)="showCreatePortfolio = true">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          New Portfolio
        </button>
      </div>

      @if (loading()) {
        <div class="loading-overlay"><div class="spinner"></div><span>Loading your data...</span></div>
      } @else {
        <div class="grid-4" style="margin-bottom:24px">
          <div class="card stat-card">
            <div class="stat-label">Total Portfolio Value</div>
            <div class="stat-value">{{ totalPortfolioUsd() | currency:'USD':'symbol':'1.2-2' }}</div>
            <div class="stat-sub">₸ {{ totalPortfolioKzt() | number:'1.0-0' }}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">Total P&amp;L</div>
            <div class="stat-value" [class.profit]="totalProfitUsd() >= 0" [class.loss]="totalProfitUsd() < 0">
              {{ totalProfitUsd() >= 0 ? '+' : '' }}{{ totalProfitUsd() | currency:'USD':'symbol':'1.2-2' }}
            </div>
            <div class="stat-sub" [class.profit]="totalProfitPct() >= 0" [class.loss]="totalProfitPct() < 0">
              {{ totalProfitPct() >= 0 ? '+' : '' }}{{ totalProfitPct() | number:'1.2-2' }}%
            </div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">Bank Total</div>
            <div class="stat-value">{{ totalBankUsd() | currency:'USD':'symbol':'1.2-2' }}</div>
            <div class="stat-sub">₸ {{ totalBankKzt() | number:'1.0-0' }}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">FX Rate USD/KZT</div>
            <div class="stat-value num">{{ fxRate() | number:'1.2-2' }}</div>
            <div class="stat-sub flex items-center gap-2">
              <span class="pulse-dot"></span> Live rate
            </div>
          </div>
        </div>

        <div style="margin-bottom:24px">
          <h2 style="font-size:16px; margin-bottom:16px; font-family:var(--font-display)">Portfolios</h2>
          @if (portfolios().length === 0) {
            <div class="card empty-state">
              <div class="empty-icon">📊</div>
              <div class="empty-title">No portfolios yet</div>
              <div class="empty-desc">Create your first portfolio to start tracking investments</div>
              <button class="btn btn-primary mt-4" (click)="showCreatePortfolio = true">Create Portfolio</button>
            </div>
          } @else {
            <div class="grid-3">
              @for (p of portfolios(); track p.id) {
                @if (summaries()[p.id]; as s) {
                  <div class="card portfolio-card">
                    <div class="pc-header">
                      <div class="pc-name">{{ p.name }}</div>
                      <span class="badge badge-muted">{{ p.currency }}</span>
                    </div>
                    <div class="pc-value num">{{ s.total_value_usd | currency:'USD':'symbol':'1.2-2' }}</div>
                    <div class="pc-kzt num">₸ {{ s.total_value_kzt | number:'1.0-0' }}</div>
                    <div class="pc-pnl" [class.profit]="s.total_profit_usd >= 0" [class.loss]="s.total_profit_usd < 0">
                      {{ s.total_profit_usd >= 0 ? '+' : '' }}{{ s.total_profit_usd | currency:'USD':'symbol':'1.2-2' }}
                      <span class="pct">({{ s.total_profit_percent >= 0 ? '+' : '' }}{{ s.total_profit_percent | number:'1.2-2' }}%)</span>
                    </div>
                    <div class="pc-footer">
                      <span class="pos-count">{{ s.positions.length }} positions</span>
                      <div class="pc-actions">
                        <a [routerLink]="['/analytics', p.id]" class="btn btn-ghost btn-sm">Analytics</a>
                        <a [routerLink]="['/portfolio', p.id]" class="btn btn-secondary btn-sm">View</a>
                      </div>
                    </div>
                  </div>
                } @else {
                  <div class="card portfolio-card loading-card">
                    <div class="pc-name">{{ p.name }}</div>
                    <div class="spinner" style="margin:16px 0"></div>
                  </div>
                }
              }
            </div>
          }
        </div>

        @if (bankAccounts().length > 0) {
          <div>
            <div class="flex items-center justify-between" style="margin-bottom:16px">
              <h2 style="font-size:16px; font-family:var(--font-display)">Bank Accounts</h2>
              <a routerLink="/bank" class="btn btn-ghost btn-sm">View all →</a>
            </div>
            <div class="grid-3">
              @for (acc of bankAccounts(); track acc.id) {
                <div class="card bank-card">
                  <div class="bc-header">
                    <div class="bc-name">{{ acc.name }}</div>
                    <span class="badge" [class.badge-blue]="acc.currency==='USD'" [class.badge-amber]="acc.currency==='KZT'">
                      {{ acc.currency }}
                    </span>
                  </div>
                  <div class="bc-balance num">
                    {{ acc.currency === 'USD' ? '$' : '₸' }}{{ acc.balance | number:'1.2-2' }}
                  </div>
                  @if (acc.current_rate) {
                    <div class="bc-rate">
                      {{ acc.current_rate }}% p.a.
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        }
      }
    </div>

    @if (showCreatePortfolio) {
      <div class="modal-backdrop" (click)="showCreatePortfolio = false">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>New Portfolio</h3>
            <button class="btn btn-ghost btn-sm" (click)="showCreatePortfolio = false">✕</button>
          </div>
          <div class="modal-body">
            @if (createError) {
              <div class="alert alert-error">{{ createError }}</div>
            }
            <div class="form-group">
              <label>Name</label>
              <input type="text" class="form-control" [(ngModel)]="newPortfolio.name" placeholder="My Portfolio">
            </div>
            <div class="form-group">
              <label>Description (optional)</label>
              <input type="text" class="form-control" [(ngModel)]="newPortfolio.description">
            </div>
            <div class="form-group">
              <label>Base Currency</label>
              <select class="form-control" [(ngModel)]="newPortfolio.currency">
                <option value="USD">USD</option>
                <option value="KZT">KZT</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="showCreatePortfolio = false">Cancel</button>
            <button class="btn btn-primary" (click)="createPortfolio()" [disabled]="createLoading">
              @if (createLoading) { <span class="spinner"></span> } @else { Create }
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .portfolio-card { padding: 24px; display: flex; flex-direction: column; gap: 6px; transition: box-shadow var(--transition), border-color var(--transition); &:hover { border-color: var(--border-active); box-shadow: var(--shadow-elevated); } }
    .pc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
    .pc-name { font-family: var(--font-display); font-size: 15px; font-weight: 700; }
    .pc-value { font-size: 26px; font-weight: 500; letter-spacing: -0.5px; }
    .pc-kzt { font-size: 13px; color: var(--text-secondary); }
    .pc-pnl { font-size: 14px; font-weight: 600; margin-top: 4px; .pct { font-size: 12px; opacity: 0.8; } }
    .pc-footer { display: flex; align-items: center; justify-content: space-between; margin-top: 16px; border-top: 1px solid var(--border); padding-top: 16px; }
    .pos-count { font-size: 12px; color: var(--text-muted); }
    .pc-actions { display: flex; gap: 8px; }
    .loading-card { align-items: flex-start; }
    .bank-card { padding: 20px; display: flex; flex-direction: column; gap: 6px; }
    .bc-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
    .bc-name { font-weight: 600; font-size: 14px; }
    .bc-balance { font-size: 22px; font-weight: 500; }
    .bc-rate { font-size: 12px; color: var(--green); margin-top: 4px; }
  `]
})
export class DashboardComponent implements OnInit {
  loading = signal(true);
  portfolios = signal<Portfolio[]>([]);
  summaries = signal<Record<number, PortfolioSummary>>({});
  bankAccounts = signal<BankAccount[]>([]);
  fxRate = signal(0);
  showCreatePortfolio = false;
  createLoading = false;
  createError = '';
  newPortfolio = { name: '', description: '', currency: 'USD' };
  totalPortfolioUsd = signal(0);
  totalPortfolioKzt = signal(0);
  totalProfitUsd = signal(0);
  totalProfitPct = signal(0);
  totalBankUsd = signal(0);
  totalBankKzt = signal(0);

  constructor(private api: ApiService) {}

  ngOnInit(): void { this.loadAll(); }

  loadAll(): void {
    this.loading.set(true);
    this.api.listPortfolios().subscribe(portfolios => {
      this.portfolios.set(portfolios);
      portfolios.forEach(p => this.loadSummary(p.id));
      if (portfolios.length === 0) this.loading.set(false);
    });
    this.api.listBankAccounts().subscribe(accounts => {
      this.bankAccounts.set(accounts);
      let usd = 0, kzt = 0;
      accounts.forEach(a => { if (a.currency === 'USD') usd += +a.balance; else kzt += +a.balance; });
      this.totalBankUsd.set(usd); this.totalBankKzt.set(kzt);
    });
    this.api.getFxRate().subscribe(fx => this.fxRate.set(+fx.usd_to_kzt));
    setTimeout(() => this.loading.set(false), 800);
  }

  loadSummary(portfolioId: number): void {
    this.api.getPortfolioSummary(portfolioId).subscribe(s => {
      this.summaries.update(prev => ({ ...prev, [portfolioId]: s }));
      this.recalcTotals();
    });
  }

  recalcTotals(): void {
    const sums = Object.values(this.summaries());
    const totalV = sums.reduce((a, s) => a + +s.total_value_usd, 0);
    const totalI = sums.reduce((a, s) => a + +s.total_invested_usd, 0);
    const totalP = totalV - totalI;
    this.totalPortfolioUsd.set(totalV);
    this.totalPortfolioKzt.set(sums.reduce((a, s) => a + +s.total_value_kzt, 0));
    this.totalProfitUsd.set(totalP);
    this.totalProfitPct.set(totalI > 0 ? (totalP / totalI * 100) : 0);
  }

  createPortfolio(): void {
    if (!this.newPortfolio.name) return;
    this.createLoading = true; this.createError = '';
    this.api.createPortfolio(this.newPortfolio).subscribe({
      next: (p) => {
        this.portfolios.update(prev => [...prev, p]);
        this.showCreatePortfolio = false; this.createLoading = false;
        this.newPortfolio = { name: '', description: '', currency: 'USD' };
        this.loadSummary(p.id);
      },
      error: (e) => { this.createError = e.error?.detail || 'Failed to create portfolio'; this.createLoading = false; }
    });
  }
}
