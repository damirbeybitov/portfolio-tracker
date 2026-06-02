import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { PortfolioSummary, Position, Security, TransactionCreate, TransactionType } from '../../core/models';

@Component({
  selector: 'app-portfolio',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">{{ summary()?.portfolio?.name || 'Portfolio' }}</h1>
          <p class="page-subtitle">{{ summary()?.positions?.length || 0 }} positions</p>
        </div>
        <div class="flex gap-2">
          <a [routerLink]="['/portfolio', portfolioId, 'transactions']" class="btn btn-secondary">
            Transaction History
          </a>
          <a [routerLink]="['/analytics', portfolioId]" class="btn btn-secondary">Analytics</a>
          <button class="btn btn-primary" (click)="openAddTx('BUY')">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Add Transaction
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-overlay"><div class="spinner"></div><span>Loading portfolio...</span></div>
      } @else if (summary()) {
        <!-- Summary cards -->
        <div class="grid-4" style="margin-bottom:24px">
          <div class="card stat-card">
            <div class="stat-label">Current Value</div>
            <div class="stat-value">{{ summary()!.total_value_usd | currency:'USD':'symbol':'1.2-2' }}</div>
            <div class="stat-sub">₸ {{ summary()!.total_value_kzt | number:'1.0-0' }}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">Total Invested</div>
            <div class="stat-value">{{ summary()!.total_invested_usd | currency:'USD':'symbol':'1.2-2' }}</div>
            <div class="stat-sub">₸ {{ summary()!.total_invested_kzt | number:'1.0-0' }}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">Total P&amp;L</div>
            <div class="stat-value" [class.profit]="summary()!.total_profit_usd >= 0" [class.loss]="summary()!.total_profit_usd < 0">
              {{ summary()!.total_profit_usd >= 0 ? '+' : '' }}{{ summary()!.total_profit_usd | currency:'USD':'symbol':'1.2-2' }}
            </div>
            <div class="stat-sub" [class.profit]="summary()!.total_profit_percent >= 0" [class.loss]="summary()!.total_profit_percent < 0">
              {{ summary()!.total_profit_percent >= 0 ? '+' : '' }}{{ summary()!.total_profit_percent | number:'1.2-2' }}%
            </div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">FX Rate</div>
            <div class="stat-value num">{{ summary()!.fx_rate | number:'1.2-2' }}</div>
            <div class="stat-sub">USD / KZT</div>
          </div>
        </div>

        <!-- Positions table -->
        <div class="card">
          <div class="card-header">
            <h2>Holdings</h2>
            <div class="flex gap-2">
              <button class="btn btn-ghost btn-sm" (click)="openAddTx('DIVIDEND')">+ Dividend</button>
              <button class="btn btn-ghost btn-sm" (click)="openAddTx('SPLIT')">+ Split</button>
              <button class="btn btn-ghost btn-sm" (click)="openAddTx('TAX')">+ Tax</button>
            </div>
          </div>
          @if (summary()!.positions.length === 0) {
            <div class="empty-state">
              <div class="empty-icon">📈</div>
              <div class="empty-title">No positions yet</div>
              <div class="empty-desc">Add your first buy transaction to start tracking</div>
              <button class="btn btn-primary mt-4" (click)="openAddTx('BUY')">Buy First Stock</button>
            </div>
          } @else {
            <table class="data-table">
              <thead>
                <tr>
                  <th>Security</th>
                  <th class="num-col">Qty</th>
                  <th class="num-col">Avg Cost</th>
                  <th class="num-col">Current Price</th>
                  <th class="num-col">Market Value</th>
                  <th class="num-col">P&amp;L</th>
                  <th class="num-col">P&amp;L %</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (pos of summary()!.positions; track pos.id) {
                  <tr>
                    <td>
                      <div class="security-info">
                        <div class="ticker">{{ pos.security.ticker }}</div>
                        <div class="sec-name">{{ pos.security.name }}</div>
                      </div>
                    </td>
                    <td class="num-col num">{{ pos.quantity | number:'1.0-4' }}</td>
                    <td class="num-col num">{{ pos.avg_cost_usd | currency:'USD':'symbol':'1.2-4' }}</td>
                    <td class="num-col num">
                      @if (pos.current_price_usd) {
                        {{ pos.current_price_usd | currency:'USD':'symbol':'1.2-2' }}
                      } @else {
                        <span class="text-muted">—</span>
                      }
                    </td>
                    <td class="num-col num">
                      @if (pos.current_value_usd) {
                        <div>{{ pos.current_value_usd | currency:'USD':'symbol':'1.2-2' }}</div>
                        <div class="sub-value">₸ {{ pos.current_value_kzt | number:'1.0-0' }}</div>
                      } @else {
                        <span class="text-muted">—</span>
                      }
                    </td>
                    <td class="num-col num" [class.profit]="(pos.profit_usd||0) >= 0" [class.loss]="(pos.profit_usd||0) < 0">
                      @if (pos.profit_usd != null) {
                        {{ pos.profit_usd >= 0 ? '+' : '' }}{{ pos.profit_usd | currency:'USD':'symbol':'1.2-2' }}
                      } @else { <span class="text-muted">—</span> }
                    </td>
                    <td class="num-col num" [class.profit]="(pos.profit_percent||0) >= 0" [class.loss]="(pos.profit_percent||0) < 0">
                      @if (pos.profit_percent != null) {
                        {{ pos.profit_percent >= 0 ? '+' : '' }}{{ pos.profit_percent | number:'1.2-2' }}%
                      } @else { <span class="text-muted">—</span> }
                    </td>
                    <td>
                      <div class="row-actions">
                        <button class="btn btn-ghost btn-sm" (click)="openAddTx('BUY', pos.security)">Buy</button>
                        <button class="btn btn-ghost btn-sm" (click)="openAddTx('SELL', pos.security)">Sell</button>
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

    <!-- Add Transaction Modal -->
    @if (showTxModal) {
      <div class="modal-backdrop" (click)="showTxModal = false">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>Add Transaction</h3>
            <button class="btn btn-ghost btn-sm" (click)="showTxModal = false">✕</button>
          </div>
          <div class="modal-body">
            @if (txError) { <div class="alert alert-error">{{ txError }}</div> }

            <div class="form-group">
              <label>Transaction Type</label>
              <select class="form-control" [(ngModel)]="tx.type">
                <option value="BUY">Buy</option>
                <option value="SELL">Sell</option>
                <option value="DIVIDEND">Dividend</option>
                <option value="TAX">Tax</option>
                <option value="SPLIT">Stock Split</option>
                <option value="COMMISSION">Commission</option>
              </select>
            </div>

            <div class="form-group">
              <label>Security (Ticker)</label>
              <div class="ticker-search">
                <input type="text" class="form-control" [(ngModel)]="tickerSearch"
                  (input)="searchSecurities()" placeholder="AAPL, TSLA, MSFT..."
                  [disabled]="!!tx.security_id">
                @if (tx.security_id) {
                  <div class="selected-security">
                    <span class="badge badge-accent">{{ selectedSecurity?.ticker }}</span>
                    <span>{{ selectedSecurity?.name }}</span>
                    <button class="btn btn-ghost btn-sm" (click)="clearSecurity()">✕</button>
                  </div>
                }
                @if (searchResults().length > 0 && !tx.security_id) {
                  <div class="search-dropdown">
                    @for (s of searchResults(); track s.id) {
                      <div class="search-item" (click)="selectSecurity(s)">
                        <span class="badge badge-muted">{{ s.ticker }}</span>
                        <span>{{ s.name }}</span>
                      </div>
                    }
                    @if (lookupLoading) {
                      <div class="search-item" (click)="lookupTicker()">
                        <span class="text-accent">🔍 Lookup "{{ tickerSearch }}" from Yahoo Finance</span>
                      </div>
                    }
                  </div>
                }
              </div>
            </div>

            <div class="form-group">
              <label>Date</label>
              <input type="date" class="form-control" [(ngModel)]="tx.date">
            </div>

            @if (tx.type !== 'SPLIT') {
              <div class="grid-2">
                <div class="form-group">
                  <label>Quantity</label>
                  <input type="number" class="form-control" [(ngModel)]="tx.quantity" min="0" step="0.0001">
                </div>
                <div class="form-group">
                  <label>Price (USD)</label>
                  <input type="number" class="form-control" [(ngModel)]="tx.price_usd" min="0" step="0.01">
                </div>
              </div>
              <div class="grid-2">
                <div class="form-group">
                  <label>Commission (USD)</label>
                  <input type="number" class="form-control" [(ngModel)]="tx.commission_usd" min="0" step="0.01">
                </div>
                <div class="form-group">
                  <label>FX Rate (leave blank for auto)</label>
                  <input type="number" class="form-control" [(ngModel)]="tx.fx_rate_usd_kzt" placeholder="auto" step="0.01">
                </div>
              </div>
            }

            @if (tx.type === 'SPLIT') {
              <div class="form-group">
                <label>Split Ratio (e.g. 2 for 2-for-1)</label>
                <input type="number" class="form-control" [(ngModel)]="tx.split_ratio" min="0" step="0.01">
              </div>
            }

            <div class="form-group">
              <label>Notes (optional)</label>
              <input type="text" class="form-control" [(ngModel)]="tx.notes">
            </div>

            @if (tx.type !== 'SPLIT' && tx.quantity && tx.price_usd) {
              <div class="tx-preview">
                <div class="preview-label">Total</div>
                <div class="preview-value num">{{ (tx.quantity * tx.price_usd) | currency:'USD':'symbol':'1.2-2' }}</div>
              </div>
            }
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="showTxModal = false">Cancel</button>
            <button class="btn btn-primary" (click)="submitTransaction()" [disabled]="txLoading">
              @if (txLoading) { <span class="spinner"></span> } @else { Add Transaction }
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .card-header { display: flex; align-items: center; justify-content: space-between; padding: 20px 24px; border-bottom: 1px solid var(--border); h2 { font-family: var(--font-display); font-size: 16px; } }
    .num-col { text-align: right; }
    .security-info { .ticker { font-family: var(--font-mono); font-weight: 600; font-size: 14px; } .sec-name { font-size: 12px; color: var(--text-secondary); margin-top: 2px; } }
    .sub-value { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
    .row-actions { display: flex; gap: 4px; justify-content: flex-end; }
    .ticker-search { position: relative; }
    .selected-security { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 13px; }
    .search-dropdown { position: absolute; top: 100%; left: 0; right: 0; background: var(--bg-elevated); border: 1px solid var(--border-active); border-radius: var(--radius); z-index: 100; max-height: 200px; overflow-y: auto; box-shadow: var(--shadow-elevated); margin-top: 4px; }
    .search-item { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; font-size: 13px; &:hover { background: var(--bg-overlay); } }
    .tx-preview { background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; .preview-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; } .preview-value { font-size: 18px; font-weight: 600; color: var(--accent); } }
  `]
})
export class PortfolioComponent implements OnInit {
  portfolioId!: number;
  loading = signal(true);
  summary = signal<PortfolioSummary | null>(null);
  showTxModal = false;
  txLoading = false;
  txError = '';
  tickerSearch = '';
  searchResults = signal<Security[]>([]);
  selectedSecurity: Security | null = null;
  lookupLoading = false;
  searchTimeout: ReturnType<typeof setTimeout> | null = null;

  tx: Partial<TransactionCreate> & { type: TransactionType } = {
    type: 'BUY', date: new Date().toISOString().split('T')[0],
    quantity: 0, price_usd: 0, commission_usd: 0
  };

  constructor(private route: ActivatedRoute, private api: ApiService) {}

  ngOnInit(): void {
    this.portfolioId = +this.route.snapshot.paramMap.get('id')!;
    this.loadSummary();
  }

  loadSummary(): void {
    this.loading.set(true);
    this.api.getPortfolioSummary(this.portfolioId).subscribe({
      next: (s) => { this.summary.set(s); this.loading.set(false); },
      error: () => this.loading.set(false)
    });
  }

  openAddTx(type: TransactionType, security?: Security): void {
    this.tx = { type, date: new Date().toISOString().split('T')[0], quantity: 0, price_usd: 0, commission_usd: 0 };
    this.txError = '';
    if (security) { this.selectSecurity(security); }
    else { this.clearSecurity(); }
    this.showTxModal = true;
  }

  searchSecurities(): void {
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    if (this.tickerSearch.length < 1) { this.searchResults.set([]); return; }
    this.searchTimeout = setTimeout(() => {
      this.api.searchSecurities(this.tickerSearch).subscribe(r => this.searchResults.set(r));
    }, 300);
  }

  selectSecurity(s: Security): void {
    this.selectedSecurity = s;
    this.tx.security_id = s.id;
    this.tickerSearch = s.ticker;
    this.searchResults.set([]);
  }

  clearSecurity(): void {
    this.selectedSecurity = null;
    this.tx.security_id = undefined;
    this.tickerSearch = '';
    this.searchResults.set([]);
  }

  lookupTicker(): void {
    this.lookupLoading = true;
    this.api.lookupSecurity(this.tickerSearch.trim().toUpperCase()).subscribe({
      next: (s) => { this.selectSecurity(s); this.lookupLoading = false; },
      error: () => this.lookupLoading = false
    });
  }

  submitTransaction(): void {
    if (!this.tx.security_id || !this.tx.date) {
      this.txError = 'Security and date are required.'; return;
    }
    this.txLoading = true; this.txError = '';
    const payload: TransactionCreate = {
      security_id: this.tx.security_id!,
      type: this.tx.type,
      date: this.tx.date!,
      quantity: this.tx.quantity || 0,
      price_usd: this.tx.price_usd || 0,
      commission_usd: this.tx.commission_usd || 0,
      fx_rate_usd_kzt: this.tx.fx_rate_usd_kzt || undefined,
      split_ratio: this.tx.split_ratio || undefined,
      notes: this.tx.notes || undefined,
    };
    this.api.addTransaction(this.portfolioId, payload).subscribe({
      next: () => { this.showTxModal = false; this.txLoading = false; this.loadSummary(); },
      error: (e) => { this.txError = e.error?.detail || 'Failed to add transaction.'; this.txLoading = false; }
    });
  }
}
