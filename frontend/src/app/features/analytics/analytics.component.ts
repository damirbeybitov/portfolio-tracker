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
          <p class="page-subtitle">Performance breakdown</p>
        </div>
        <button class="btn btn-secondary" (click)="load()">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
          Refresh
        </button>
      </div>

      @if (loading()) {
        <div class="loading-overlay"><div class="spinner"></div><span>Calculating analytics...</span></div>
      } @else if (analytics()) {

        <!-- Period P&L main card -->
        <div class="pnl-card card" style="margin-bottom:24px">
          <!-- Period tabs -->
          <div class="period-tabs">
            @for (p of periods; track p) {
              <button class="period-tab" [class.active]="selectedPeriod() === p" (click)="selectedPeriod.set(p)">
                {{ p }}
              </button>
            }
          </div>

          @if (currentPnl(); as pnl) {
            <div class="pnl-body">
              <div class="pnl-main">
                <div class="pnl-amount num" [class.profit]="pnl.profit_usd >= 0" [class.loss]="pnl.profit_usd < 0">
                  {{ pnl.profit_usd >= 0 ? '+' : '' }}{{ pnl.profit_usd | currency:'USD':'symbol':'1.2-2' }}
                </div>
                <div class="pnl-pct num" [class.profit]="pnl.profit_percent >= 0" [class.loss]="pnl.profit_percent < 0">
                  {{ pnl.profit_percent >= 0 ? '+' : '' }}{{ pnl.profit_percent | number:'1.2-2' }}%
                </div>
              </div>
              <div class="pnl-kzt num" [class.profit]="pnl.profit_kzt >= 0" [class.loss]="pnl.profit_kzt < 0">
                {{ pnl.profit_kzt >= 0 ? '+' : '' }}₸ {{ pnl.profit_kzt | number:'1.0-0' }}
              </div>
              <div class="pnl-range">
                <div class="range-item">
                  <span class="range-label">Start</span>
                  <span class="range-val num">{{ pnl.value_start_usd | currency:'USD':'symbol':'1.2-2' }}</span>
                </div>
                <div class="range-arrow">
                  <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                    <line x1="4" y1="12" x2="20" y2="12"/>
                    <polyline points="14 6 20 12 14 18"/>
                  </svg>
                </div>
                <div class="range-item">
                  <span class="range-label">End</span>
                  <span class="range-val num">{{ pnl.value_end_usd | currency:'USD':'symbol':'1.2-2' }}</span>
                </div>
              </div>
            </div>
          }
        </div>

        <!-- 4 period cards -->
        <div class="grid-4" style="margin-bottom:24px">
          @for (item of periodItems(); track item.period) {
            <div class="period-mini-card card" [class.active]="selectedPeriod() === item.period"
              (click)="selectedPeriod.set(item.period)">
              <div class="pmc-period">{{ item.period }}</div>
              <div class="pmc-val num" [class.profit]="item.pnl.profit_usd >= 0" [class.loss]="item.pnl.profit_usd < 0">
                {{ item.pnl.profit_usd >= 0 ? '+' : '' }}{{ item.pnl.profit_usd | currency:'USD':'symbol':'1.0-0' }}
              </div>
              <div class="pmc-pct num" [class.profit]="item.pnl.profit_percent >= 0" [class.loss]="item.pnl.profit_percent < 0">
                {{ item.pnl.profit_percent >= 0 ? '+' : '' }}{{ item.pnl.profit_percent | number:'1.2-2' }}%
              </div>
              <!-- Mini spark bar -->
              <div class="spark-bar">
                <div class="spark-fill"
                  [style.width.%]="getSparkWidth(item.pnl)"
                  [class.profit]="item.pnl.profit_usd >= 0"
                  [class.loss]="item.pnl.profit_usd < 0">
                </div>
              </div>
            </div>
          }
        </div>

        <!-- Overall snapshot -->
        <div class="grid-3" style="margin-bottom:24px">
          <div class="card stat-card">
            <div class="stat-label">Current Value</div>
            <div class="stat-value">{{ analytics()!.total_value_usd | currency:'USD':'symbol':'1.2-2' }}</div>
            <div class="stat-sub">₸ {{ analytics()!.total_value_kzt | number:'1.0-0' }}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">Cost Basis</div>
            <div class="stat-value">{{ analytics()!.total_invested_usd | currency:'USD':'symbol':'1.2-2' }}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">All-Time P&L</div>
            <div class="stat-value" [class.profit]="analytics()!.total_profit_usd >= 0" [class.loss]="analytics()!.total_profit_usd < 0">
              {{ analytics()!.total_profit_usd >= 0 ? '+' : '' }}{{ analytics()!.total_profit_usd | currency:'USD':'symbol':'1.2-2' }}
            </div>
            <div class="stat-sub" [class.profit]="analytics()!.total_profit_percent >= 0" [class.loss]="analytics()!.total_profit_percent < 0">
              {{ analytics()!.total_profit_percent >= 0 ? '+' : '' }}{{ analytics()!.total_profit_percent | number:'1.2-2' }}%
            </div>
          </div>
        </div>

        <!-- Position breakdown table -->
        <div class="card">
          <div class="pos-table-header">
            <h2>Position Breakdown</h2>
            <span class="fx-note text-muted">FX: {{ analytics()!.fx_rate | number:'1.2-2' }} KZT/USD</span>
          </div>

          @if (analytics()!.positions_profit.length === 0) {
            <div class="empty-state"><div class="empty-icon">📊</div><div class="empty-title">No positions</div></div>
          } @else {
            <!-- Portfolio composition bar -->
            <div class="composition-bar">
              @for (pos of analytics()!.positions_profit; track pos.ticker) {
                <div class="comp-seg"
                  [style.width.%]="getWeight(pos)"
                  [style.background]="getTickerColor(pos.ticker)"
                  [title]="pos.ticker + ': ' + getWeight(pos).toFixed(1) + '%'">
                </div>
              }
            </div>
            <div class="comp-legend">
              @for (pos of analytics()!.positions_profit; track pos.ticker) {
                <div class="comp-leg-item">
                  <span class="comp-dot" [style.background]="getTickerColor(pos.ticker)"></span>
                  <span class="comp-tick mono">{{ pos.ticker }}</span>
                  <span class="comp-pct">{{ getWeight(pos).toFixed(0) }}%</span>
                </div>
              }
            </div>

            <table class="data-table">
              <thead>
                <tr>
                  <th>Security</th>
                  <th class="num-col">Qty</th>
                  <th class="num-col">Avg Cost</th>
                  <th class="num-col">Current</th>
                  <th class="num-col">Value (USD)</th>
                  <th class="num-col">Value (KZT)</th>
                  <th class="num-col">P&L USD</th>
                  <th class="num-col">P&L KZT</th>
                  <th class="num-col">P&L %</th>
                  <th class="num-col">Weight</th>
                </tr>
              </thead>
              <tbody>
                @for (pos of sortedPositions(); track pos.ticker) {
                  <tr>
                    <td>
                      <div class="flex items-center gap-2">
                        <span class="color-dot" [style.background]="getTickerColor(pos.ticker)"></span>
                        <div>
                          <div class="mono" style="font-weight:700;font-size:14px">{{ pos.ticker }}</div>
                          <div style="font-size:11px;color:var(--text-muted)">{{ pos.name }}</div>
                        </div>
                      </div>
                    </td>
                    <td class="num-col num">{{ pos.quantity | number:'1.0-4' }}</td>
                    <td class="num-col num text-secondary">{{ pos.avg_cost_usd | currency:'USD':'symbol':'1.2-2' }}</td>
                    <td class="num-col num">{{ pos.current_price_usd | currency:'USD':'symbol':'1.2-2' }}</td>
                    <td class="num-col num">{{ pos.current_value_usd | currency:'USD':'symbol':'1.2-2' }}</td>
                    <td class="num-col num text-secondary">₸ {{ pos.current_value_kzt | number:'1.0-0' }}</td>
                    <td class="num-col num" [class.profit]="pos.profit_usd >= 0" [class.loss]="pos.profit_usd < 0">
                      {{ pos.profit_usd >= 0 ? '+' : '' }}{{ pos.profit_usd | currency:'USD':'symbol':'1.2-2' }}
                    </td>
                    <td class="num-col num" [class.profit]="pos.profit_kzt >= 0" [class.loss]="pos.profit_kzt < 0">
                      {{ pos.profit_kzt >= 0 ? '+' : '' }}₸ {{ pos.profit_kzt | number:'1.0-0' }}
                    </td>
                    <td class="num-col">
                      <span class="pct-pill" [class.profit]="pos.profit_percent >= 0" [class.loss]="pos.profit_percent < 0">
                        {{ pos.profit_percent >= 0 ? '+' : '' }}{{ pos.profit_percent | number:'1.2-2' }}%
                      </span>
                    </td>
                    <td class="num-col">
                      <div class="wt-wrap">
                        <div class="wt-bar"><div class="wt-fill" [style.width.%]="getWeight(pos)" [style.background]="getTickerColor(pos.ticker)"></div></div>
                        <span class="num" style="font-size:11px;min-width:28px;text-align:right">{{ getWeight(pos) | number:'1.0-0' }}%</span>
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
    .back-link { font-size: 13px; color: var(--text-secondary); text-decoration: none; display: block; margin-bottom: 6px; &:hover { color: var(--accent); } }

    /* PnL main card */
    .pnl-card { padding: 0; overflow: hidden; }
    .period-tabs { display: flex; border-bottom: 1px solid var(--border); }
    .period-tab {
      flex: 1; padding: 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      background: transparent; border: none; color: var(--text-muted);
      transition: all var(--transition); border-bottom: 2px solid transparent;
      &:hover { color: var(--text-primary); background: var(--bg-elevated); }
      &.active { color: var(--accent); border-bottom-color: var(--accent); background: var(--accent-dim); }
    }
    .pnl-body { padding: 28px 32px; display: flex; flex-direction: column; gap: 8px; }
    .pnl-main { display: flex; align-items: baseline; gap: 20px; }
    .pnl-amount { font-size: 52px; font-weight: 400; letter-spacing: -2px; line-height: 1; }
    .pnl-pct { font-size: 24px; font-weight: 600; }
    .pnl-kzt { font-size: 18px; color: var(--text-secondary); }
    .pnl-range { display: flex; align-items: center; gap: 16px; margin-top: 12px; color: var(--text-muted); font-size: 13px; }
    .range-item { display: flex; flex-direction: column; gap: 2px; .range-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; } .range-val { font-size: 15px; color: var(--text-secondary); } }
    .range-arrow { color: var(--text-muted); }

    /* Period mini cards */
    .period-mini-card {
      padding: 18px 20px; cursor: pointer; transition: all var(--transition);
      &:hover { border-color: var(--border-active); }
      &.active { border-color: var(--accent-border); background: var(--accent-dim); }
    }
    .pmc-period { font-size: 11px; text-transform: uppercase; letter-spacing: 0.7px; color: var(--text-muted); font-weight: 700; margin-bottom: 8px; }
    .pmc-val { font-size: 18px; font-weight: 500; }
    .pmc-pct { font-size: 12px; margin-top: 2px; }
    .spark-bar { height: 3px; background: var(--bg-base); border-radius: 2px; margin-top: 12px; overflow: hidden; }
    .spark-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease; &.profit { background: var(--green); } &.loss { background: var(--red); } }

    /* Composition bar */
    .pos-table-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--border); h2 { font-family: var(--font-display); font-size: 15px; } }
    .fx-note { font-size: 12px; }
    .composition-bar { display: flex; height: 8px; margin: 16px 20px 8px; border-radius: 4px; overflow: hidden; gap: 1px; }
    .comp-seg { height: 100%; transition: opacity var(--transition); &:hover { opacity: 0.75; } }
    .comp-legend { display: flex; gap: 16px; flex-wrap: wrap; padding: 0 20px 16px; border-bottom: 1px solid var(--border); }
    .comp-leg-item { display: flex; align-items: center; gap: 5px; font-size: 12px; }
    .comp-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .comp-tick { font-weight: 700; color: var(--text-primary); }
    .comp-pct { color: var(--text-muted); }

    .color-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
    .num-col { text-align: right; }
    .pct-pill { display: inline-flex; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; font-family: var(--font-mono);
      &.profit { background: var(--green-dim); color: var(--green); }
      &.loss { background: var(--red-dim); color: var(--red); }
    }
    .wt-wrap { display: flex; align-items: center; gap: 6px; justify-content: flex-end; }
    .wt-bar { width: 48px; height: 4px; background: var(--bg-base); border-radius: 2px; overflow: hidden; }
    .wt-fill { height: 100%; border-radius: 2px; }
  `]
})
export class AnalyticsComponent implements OnInit {
  portfolioId!: number;
  loading = signal(true);
  analytics = signal<PortfolioAnalytics | null>(null);
  selectedPeriod = signal<Period>('1M');
  periods: Period[] = ['1D', '1W', '1M', '1Y'];

  private readonly COLORS = [
    '#c8ff47', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa',
    '#34d399', '#facc15', '#f87171', '#38bdf8', '#818cf8',
  ];
  private colorMap = new Map<string, string>();

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

  sortedPositions = () =>
    [...(this.analytics()?.positions_profit || [])].sort(
      (a, b) => b.current_value_usd - a.current_value_usd
    );

  constructor(private route: ActivatedRoute, private api: ApiService) {}

  ngOnInit(): void {
    this.portfolioId = +this.route.snapshot.paramMap.get('id')!;
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.getPortfolioAnalytics(this.portfolioId).subscribe({
      next: (a) => { this.analytics.set(a); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  getWeight(pos: PositionProfit): number {
    const total = this.analytics()?.total_value_usd || 1;
    return Math.min((pos.current_value_usd / +total) * 100, 100);
  }

  getSparkWidth(pnl: PeriodPnl): number {
    const items = this.periodItems();
    const maxAbs = Math.max(...items.map(i => Math.abs(+i.pnl.profit_usd)), 0.01);
    return Math.min((Math.abs(+pnl.profit_usd) / maxAbs) * 100, 100);
  }

  getTickerColor(ticker: string): string {
    if (!this.colorMap.has(ticker)) {
      this.colorMap.set(ticker, this.COLORS[this.colorMap.size % this.COLORS.length]);
    }
    return this.colorMap.get(ticker)!;
  }
}
