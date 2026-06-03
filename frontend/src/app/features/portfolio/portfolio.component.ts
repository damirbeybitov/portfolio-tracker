import { Component, OnInit, signal } from '@angular/core';
import { CommonModule, DecimalPipe, CurrencyPipe } from '@angular/common';
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
          <a routerLink="/" class="back-link">← Dashboard</a>
          <h1 class="page-title">{{ summary()?.portfolio?.name || 'Portfolio' }}</h1>
          <p class="page-subtitle">
            {{ summary()?.positions?.length || 0 }} positions
            @if (summary()?.fx_rate) {
              · FX {{ summary()!.fx_rate | number:'1.2-2' }} KZT/USD
            }
          </p>
        </div>
        <div class="flex gap-2 flex-wrap">
          <a [routerLink]="['/portfolio', portfolioId, 'transactions']" class="btn btn-secondary">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
            History
          </a>
          <a [routerLink]="['/analytics', portfolioId]" class="btn btn-secondary">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            Analytics
          </a>
          <button class="btn btn-primary" (click)="openAddTx('BUY')">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Transaction
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-overlay"><div class="spinner"></div><span>Loading portfolio...</span></div>
      } @else if (summary()) {
        <!-- Summary strip -->
        <div class="summary-strip card" style="margin-bottom:24px">
          <div class="strip-item">
            <div class="strip-label">Market Value</div>
            <div class="strip-value num">{{ summary()!.total_value_usd | currency:'USD':'symbol':'1.2-2' }}</div>
            <div class="strip-sub num">₸ {{ summary()!.total_value_kzt | number:'1.0-0' }}</div>
          </div>
          <div class="strip-divider"></div>
          <div class="strip-item">
            <div class="strip-label">Cost Basis</div>
            <div class="strip-value num">{{ summary()!.total_invested_usd | currency:'USD':'symbol':'1.2-2' }}</div>
            <div class="strip-sub num">₸ {{ summary()!.total_invested_kzt | number:'1.0-0' }}</div>
          </div>
          <div class="strip-divider"></div>
          <div class="strip-item">
            <div class="strip-label">Unrealized P&L</div>
            <div class="strip-value num" [class.profit]="summary()!.total_profit_usd >= 0" [class.loss]="summary()!.total_profit_usd < 0">
              {{ summary()!.total_profit_usd >= 0 ? '+' : '' }}{{ summary()!.total_profit_usd | currency:'USD':'symbol':'1.2-2' }}
            </div>
            <div class="strip-sub num" [class.profit]="summary()!.total_profit_percent >= 0" [class.loss]="summary()!.total_profit_percent < 0">
              {{ summary()!.total_profit_percent >= 0 ? '+' : '' }}{{ summary()!.total_profit_percent | number:'1.2-2' }}%
            </div>
          </div>
          <div class="strip-divider"></div>
          <div class="strip-item">
            <div class="strip-label">P&L (KZT)</div>
            <div class="strip-value num" [class.profit]="summary()!.total_profit_usd >= 0" [class.loss]="summary()!.total_profit_usd < 0">
              {{ summary()!.total_profit_usd >= 0 ? '+' : '' }}₸ {{ summary()!.total_profit_kzt | number:'1.0-0' }}
            </div>
            <div class="strip-sub">At {{ summary()!.fx_rate | number:'1.2-2' }} rate</div>
          </div>
          <div class="strip-actions">
            <button class="btn btn-ghost btn-sm" (click)="loadSummary()">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Refresh
            </button>
          </div>
        </div>

        <!-- Holdings table -->
        <div class="card">
          <div class="card-header">
            <h2>Holdings</h2>
            <div class="flex gap-2">
              <button class="btn btn-ghost btn-sm" (click)="openAddTx('SPLIT')">Split</button>
              <button class="btn btn-ghost btn-sm" (click)="openAddTx('DIVIDEND')">Dividend</button>
              <button class="btn btn-ghost btn-sm" (click)="openAddTx('TAX')">Tax</button>
              <button class="btn btn-ghost btn-sm" (click)="openAddTx('COMMISSION')">Commission</button>
            </div>
          </div>

          @if (summary()!.positions.length === 0) {
            <div class="empty-state">
              <div class="empty-icon">📈</div>
              <div class="empty-title">No positions yet</div>
              <div class="empty-desc">Add your first buy transaction to start tracking</div>
              <button class="btn btn-primary mt-4" (click)="openAddTx('BUY')">Record First Buy</button>
            </div>
          } @else {
            <table class="data-table">
              <thead>
                <tr>
                  <th>Security</th>
                  <th class="num-col">Qty</th>
                  <th class="num-col">Avg Cost</th>
                  <th class="num-col">Current</th>
                  <th class="num-col">Market Value</th>
                  <th class="num-col">P&L (USD)</th>
                  <th class="num-col">P&L %</th>
                  <th class="num-col">Weight</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (pos of summary()!.positions; track pos.id) {
                  <tr>
                    <td>
                      <div class="sec-cell">
                        <div class="sec-ticker">{{ pos.security.ticker }}</div>
                        <div class="sec-name">{{ pos.security.name }}</div>
                      </div>
                    </td>
                    <td class="num-col num">{{ pos.quantity | number:'1.0-6' }}</td>
                    <td class="num-col num text-secondary">{{ pos.avg_cost_usd | currency:'USD':'symbol':'1.2-4' }}</td>
                    <td class="num-col num">
                      @if (pos.current_price_usd) {
                        <div>{{ pos.current_price_usd | currency:'USD':'symbol':'1.2-2' }}</div>
                        <div class="sub-val">₸ {{ pos.current_price_kzt | number:'1.0-0' }}</div>
                      } @else {
                        <span class="text-muted">—</span>
                      }
                    </td>
                    <td class="num-col num">
                      @if (pos.current_value_usd) {
                        <div>{{ pos.current_value_usd | currency:'USD':'symbol':'1.2-2' }}</div>
                        <div class="sub-val">₸ {{ pos.current_value_kzt | number:'1.0-0' }}</div>
                      } @else {
                        <span class="text-muted">—</span>
                      }
                    </td>
                    <td class="num-col num" [class.profit]="(pos.profit_usd||0) >= 0" [class.loss]="(pos.profit_usd||0) < 0">
                      @if (pos.profit_usd != null) {
                        {{ pos.profit_usd >= 0 ? '+' : '' }}{{ pos.profit_usd | currency:'USD':'symbol':'1.2-2' }}
                      } @else { <span class="text-muted">—</span> }
                    </td>
                    <td class="num-col">
                      @if (pos.profit_percent != null) {
                        <span class="pct-pill" [class.profit]="pos.profit_percent >= 0" [class.loss]="pos.profit_percent < 0">
                          {{ pos.profit_percent >= 0 ? '+' : '' }}{{ pos.profit_percent | number:'1.2-2' }}%
                        </span>
                      } @else { <span class="text-muted">—</span> }
                    </td>
                    <td class="num-col">
                      <div class="weight-wrap">
                        <div class="weight-track">
                          <div class="weight-fill" [style.width.%]="getWeight(pos)"></div>
                        </div>
                        <span class="num" style="font-size:11px;color:var(--text-muted);min-width:32px;text-align:right">
                          {{ getWeight(pos) | number:'1.0-0' }}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <div class="row-acts">
                        <button class="btn btn-ghost btn-sm" (click)="openAddTx('BUY', pos.security)">Buy</button>
                        <button class="btn btn-ghost btn-sm loss-btn" (click)="openAddTx('SELL', pos.security)">Sell</button>
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
        <div class="modal modal-lg" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div>
              <h3>Add Transaction</h3>
              <div class="tx-type-pills">
                @for (t of txTypes; track t.value) {
                  <button class="type-pill" [class.active]="tx.type === t.value"
                    (click)="tx.type = t.value">{{ t.label }}</button>
                }
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" (click)="showTxModal = false">✕</button>
          </div>
          <div class="modal-body">
            @if (txError) { <div class="alert alert-error">{{ txError }}</div> }

            <div class="tx-grid">
              <!-- Security search -->
              <div class="form-group tx-security" [class.full-span]="true">
                <label>Security</label>
                @if (!tx.security_id) {
                  <div class="search-wrap">
                    <input type="text" class="form-control" [(ngModel)]="tickerSearch"
                      (input)="searchSecurities()" placeholder="Search ticker or name (AAPL, MSFT...)"
                      autofocus>
                    @if (searchResults().length > 0) {
                      <div class="search-dropdown">
                        @for (s of searchResults(); track s.id) {
                          <div class="search-row" (click)="selectSecurity(s)">
                            <span class="badge badge-muted mono">{{ s.ticker }}</span>
                            <span class="sr-name">{{ s.name }}</span>
                            @if (s.exchange) { <span class="sr-exch">{{ s.exchange }}</span> }
                          </div>
                        }
                        <div class="search-row search-lookup" (click)="lookupTicker()">
                          @if (lookupLoading) {
                            <div class="spinner" style="width:14px;height:14px;border-width:2px"></div>
                            <span>Looking up "{{ tickerSearch }}"...</span>
                          } @else {
                            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <span>Lookup "{{ tickerSearch.toUpperCase() }}" from Yahoo Finance</span>
                          }
                        </div>
                      </div>
                    } @else if (tickerSearch.length > 0 && !searchLoading) {
                      <div class="search-dropdown">
                        <div class="search-row search-lookup" (click)="lookupTicker()">
                          @if (lookupLoading) {
                            <div class="spinner" style="width:14px;height:14px;border-width:2px"></div>
                            <span>Looking up "{{ tickerSearch }}"...</span>
                          } @else {
                            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                            <span>Lookup "{{ tickerSearch.toUpperCase() }}" from Yahoo Finance</span>
                          }
                        </div>
                      </div>
                    }
                  </div>
                } @else {
                  <div class="selected-sec">
                    <span class="badge badge-accent mono">{{ selectedSecurity?.ticker }}</span>
                    <span class="sel-name">{{ selectedSecurity?.name }}</span>
                    @if (selectedSecurity?.exchange) {
                      <span class="sel-exch badge badge-muted">{{ selectedSecurity?.exchange }}</span>
                    }
                    <button class="btn btn-ghost btn-sm" (click)="clearSecurity()" style="margin-left:auto">Change</button>
                  </div>
                }
              </div>

              <!-- Date -->
              <div class="form-group">
                <label>Date</label>
                <input type="date" class="form-control" [(ngModel)]="tx.date">
              </div>

              @if (tx.type !== 'SPLIT') {
                <!-- Quantity -->
                <div class="form-group">
                  <label>{{ tx.type === 'DIVIDEND' || tx.type === 'TAX' || tx.type === 'COMMISSION' ? 'Amount (USD)' : 'Quantity' }}</label>
                  <input type="number" class="form-control" [(ngModel)]="tx.quantity" min="0" step="0.0001"
                    [placeholder]="tx.type === 'DIVIDEND' || tx.type === 'TAX' || tx.type === 'COMMISSION' ? '0.00' : '10'">
                </div>

                @if (tx.type !== 'DIVIDEND' && tx.type !== 'TAX' && tx.type !== 'COMMISSION') {
                  <!-- Price -->
                  <div class="form-group">
                    <label>Price per share (USD)</label>
                    <input type="number" class="form-control" [(ngModel)]="tx.price_usd" min="0" step="0.01" placeholder="0.00">
                  </div>

                  <!-- Commission -->
                  <div class="form-group">
                    <label>Commission (USD)</label>
                    <input type="number" class="form-control" [(ngModel)]="tx.commission_usd" min="0" step="0.01" placeholder="0.00">
                  </div>
                }

                <!-- FX Rate -->
                <div class="form-group">
                  <label>FX Rate USD/KZT <span class="label-hint">(auto if blank)</span></label>
                  <input type="number" class="form-control" [(ngModel)]="tx.fx_rate_usd_kzt" min="0" step="0.01"
                    [placeholder]="'auto (~' + (summary()?.fx_rate || 475) + ')'">
                </div>
              }

              @if (tx.type === 'SPLIT') {
                <div class="form-group">
                  <label>Split Ratio <span class="label-hint">e.g. 2 for 2-for-1</span></label>
                  <input type="number" class="form-control" [(ngModel)]="tx.split_ratio" min="0.01" step="0.01" placeholder="2">
                </div>
              }

              <!-- Notes -->
              <div class="form-group tx-notes">
                <label>Notes (optional)</label>
                <input type="text" class="form-control" [(ngModel)]="tx.notes" placeholder="e.g. Quarterly dividend">
              </div>
            </div>

            <!-- Transaction preview -->
            @if (txPreview(); as p) {
              <div class="tx-preview-box">
                <div class="preview-row">
                  <span>{{ tx.type === 'SELL' ? 'Proceeds' : 'Total Cost' }}</span>
                  <span class="num" [class.profit]="tx.type === 'SELL'" [class.loss]="tx.type === 'BUY'">
                    {{ tx.type === 'SELL' ? '+' : '' }}{{ p.totalUsd | currency:'USD':'symbol':'1.2-2' }}
                  </span>
                </div>
                @if (p.commissionUsd > 0) {
                  <div class="preview-row">
                    <span>Commission</span>
                    <span class="num loss">-{{ p.commissionUsd | currency:'USD':'symbol':'1.2-2' }}</span>
                  </div>
                }
                <div class="preview-row preview-total">
                  <span>In KZT</span>
                  <span class="num">₸ {{ p.totalKzt | number:'1.0-0' }}</span>
                </div>
              </div>
            }
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="showTxModal = false">Cancel</button>
            <button class="btn btn-primary" (click)="submitTransaction()" [disabled]="txLoading">
              @if (txLoading) { <span class="spinner"></span> } @else {
                {{ tx.type === 'BUY' ? 'Record Buy' : tx.type === 'SELL' ? 'Record Sell' : 'Record Transaction' }}
              }
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .back-link { font-size: 13px; color: var(--text-secondary); text-decoration: none; display: block; margin-bottom: 6px; &:hover { color: var(--accent); } }

    /* Summary strip */
    .summary-strip { display: flex; align-items: center; padding: 20px 28px; gap: 0; flex-wrap: wrap; }
    .strip-item { display: flex; flex-direction: column; gap: 4px; padding: 0 24px; &:first-child { padding-left: 0; } }
    .strip-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
    .strip-value { font-size: 22px; font-weight: 500; letter-spacing: -0.3px; }
    .strip-sub { font-size: 12px; color: var(--text-secondary); }
    .strip-divider { width: 1px; height: 40px; background: var(--border); margin: 0 4px; flex-shrink: 0; }
    .strip-actions { margin-left: auto; }

    /* Card header */
    .card-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--border); h2 { font-family: var(--font-display); font-size: 15px; } }

    /* Table */
    .num-col { text-align: right; }
    .sec-cell { .sec-ticker { font-family: var(--font-mono); font-weight: 700; font-size: 14px; } .sec-name { font-size: 11px; color: var(--text-muted); margin-top: 2px; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } }
    .sub-val { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
    .pct-pill { display: inline-flex; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; font-family: var(--font-mono);
      &.profit { background: var(--green-dim); color: var(--green); }
      &.loss { background: var(--red-dim); color: var(--red); }
    }
    .weight-wrap { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
    .weight-track { width: 48px; height: 4px; background: var(--bg-base); border-radius: 2px; overflow: hidden; }
    .weight-fill { height: 100%; background: var(--accent); border-radius: 2px; }
    .row-acts { display: flex; gap: 4px; justify-content: flex-end; }
    .loss-btn { &:hover { color: var(--red); background: var(--red-dim); } }

    /* Transaction modal */
    .modal-lg { max-width: 620px; }
    .tx-type-pills { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
    .type-pill {
      padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;
      border: 1px solid var(--border); background: transparent; cursor: pointer;
      color: var(--text-secondary); transition: all var(--transition);
      &:hover { border-color: var(--border-active); color: var(--text-primary); }
      &.active { background: var(--accent); color: var(--text-inverse); border-color: var(--accent); }
    }

    .tx-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .full-span { grid-column: 1 / -1; }
    .tx-notes { grid-column: 1 / -1; }

    /* Security search */
    .search-wrap { position: relative; }
    .search-dropdown {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0;
      background: var(--bg-elevated); border: 1px solid var(--border-active);
      border-radius: var(--radius); z-index: 200;
      max-height: 220px; overflow-y: auto;
      box-shadow: var(--shadow-elevated);
    }
    .search-row {
      display: flex; align-items: center; gap: 10px; padding: 10px 14px;
      cursor: pointer; font-size: 13px; transition: background var(--transition);
      &:hover { background: var(--bg-overlay); }
    }
    .search-lookup { color: var(--accent); font-size: 12px; border-top: 1px solid var(--border); }
    .sr-name { color: var(--text-secondary); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sr-exch { font-size: 11px; color: var(--text-muted); margin-left: auto; }
    .selected-sec { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .sel-name { font-size: 13px; }
    .sel-exch { font-size: 11px; }
    .label-hint { font-size: 10px; color: var(--text-muted); font-weight: 400; text-transform: none; letter-spacing: 0; }

    /* Preview box */
    .tx-preview-box {
      background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm);
      padding: 14px 16px; display: flex; flex-direction: column; gap: 8px;
    }
    .preview-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--text-secondary); .num { font-size: 15px; color: var(--text-primary); font-weight: 600; } }
    .preview-total { padding-top: 8px; border-top: 1px solid var(--border); }

    @media (max-width: 900px) {
      .summary-strip { gap: 16px; }
      .strip-divider { display: none; }
      .strip-item { padding: 0; }
    }
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
  searchLoading = false;
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  txTypes: { value: TransactionType; label: string }[] = [
    { value: 'BUY', label: 'Buy' },
    { value: 'SELL', label: 'Sell' },
    { value: 'DIVIDEND', label: 'Dividend' },
    { value: 'TAX', label: 'Tax' },
    { value: 'SPLIT', label: 'Split' },
    { value: 'COMMISSION', label: 'Commission' },
  ];

  tx: Partial<TransactionCreate> & { type: TransactionType } = {
    type: 'BUY',
    date: new Date().toISOString().split('T')[0],
    quantity: undefined,
    price_usd: undefined,
    commission_usd: 0,
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
      error: () => this.loading.set(false),
    });
  }

  openAddTx(type: TransactionType, security?: Security): void {
    this.tx = {
      type,
      date: new Date().toISOString().split('T')[0],
      quantity: undefined,
      price_usd: undefined,
      commission_usd: 0,
    };
    this.txError = '';
    if (security) this.selectSecurity(security);
    else this.clearSecurity();
    this.showTxModal = true;
  }

  searchSecurities(): void {
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    const q = this.tickerSearch.trim();
    if (q.length < 1) { this.searchResults.set([]); return; }
    this.searchTimeout = setTimeout(() => {
      this.searchLoading = true;
      this.api.searchSecurities(q).subscribe({
        next: r => { this.searchResults.set(r); this.searchLoading = false; },
        error: () => this.searchLoading = false,
      });
    }, 250);
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
    const ticker = this.tickerSearch.trim().toUpperCase();
    if (!ticker) return;
    this.lookupLoading = true;
    this.api.lookupSecurity(ticker).subscribe({
      next: (s) => { this.selectSecurity(s); this.lookupLoading = false; },
      error: (e) => {
        this.txError = e.error?.detail || `Ticker "${ticker}" not found on Yahoo Finance.`;
        this.lookupLoading = false;
      },
    });
  }

  txPreview(): { totalUsd: number; totalKzt: number; commissionUsd: number } | null {
    if (this.tx.type === 'SPLIT' || !this.tx.quantity || !this.tx.price_usd) return null;
    if (this.tx.type === 'DIVIDEND' || this.tx.type === 'TAX' || this.tx.type === 'COMMISSION') return null;
    const fx = +(this.tx.fx_rate_usd_kzt || this.summary()?.fx_rate || 475);
    const qty = +this.tx.quantity;
    const price = +this.tx.price_usd;
    const comm = +(this.tx.commission_usd || 0);
    const totalUsd = qty * price;
    return { totalUsd, totalKzt: totalUsd * fx, commissionUsd: comm };
  }

  submitTransaction(): void {
    if (!this.tx.security_id) { this.txError = 'Please select a security.'; return; }
    if (!this.tx.date) { this.txError = 'Date is required.'; return; }
    if (this.tx.type === 'SPLIT' && !this.tx.split_ratio) { this.txError = 'Split ratio is required.'; return; }

    this.txLoading = true; this.txError = '';
    const payload: TransactionCreate = {
      security_id: this.tx.security_id!,
      type: this.tx.type,
      date: this.tx.date!,
      quantity: +(this.tx.quantity || 0),
      price_usd: +(this.tx.price_usd || 0),
      commission_usd: +(this.tx.commission_usd || 0),
      fx_rate_usd_kzt: this.tx.fx_rate_usd_kzt ? +this.tx.fx_rate_usd_kzt : undefined,
      split_ratio: this.tx.split_ratio ? +this.tx.split_ratio : undefined,
      notes: this.tx.notes || undefined,
    };

    this.api.addTransaction(this.portfolioId, payload).subscribe({
      next: () => {
        this.showTxModal = false; this.txLoading = false;
        this.loadSummary();
      },
      error: (e) => {
        this.txError = e.error?.detail || 'Failed to record transaction.';
        this.txLoading = false;
      },
    });
  }

  getWeight(pos: Position): number {
    const total = +(this.summary()?.total_value_usd || 0) || 1;
    const val = +(pos.current_value_usd || pos.total_invested_usd) || 0;
    return Math.min((val / total) * 100, 100);
  }
}
