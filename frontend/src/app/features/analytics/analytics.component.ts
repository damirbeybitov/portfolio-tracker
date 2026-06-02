import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { ApiService } from '../../core/services/api.service';
import { PortfolioAnalytics, PeriodPnl, PositionProfit } from '../../core/models';

type Period = '1D' | '1W' | '1M' | '1Y';

@Component({
  selector: 'app-analytics',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <a [routerLink]="['/portfolio', portfolioId]" class="back-link">← Back to Portfolio</a>
          <h1 class="page-title">Analytics</h1>
        </div>
        <button class="btn btn-secondary" (click)="load()">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>

      @if (loading()) {
        <div class="loading-overlay"><div class="spinner"></div><span>Calculating analytics...</span></div>
      } @else if (analytics()) {
        <!-- Period selector + P&L -->
        <div class="period-section card" style="margin-bottom:24px; padding:24px">
          <div class="period-header">
            <h2>Period P&amp;L</h2>
            <div class="tabs">
              @for (p of periods; track p) {
                <button class="tab" [class.active]="selectedPeriod() === p" (click)="selectedPeriod.set(p)">{{ p }}</button>
              }
            </div>
          </div>

          @if (currentPnl(); as pnl) {
            <div class="pnl-display">
              <div class="pnl-main" [class.profit]="pnl.profit_usd >= 0" [class.loss]="pnl.profit_usd < 0">
                <div class="pnl-amount">{{ pnl.profit_usd >= 0 ? '+' : '' }}{{ pnl.profit_usd | currency:'USD':'symbol':'1.2-2' }}</div>
                <div class="pnl-pct">{{ pnl.profit_percent >= 0 ? '+' : '' }}{{ pnl.profit_percent | number:'1.2-2' }}%</div>
              </div>
              <div class="pnl-kzt" [class.profit]="pnl.profit_kzt >= 0" [class.loss]="pnl.profit_kzt < 0">
                {{ pnl.profit_kzt >= 0 ? '+' : '' }}₸ {{ pnl.profit_kzt | number:'1.0-0' }}
              </div>
              <div class="pnl-range">
                <span>Start: {{ pnl.value_start_usd | currency:'USD':'symbol':'1.2-2' }}</span>
                <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
                <span>End: {{ pnl.value_end_usd | currency:'USD':'symbol':'1.2-2' }}</span>
              </div>
            </div>
          }
        </div>

        <!-- All period overview -->
        <div class="grid-4" style="margin-bottom:24px">
          @for (item of periodItems(); track item.period) {
            <div class="card stat-card period-card" [class.active]="selectedPeriod() === item.period" (click)="selectedPeriod.set(item.period)">
              <div class="stat-label">{{ item.period }}</div>
              <div class="stat-value" [class.profit]="item.pnl.profit_usd >= 0" [class.loss]="item.pnl.profit_usd < 0">
                {{ item.pnl.profit_usd >= 0 ? '+' : '' }}{{ item.pnl.profit_usd | currency:'USD':'symbol':'1.2-2' }}
              </div>
              <div class="stat-sub" [class.profit]="item.pnl.profit_percent >= 0" [class.loss]="item.pnl.profit_percent < 0">
                {{ item.pnl.profit_percent >= 0 ? '+' : '' }}{{ item.pnl.profit_percent | number:'1.2-2' }}%
              </div>
            </div>
          }
        </div>

        <!-- Overall summary -->
        <div class="grid-3" style="margin-bottom:24px">
          <div class="card stat-card">
            <div class="stat-label">Total Value</div>
            <div class="stat-value">{{ analytics()!.total_value_usd | currency:'USD':'symbol':'1.2-2' }}</div>
            <div class="stat-sub">₸ {{ analytics()!.total_value_kzt | number:'1.0-0' }}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">Total Invested</div>
            <div class="stat-value">{{ analytics()!.total_invested_usd | currency:'USD':'symbol':'1.2-2' }}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">All-Time P&amp;L</div>
            <div class="stat-value" [class.profit]="analytics()!.total_profit_usd >= 0" [class.loss]="analytics()!.total_profit_usd < 0">
              {{ analytics()!.total_profit_usd >= 0 ? '+' : '' }}{{ analytics()!.total_profit_usd | currency:'USD':'symbol':'1.2-2' }}
            </div>
            <div class="stat-sub" [class.profit]="analytics()!.total_profit_percent >= 0" [class.loss]="analytics()!.total_profit_percent < 0">
              {{ analytics()!.total_profit_percent >= 0 ? '+' : '' }}{{ analytics()!.total_profit_percent | number:'1.2-2' }}%
            </div>
          </div>
        </div>

        <!-- Per-position breakdown -->
        <div class="card">
          <div class="card-header"><h2>Position Breakdown</h2></div>
          @if (analytics()!.positions_profit.length === 0) {
            <div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No positions to analyze</div></div>
          } @else {
            <table class="data-table">
              <thead>
                <tr>
                  <th>Security</th>
                  <th class="num-col">Qty</th>
                  <th class="num-col">Avg Cost</th>
                  <th class="num-col">Current Price</th>
                  <th class="num-col">Market Value</th>
                  <th class="num-col">P&amp;L USD</th>
                  <th class="num-col">P&amp;L KZT</th>
                  <th class="num-col">P&amp;L %</th>
                  <th class="num-col">Weight</th>
                </tr>
              </thead>
              <tbody>
                @for (pos of analytics()!.positions_profit; track pos.ticker) {
                  <tr>
                    <td>
                      <div class="security-info">
                        <span class="ticker">{{ pos.ticker }}</span>
                        <span class="sec-name">{{ pos.name }}</span>
                      </div>
                    </td>
                    <td class="num-col num">{{ pos.quantity | number:'1.0-4' }}</td>
                    <td class="num-col num">{{ pos.avg_cost_usd | currency:'USD':'symbol':'1.2-2' }}</td>
                    <td class="num-col num">{{ pos.current_price_usd | currency:'USD':'symbol':'1.2-2' }}</td>
                    <td class="num-col num">{{ pos.current_value_usd | currency:'USD':'symbol':'1.2-2' }}</td>
                    <td class="num-col num" [class.profit]="pos.profit_usd >= 0" [class.loss]="pos.profit_usd < 0">
                      {{ pos.profit_usd >= 0 ? '+' : '' }}{{ pos.profit_usd | currency:'USD':'symbol':'1.2-2' }}
                    </td>
                    <td class="num-col num" [class.profit]="pos.profit_kzt >= 0" [class.loss]="pos.profit_kzt < 0">
                      {{ pos.profit_kzt >= 0 ? '+' : '' }}₸ {{ pos.profit_kzt | number:'1.0-0' }}
                    </td>
                    <td class="num-col num" [class.profit]="pos.profit_percent >= 0" [class.loss]="pos.profit_percent < 0">
                      {{ pos.profit_percent >= 0 ? '+' : '' }}{{ pos.profit_percent | number:'1.2-2' }}%
                    </td>
                    <td class="num-col">
                      <div class="weight-bar-wrap">
                        <div class="weight-bar" [style.width.%]="getWeight(pos)"></div>
                        <span class="num">{{ getWeight(pos) | number:'1.1-1' }}%</span>
                      </div>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      }
    </div>
  `,
  styles: [`
    .back-link { font-size: 13px; color: var(--text-secondary); text-decoration: none; display: block; margin-bottom: 8px; &:hover { color: var(--accent); } }
    .period-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; h2 { font-family: var(--font-display); font-size: 16px; } }
    .pnl-display { display: flex; flex-direction: column; gap: 6px; }
    .pnl-main { display: flex; align-items: baseline; gap: 16px; .pnl-amount { font-family: var(--font-mono); font-size: 42px; font-weight: 500; letter-spacing: -1px; } .pnl-pct { font-size: 22px; font-weight: 600; } }
    .pnl-kzt { font-family: var(--font-mono); font-size: 18px; color: var(--text-secondary); }
    .pnl-range { display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-size: 13px; margin-top: 8px; }
    .period-card { cursor: pointer; transition: all var(--transition); &:hover { border-color: var(--border-active); } &.active { border-color: var(--accent-border); background: var(--accent-dim); } }
    .card-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--border); h2 { font-family: var(--font-display); font-size: 16px; } }
    .num-col { text-align: right; }
    .security-info { display: flex; flex-direction: column; gap: 2px; .ticker { font-family: var(--font-mono); font-weight: 600; font-size: 13px; } .sec-name { font-size: 11px; color: var(--text-muted); } }
    .weight-bar-wrap { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
    .weight-bar { height: 4px; background: var(--accent); border-radius: 2px; min-width: 2px; max-width: 60px; }
  `]
})
export class AnalyticsComponent implements OnInit {
  portfolioId!: number;
  loading = signal(true);
  analytics = signal<PortfolioAnalytics | null>(null);
  selectedPeriod = signal<Period>('1M');
  periods: Period[] = ['1D', '1W', '1M', '1Y'];

  currentPnl = () => {
    const a = this.analytics();
    if (!a) return null;
    const map: Record<Period, PeriodPnl> = { '1D': a.pnl_1d, '1W': a.pnl_1w, '1M': a.pnl_1m, '1Y': a.pnl_1y };
    return map[this.selectedPeriod()];
  };

  periodItems = () => {
    const a = this.analytics();
    if (!a) return [];
    return [
      { period: '1D' as Period, pnl: a.pnl_1d },
      { period: '1W' as Period, pnl: a.pnl_1w },
      { period: '1M' as Period, pnl: a.pnl_1m },
      { period: '1Y' as Period, pnl: a.pnl_1y },
    ];
  };

  constructor(private route: ActivatedRoute, private api: ApiService) {}

  ngOnInit(): void {
    this.portfolioId = +this.route.snapshot.paramMap.get('id')!;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.getPortfolioAnalytics(this.portfolioId).subscribe({
      next: (a) => { this.analytics.set(a); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  getWeight(pos: PositionProfit): number {
    const total = this.analytics()?.total_value_usd || 0;
    if (!total) return 0;
    return Math.min((pos.current_value_usd / total) * 100, 100);
  }
}
