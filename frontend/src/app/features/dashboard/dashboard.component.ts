import { Component, OnInit, signal, computed, AfterViewInit, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { Portfolio, PortfolioSummary, BankAccount, OverallSummary } from '../../core/models';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Dashboard</h1>
          <p class="page-subtitle">{{ today }}</p>
        </div>
        <button class="btn btn-primary" (click)="showCreatePortfolio = true">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          New Portfolio
        </button>
      </div>

      @if (loading()) {
        <div class="loading-overlay">
          <div class="spinner-ring"></div>
          <span>Loading your data...</span>
        </div>
      } @else {
        <!-- Grand total hero card -->
        <div class="hero-card card" style="margin-bottom:24px">
          <div class="hero-inner">
            <div class="hero-left">
              <div class="hero-label">Total Net Worth</div>
              <div class="hero-value num">
                {{ grandTotalUsd() | currency:'USD':'symbol':'1.2-2' }}
              </div>
              <div class="hero-kzt num">₸ {{ grandTotalKzt() | number:'1.0-0' }}</div>
            </div>
            <div class="hero-right">
              <div class="hero-stat">
                <span class="hs-label">Portfolio</span>
                <span class="hs-val num">{{ totalPortfolioUsd() | currency:'USD':'symbol':'1.0-0' }}</span>
              </div>
              <div class="hero-divider"></div>
              <div class="hero-stat">
                <span class="hs-label">Bank (USD equiv.)</span>
                <span class="hs-val num">{{ totalBankUsdEquiv() | currency:'USD':'symbol':'1.0-0' }}</span>
              </div>
              <div class="hero-divider"></div>
              <div class="hero-stat">
                <span class="hs-label">All-time P&L</span>
                <span class="hs-val num" [class.profit]="totalProfitUsd() >= 0" [class.loss]="totalProfitUsd() < 0">
                  {{ totalProfitUsd() >= 0 ? '+' : '' }}{{ totalProfitUsd() | currency:'USD':'symbol':'1.0-0' }}
                  <span class="pct-badge" [class.profit]="totalProfitPct() >= 0" [class.loss]="totalProfitPct() < 0">
                    {{ totalProfitPct() >= 0 ? '+' : '' }}{{ totalProfitPct() | number:'1.1-1' }}%
                  </span>
                </span>
              </div>
              <div class="hero-divider"></div>
              <div class="hero-stat">
                <span class="hs-label">USD / KZT</span>
                <span class="hs-val num">
                  {{ fxRate() | number:'1.2-2' }}
                  <span class="live-dot"></span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Portfolios section -->
        <div class="section-header">
          <h2 class="section-title">Portfolios</h2>
          <button class="btn btn-ghost btn-sm" (click)="refreshAll()">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
            Refresh
          </button>
        </div>

        @if (portfolios().length === 0) {
          <div class="card empty-state" style="margin-bottom:24px">
            <div class="empty-icon">📊</div>
            <div class="empty-title">No portfolios yet</div>
            <div class="empty-desc">Create your first portfolio to start tracking investments</div>
            <button class="btn btn-primary mt-4" (click)="showCreatePortfolio = true">Create Portfolio</button>
          </div>
        } @else {
          <div class="portfolio-grid" style="margin-bottom:32px">
            @for (p of portfolios(); track p.id) {
              @if (summaries()[p.id]; as s) {
                <div class="pcard card" [class.profit]="s.total_profit_usd >= 0" [class.loss]="s.total_profit_usd < 0">
                  <div class="pcard-head">
                    <div>
                      <div class="pcard-name">{{ p.name }}</div>
                      <div class="pcard-positions">{{ s.positions.length }} position{{ s.positions.length !== 1 ? 's' : '' }}</div>
                    </div>
                    <span class="badge badge-muted">{{ p.currency }}</span>
                  </div>

                  <div class="pcard-value num">{{ s.total_value_usd | currency:'USD':'symbol':'1.2-2' }}</div>
                  <div class="pcard-kzt num">₸ {{ s.total_value_kzt | number:'1.0-0' }}</div>

                  <div class="pcard-pnl">
                    <span class="pnl-amount num" [class.profit]="s.total_profit_usd >= 0" [class.loss]="s.total_profit_usd < 0">
                      {{ s.total_profit_usd >= 0 ? '+' : '' }}{{ s.total_profit_usd | currency:'USD':'symbol':'1.2-2' }}
                    </span>
                    <span class="pnl-pct" [class.profit]="s.total_profit_percent >= 0" [class.loss]="s.total_profit_percent < 0">
                      {{ s.total_profit_percent >= 0 ? '+' : '' }}{{ s.total_profit_percent | number:'1.2-2' }}%
                    </span>
                  </div>

                  <!-- Mini positions bar -->
                  @if (s.positions.length > 0) {
                    <div class="positions-bar">
                      @for (pos of getTopPositions(s); track pos.security.ticker) {
                        <div
                          class="pos-segment"
                          [style.width.%]="getPositionWeight(pos, s)"
                          [title]="pos.security.ticker + ': ' + getPositionWeight(pos, s).toFixed(1) + '%'"
                          [style.background]="getTickerColor(pos.security.ticker)"
                        ></div>
                      }
                    </div>
                    <div class="positions-legend">
                      @for (pos of getTopPositions(s); track pos.security.ticker) {
                        <div class="legend-item">
                          <span class="legend-dot" [style.background]="getTickerColor(pos.security.ticker)"></span>
                          <span class="legend-tick">{{ pos.security.ticker }}</span>
                          <span class="legend-pct num">{{ getPositionWeight(pos, s).toFixed(0) }}%</span>
                        </div>
                      }
                    </div>
                  }

                  <div class="pcard-actions">
                    <a [routerLink]="['/analytics', p.id]" class="btn btn-ghost btn-sm">Analytics</a>
                    <a [routerLink]="['/portfolio', p.id]" class="btn btn-secondary btn-sm">View →</a>
                  </div>
                </div>
              } @else {
                <div class="pcard card loading-card">
                  <div class="pcard-name">{{ p.name }}</div>
                  <div class="spinner" style="margin:20px 0"></div>
                </div>
              }
            }

            <!-- Add portfolio card -->
            <div class="pcard card add-card" (click)="showCreatePortfolio = true">
              <div class="add-icon">+</div>
              <div class="add-label">New Portfolio</div>
            </div>
          </div>
        }

        <!-- Bank accounts -->
        @if (bankAccounts().length > 0) {
          <div class="section-header">
            <h2 class="section-title">Bank Accounts</h2>
            <a routerLink="/bank" class="btn btn-ghost btn-sm">View all →</a>
          </div>
          <div class="bank-grid">
            @for (acc of bankAccounts(); track acc.id) {
              <a routerLink="/bank" class="bcard card">
                <div class="bcard-head">
                  <div class="bcard-icon" [class.kzt]="acc.currency==='KZT'" [class.usd]="acc.currency==='USD'">
                    {{ acc.currency === 'USD' ? '$' : '₸' }}
                  </div>
                  <div>
                    <div class="bcard-name">{{ acc.name }}</div>
                    @if (!acc.is_active) {
                      <span class="badge badge-muted" style="font-size:10px">Inactive</span>
                    }
                  </div>
                </div>
                <div class="bcard-balance num">
                  {{ acc.currency === 'USD' ? '$' : '₸' }}{{ acc.balance | number:'1.2-2' }}
                </div>
                @if (acc.current_rate) {
                  <div class="bcard-rate">
                    <svg width="10" height="10" fill="none" stroke="var(--green)" stroke-width="2.5" viewBox="0 0 24 24">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                    </svg>
                    {{ acc.current_rate }}% p.a.
                  </div>
                }
              </a>
            }
            <a routerLink="/bank" class="bcard card add-card-sm">
              <span>+ Add Account</span>
            </a>
          </div>
        } @else if (!loading()) {
          <div class="section-header">
            <h2 class="section-title">Bank Accounts</h2>
          </div>
          <div class="card empty-state" style="padding:40px">
            <div class="empty-icon">🏦</div>
            <div class="empty-title">No bank accounts</div>
            <div class="empty-desc">Track KZT and USD deposits with interest rates</div>
            <a routerLink="/bank" class="btn btn-secondary mt-4">Add Bank Account</a>
          </div>
        }
      }
    </div>

    <!-- Create Portfolio Modal -->
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
              <input type="text" class="form-control" [(ngModel)]="newPortfolio.name"
                placeholder="e.g. US Stocks" autofocus>
            </div>
            <div class="form-group">
              <label>Description (optional)</label>
              <input type="text" class="form-control" [(ngModel)]="newPortfolio.description"
                placeholder="Long-term growth portfolio">
            </div>
            <div class="form-group">
              <label>Base Currency</label>
              <select class="form-control" [(ngModel)]="newPortfolio.currency">
                <option value="USD">USD — US Dollar</option>
                <option value="KZT">KZT — Kazakhstani Tenge</option>
              </select>
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="showCreatePortfolio = false">Cancel</button>
            <button class="btn btn-primary" (click)="createPortfolio()" [disabled]="createLoading">
              @if (createLoading) { <span class="spinner"></span> } @else { Create Portfolio }
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    /* Hero card */
    .hero-card { padding: 28px 32px; margin-bottom: 0; }
    .hero-inner { display: flex; align-items: center; gap: 48px; flex-wrap: wrap; }
    .hero-left {
      flex-shrink: 0;
      .hero-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.7px; color: var(--text-muted); font-weight: 600; margin-bottom: 8px; }
      .hero-value { font-size: 48px; font-weight: 400; letter-spacing: -2px; line-height: 1; color: var(--text-primary); }
      .hero-kzt { font-size: 18px; color: var(--text-secondary); margin-top: 6px; }
    }
    .hero-right { display: flex; align-items: center; gap: 0; flex: 1; flex-wrap: wrap; }
    .hero-divider { width: 1px; height: 36px; background: var(--border); margin: 0 24px; flex-shrink: 0; }
    .hero-stat {
      display: flex; flex-direction: column; gap: 4px;
      .hs-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
      .hs-val { font-size: 18px; font-weight: 500; display: flex; align-items: center; gap: 8px; }
    }
    .pct-badge {
      font-size: 12px; padding: 2px 8px; border-radius: 20px;
      &.profit { background: var(--green-dim); color: var(--green); }
      &.loss { background: var(--red-dim); color: var(--red); }
    }
    .live-dot {
      width: 6px; height: 6px; border-radius: 50%; background: var(--green);
      box-shadow: 0 0 0 0 rgba(74,222,128,0.4);
      animation: pulse 2s infinite;
      display: inline-block;
    }

    /* Section header */
    .section-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
    .section-title { font-family: var(--font-display); font-size: 15px; font-weight: 700; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }

    /* Portfolio grid */
    .portfolio-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }

    .pcard {
      padding: 24px; display: flex; flex-direction: column; gap: 6px;
      cursor: default;
      transition: border-color var(--transition), box-shadow var(--transition);
      &:hover { border-color: var(--border-active); box-shadow: var(--shadow-elevated); }
    }
    .pcard-head { display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 8px; }
    .pcard-name { font-family: var(--font-display); font-size: 15px; font-weight: 700; }
    .pcard-positions { font-size: 11px; color: var(--text-muted); margin-top: 2px; }
    .pcard-value { font-size: 28px; font-weight: 400; letter-spacing: -0.5px; }
    .pcard-kzt { font-size: 13px; color: var(--text-secondary); }
    .pcard-pnl { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
    .pnl-amount { font-size: 14px; font-weight: 600; }
    .pnl-pct { font-size: 12px; padding: 2px 8px; border-radius: 20px;
      &.profit { background: var(--green-dim); color: var(--green); }
      &.loss { background: var(--red-dim); color: var(--red); }
    }

    /* Positions bar */
    .positions-bar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; gap: 1px; margin: 12px 0 6px; background: var(--bg-base); }
    .pos-segment { height: 100%; border-radius: 1px; transition: opacity var(--transition); &:hover { opacity: 0.8; } }
    .positions-legend { display: flex; gap: 12px; flex-wrap: wrap; }
    .legend-item { display: flex; align-items: center; gap: 4px; font-size: 11px; color: var(--text-secondary); }
    .legend-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
    .legend-tick { font-family: var(--font-mono); font-weight: 600; color: var(--text-primary); }
    .legend-pct { color: var(--text-muted); }

    .pcard-actions { display: flex; gap: 8px; margin-top: 12px; padding-top: 16px; border-top: 1px solid var(--border); justify-content: flex-end; }
    .loading-card { align-items: flex-start; min-height: 160px; }

    /* Add card */
    .add-card {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 8px; cursor: pointer; border-style: dashed; min-height: 160px;
      color: var(--text-muted); transition: all var(--transition);
      &:hover { border-color: var(--accent-border); color: var(--accent); background: var(--accent-dim); }
      .add-icon { font-size: 28px; font-weight: 300; }
      .add-label { font-size: 13px; font-weight: 500; }
    }

    /* Bank grid */
    .bank-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
    .bcard {
      padding: 20px; display: flex; flex-direction: column; gap: 8px;
      text-decoration: none; cursor: pointer;
      transition: all var(--transition);
      &:hover { border-color: var(--border-active); box-shadow: var(--shadow-elevated); transform: translateY(-1px); }
    }
    .bcard-head { display: flex; align-items: center; gap: 12px; }
    .bcard-icon {
      width: 36px; height: 36px; border-radius: 10px;
      display: flex; align-items: center; justify-content: center;
      font-family: var(--font-mono); font-size: 16px; font-weight: 700; flex-shrink: 0;
      &.kzt { background: var(--amber-dim); color: var(--amber); }
      &.usd { background: var(--green-dim); color: var(--green); }
    }
    .bcard-name { font-size: 13px; font-weight: 600; }
    .bcard-balance { font-size: 20px; font-weight: 500; letter-spacing: -0.3px; }
    .bcard-rate { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--green); }
    .add-card-sm {
      display: flex; align-items: center; justify-content: center;
      border-style: dashed; cursor: pointer; min-height: 80px;
      color: var(--text-muted); font-size: 13px; text-decoration: none;
      transition: all var(--transition);
      &:hover { border-color: var(--accent-border); color: var(--accent); background: var(--accent-dim); }
    }

    /* Spinner ring variant */
    .spinner-ring {
      width: 36px; height: 36px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @media (max-width: 900px) {
      .hero-inner { gap: 24px; }
      .hero-left .hero-value { font-size: 32px; }
      .hero-right { gap: 0; }
      .hero-divider { margin: 0 16px; }
    }
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

  today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  totalPortfolioUsd = signal(0);
  totalPortfolioKzt = signal(0);
  totalProfitUsd = signal(0);
  totalProfitPct = signal(0);
  totalBankUsdEquiv = signal(0);
  grandTotalUsd = computed(() => this.totalPortfolioUsd() + this.totalBankUsdEquiv());
  grandTotalKzt = computed(() => this.grandTotalUsd() * this.fxRate());

  // Stable color palette for tickers
  private readonly COLORS = [
    '#c8ff47', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa',
    '#34d399', '#facc15', '#f87171', '#38bdf8', '#818cf8',
  ];
  private colorMap: Map<string, string> = new Map();

  constructor(private api: ApiService) {}

  ngOnInit(): void { this.loadAll(); }

  loadAll(): void {
    this.loading.set(true);
    this.api.listPortfolios().subscribe(portfolios => {
      this.portfolios.set(portfolios);
      if (portfolios.length === 0) this.loading.set(false);
      portfolios.forEach(p => this.loadSummary(p.id));
    });
    this.api.listBankAccounts().subscribe(accounts => {
      this.bankAccounts.set(accounts);
      const usdEquiv = accounts.reduce((sum, a) => {
        if (a.currency === 'USD') return sum + +a.balance;
        return sum + (+a.balance / (this.fxRate() || 475));
      }, 0);
      this.totalBankUsdEquiv.set(usdEquiv);
    });
    this.api.getFxRate().subscribe(fx => {
      this.fxRate.set(+fx.usd_to_kzt);
    });
    setTimeout(() => this.loading.set(false), 1200);
  }

  refreshAll(): void { this.loadAll(); }

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
    if (!this.newPortfolio.name.trim()) return;
    this.createLoading = true; this.createError = '';
    this.api.createPortfolio(this.newPortfolio).subscribe({
      next: (p) => {
        this.portfolios.update(prev => [...prev, p]);
        this.showCreatePortfolio = false; this.createLoading = false;
        this.newPortfolio = { name: '', description: '', currency: 'USD' };
        this.loadSummary(p.id);
      },
      error: (e) => {
        this.createError = e.error?.detail || 'Failed to create portfolio';
        this.createLoading = false;
      }
    });
  }

  getTickerColor(ticker: string): string {
    if (!this.colorMap.has(ticker)) {
      const idx = this.colorMap.size % this.COLORS.length;
      this.colorMap.set(ticker, this.COLORS[idx]);
    }
    return this.colorMap.get(ticker)!;
  }

  getTopPositions(summary: PortfolioSummary, limit = 5) {
    return [...summary.positions]
      .sort((a, b) => (+b.current_value_usd! || 0) - (+a.current_value_usd! || 0))
      .slice(0, limit);
  }

  getPositionWeight(pos: any, summary: PortfolioSummary): number {
    const total = +summary.total_value_usd || 1;
    const val = +(pos.current_value_usd || pos.total_invested_usd) || 0;
    return Math.min((val / total) * 100, 100);
  }
}
