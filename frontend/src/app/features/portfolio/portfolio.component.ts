import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { PortfolioStoreService } from '../../core/services/portfolio-store.service';
import { PortfolioSummary, Position, Security, TransactionCreate } from '../../core/models';

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
            @if (summary()?.fx_rate) { · FX {{ summary()!.fx_rate | number:'1.2-2' }} KZT/USD }
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
          <button class="btn btn-primary" (click)="openSplitModal()">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Add Split
          </button>
          <button class="btn-delete-portfolio-detail"
            [class.confirming]="confirmDeletePortfolio()"
            [disabled]="deletingPortfolio()"
            (click)="onDeletePortfolioClick()">
            @if (deletingPortfolio()) {
              <span class="spinner" style="width:13px;height:13px;border-width:2px"></span>
            } @else if (confirmDeletePortfolio()) {
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
              <span>Confirm Delete</span>
            } @else {
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                <path d="M10 11v6M14 11v6"/>
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
              <span>Delete</span>
            }
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

        <!-- Info banner -->
        <div class="info-banner" style="margin-bottom:20px">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24" style="flex-shrink:0;margin-top:1px">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
          </svg>
          <span>
            To buy or sell shares go to
            <strong>Bank Accounts → + Transaction → Stock Buy / Stock Sell</strong>.
            Your cash account is debited and the trade is recorded here automatically.
            Use <strong>Add Split</strong> on this page only for stock splits.
          </span>
        </div>

        <!-- Holdings table -->
        <div class="card">
          <div class="card-header">
            <h2>Holdings</h2>
            <div class="flex gap-2 items-center flex-wrap">
              @if (recalcMessage()) {
                <span class="recalc-msg" [class.recalc-error]="recalcError()">{{ recalcMessage() }}</span>
              }
              <button class="btn btn-ghost btn-sm"
                [class.recalc-confirming]="confirmRecalc()"
                [disabled]="recalcLoading()"
                (click)="onRecalculateClick()"
                title="Rebuild Holdings from transaction history">
                @if (recalcLoading()) {
                  <span class="spinner" style="width:13px;height:13px;border-width:2px"></span> Recalculating...
                } @else if (confirmRecalc()) {
                  <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                  Confirm rebuild
                } @else {
                  <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                    <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                  </svg>
                  Recalculate
                }
              </button>
            </div>
          </div>

          @if (summary()!.positions.length === 0) {
            <div class="empty-state">
              <div class="empty-icon">📈</div>
              <div class="empty-title">No positions yet</div>
              <div class="empty-desc">
                Go to Bank Accounts and add a <strong>Stock Buy</strong> transaction to record your first purchase
              </div>
              <a routerLink="/bank" class="btn btn-primary mt-4">Go to Bank Accounts</a>
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
                      } @else { <span class="text-muted">—</span> }
                    </td>
                    <td class="num-col num">
                      @if (pos.current_value_usd) {
                        <div>{{ pos.current_value_usd | currency:'USD':'symbol':'1.2-2' }}</div>
                        <div class="sub-val">₸ {{ pos.current_value_kzt | number:'1.0-0' }}</div>
                      } @else { <span class="text-muted">—</span> }
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
                        <div class="weight-track"><div class="weight-fill" [style.width.%]="getWeight(pos)"></div></div>
                        <span class="num" style="font-size:11px;color:var(--text-muted);min-width:32px;text-align:right">
                          {{ getWeight(pos) | number:'1.0-0' }}%
                        </span>
                      </div>
                    </td>
                    <td>
                      <button class="btn btn-ghost btn-sm" (click)="openSplitModal(pos.security)">Split</button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          }
        </div>
      }
    </div>

    <!-- Split Modal -->
    @if (showSplitModal) {
      <div class="modal-backdrop" (click)="showSplitModal = false">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div>
              <h3>Record Stock Split</h3>
              <p style="font-size:12px;color:var(--text-secondary);margin-top:4px">
                Adjusts share count and average cost. Does not affect your bank balance.
              </p>
            </div>
            <button class="btn btn-ghost btn-sm" (click)="showSplitModal = false">✕</button>
          </div>
          <div class="modal-body">
            @if (txError) { <div class="alert alert-error">{{ txError }}</div> }
            <div class="form-group">
              <label>Security</label>
              @if (!tx.security_id) {
                <div class="search-wrap">
                  <input type="text" class="form-control" [(ngModel)]="tickerSearch"
                    (input)="searchSecurities()" placeholder="Search ticker..." autofocus>
                  @if (searchResults().length > 0) {
                    <div class="search-dropdown">
                      @for (s of searchResults(); track s.id) {
                        <div class="search-row" (click)="selectSecurity(s)">
                          <span class="badge badge-muted mono">{{ s.ticker }}</span>
                          <span class="sr-name">{{ s.name }}</span>
                        </div>
                      }
                    </div>
                  }
                </div>
              } @else {
                <div class="selected-sec">
                  <span class="badge badge-accent mono">{{ selectedSecurity?.ticker }}</span>
                  <span>{{ selectedSecurity?.name }}</span>
                  <button class="btn btn-ghost btn-sm" (click)="clearSecurity()" style="margin-left:auto">Change</button>
                </div>
              }
            </div>
            <div class="form-group">
              <label>Date</label>
              <input type="date" class="form-control" [(ngModel)]="tx.date">
            </div>
            <div class="form-group">
              <label>Split Ratio <span style="color:var(--text-muted);font-weight:400;font-size:11px">e.g. 4 for a 4-for-1 split</span></label>
              <input type="number" class="form-control" [(ngModel)]="tx.split_ratio" min="0.01" step="0.01" placeholder="4">
            </div>
            @if (tx.split_ratio && +tx.split_ratio > 0) {
              <div class="tx-preview-box">
                <div class="preview-row">
                  <span style="color:var(--text-muted)">Effect</span>
                  <span style="font-size:13px;color:var(--text-secondary)">
                    Shares × {{ tx.split_ratio }}, avg cost ÷ {{ tx.split_ratio }}
                  </span>
                </div>
              </div>
            }
            <div class="form-group">
              <label>Notes (optional)</label>
              <input type="text" class="form-control" [(ngModel)]="tx.notes" placeholder="e.g. NVIDIA 10:1 split">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="showSplitModal = false">Cancel</button>
            <button class="btn btn-primary" (click)="submitSplit()" [disabled]="txLoading">
              @if (txLoading) { <span class="spinner"></span> } @else { Record Split }
            </button>
          </div>
        </div>
      </div>
    }

    @if (deletePortfolioError()) {
      <div class="toast toast-error">
        {{ deletePortfolioError() }}
        <button class="toast-close" (click)="deletePortfolioError.set('')">✕</button>
      </div>
    }
  `,
  styles: [`
    .back-link { font-size: 13px; color: var(--text-secondary); text-decoration: none; display: block; margin-bottom: 6px; &:hover { color: var(--accent); } }
    .info-banner { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border-radius: var(--radius-sm); background: var(--bg-elevated); border: 1px solid var(--border); font-size: 12px; color: var(--text-secondary); line-height: 1.6; strong { color: var(--text-primary); } }
    .summary-strip { display: flex; align-items: center; padding: 20px 28px; gap: 0; flex-wrap: wrap; }
    .strip-item { display: flex; flex-direction: column; gap: 4px; padding: 0 24px; &:first-child { padding-left: 0; } }
    .strip-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); }
    .strip-value { font-size: 22px; font-weight: 500; letter-spacing: -0.3px; }
    .strip-sub { font-size: 12px; color: var(--text-secondary); }
    .strip-divider { width: 1px; height: 40px; background: var(--border); margin: 0 4px; flex-shrink: 0; }
    .strip-actions { margin-left: auto; }
    .card-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--border); h2 { font-family: var(--font-display); font-size: 15px; } flex-wrap: wrap; gap: 10px; }
    .recalc-msg { font-size: 12px; color: var(--green); white-space: nowrap; &.recalc-error { color: var(--red); } }
    .recalc-confirming { background: var(--amber-dim) !important; color: var(--amber) !important; border-color: rgba(251,191,36,0.4) !important; }
    .btn-delete-portfolio-detail { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 500; border: 1px solid rgba(248,113,113,0.2); cursor: pointer; background: var(--red-dim); color: var(--red); transition: all var(--transition); white-space: nowrap; &:hover:not(:disabled):not(.confirming) { background: rgba(248,113,113,0.2); } &.confirming { background: rgba(248,113,113,0.25); border-color: rgba(248,113,113,0.5); animation: pulse-border-red 1s ease-in-out infinite; } &:disabled { opacity: 0.6; cursor: not-allowed; } }
    @keyframes pulse-border-red { 0%, 100% { border-color: rgba(248,113,113,0.5); } 50% { border-color: rgba(248,113,113,0.9); } }
    .num-col { text-align: right; }
    .sec-cell { .sec-ticker { font-family: var(--font-mono); font-weight: 700; font-size: 14px; } .sec-name { font-size: 11px; color: var(--text-muted); margin-top: 2px; max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } }
    .sub-val { font-size: 11px; color: var(--text-secondary); margin-top: 2px; }
    .pct-pill { display: inline-flex; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; font-family: var(--font-mono); &.profit { background: var(--green-dim); color: var(--green); } &.loss { background: var(--red-dim); color: var(--red); } }
    .weight-wrap { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
    .weight-track { width: 48px; height: 4px; background: var(--bg-base); border-radius: 2px; overflow: hidden; }
    .weight-fill { height: 100%; background: var(--accent); border-radius: 2px; }
    .search-wrap { position: relative; }
    .search-dropdown { position: absolute; top: calc(100% + 4px); left: 0; right: 0; background: var(--bg-elevated); border: 1px solid var(--border-active); border-radius: var(--radius); z-index: 200; max-height: 220px; overflow-y: auto; box-shadow: var(--shadow-elevated); }
    .search-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; font-size: 13px; transition: background var(--transition); &:hover { background: var(--bg-overlay); } }
    .sr-name { color: var(--text-secondary); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .selected-sec { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .tx-preview-box { background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px 16px; }
    .preview-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; }
    .toast { position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: var(--radius); font-size: 13px; font-weight: 500; box-shadow: var(--shadow-elevated); animation: slideIn 0.2s ease; }
    .toast-error { background: var(--bg-elevated); border: 1px solid rgba(248,113,113,0.4); color: var(--red); }
    .toast-close { background: none; border: none; cursor: pointer; color: inherit; opacity: 0.7; padding: 0; margin-left: 4px; font-size: 14px; }
    @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    @media (max-width: 900px) { .summary-strip { gap: 16px; } .strip-divider { display: none; } .strip-item { padding: 0; } }
  `]
})
export class PortfolioComponent implements OnInit {
  portfolioId!: number;
  loading = signal(true);
  summary = signal<PortfolioSummary | null>(null);

  showSplitModal = false;
  txLoading = false;
  txError = '';
  tickerSearch = '';
  searchResults = signal<Security[]>([]);
  selectedSecurity: Security | null = null;
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  tx: Partial<TransactionCreate> = {
    type: 'SPLIT',
    date: new Date().toISOString().split('T')[0],
    quantity: 0,
    price_usd: 0,
  };

  recalcLoading = signal(false);
  confirmRecalc = signal(false);
  recalcMessage = signal('');
  recalcError = signal(false);
  private confirmRecalcTimer: ReturnType<typeof setTimeout> | null = null;
  private recalcMessageTimer: ReturnType<typeof setTimeout> | null = null;

  deletingPortfolio = signal(false);
  confirmDeletePortfolio = signal(false);
  deletePortfolioError = signal('');
  private confirmDeleteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private router: Router,
    private portfolioStore: PortfolioStoreService,
  ) {}

  ngOnInit(): void {
    this.portfolioId = +this.route.snapshot.paramMap.get('id')!;
    this.loadSummary();
  }

  loadSummary(): void {
    this.loading.set(true);
    this.api.getPortfolioSummary(this.portfolioId).subscribe({
      next: s => { this.summary.set(s); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  openSplitModal(security?: Security): void {
    this.tx = { type: 'SPLIT', date: new Date().toISOString().split('T')[0], quantity: 0, price_usd: 0 };
    this.txError = '';
    if (security) { this.selectedSecurity = security; this.tx.security_id = security.id; this.tickerSearch = security.ticker; }
    else { this.clearSecurity(); }
    this.showSplitModal = true;
  }

  searchSecurities(): void {
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    const q = this.tickerSearch.trim();
    if (q.length < 1) { this.searchResults.set([]); return; }
    this.searchTimeout = setTimeout(() => {
      this.api.searchSecurities(q).subscribe({ next: r => this.searchResults.set(r), error: () => {} });
    }, 250);
  }

  selectSecurity(s: Security): void {
    this.selectedSecurity = s; this.tx.security_id = s.id;
    this.tickerSearch = s.ticker; this.searchResults.set([]);
  }

  clearSecurity(): void {
    this.selectedSecurity = null; this.tx.security_id = undefined;
    this.tickerSearch = ''; this.searchResults.set([]);
  }

  submitSplit(): void {
    if (!this.tx.security_id) { this.txError = 'Select a security.'; return; }
    if (!this.tx.date) { this.txError = 'Date is required.'; return; }
    if (!this.tx.split_ratio || +this.tx.split_ratio <= 0) { this.txError = 'Split ratio is required.'; return; }
    this.txLoading = true; this.txError = '';
    const payload: TransactionCreate = {
      security_id: this.tx.security_id!,
      type: 'SPLIT',
      date: this.tx.date!,
      quantity: 0,
      price_usd: 0,
      split_ratio: +this.tx.split_ratio,
      notes: this.tx.notes || undefined,
    };
    this.api.addTransaction(this.portfolioId, payload).subscribe({
      next: () => { this.showSplitModal = false; this.txLoading = false; this.loadSummary(); },
      error: e => { this.txError = e.error?.detail || 'Failed to record split.'; this.txLoading = false; },
    });
  }

  onRecalculateClick(): void {
    if (this.recalcLoading()) return;
    if (this.confirmRecalc()) {
      if (this.confirmRecalcTimer) clearTimeout(this.confirmRecalcTimer);
      this.confirmRecalc.set(false);
      this.recalcLoading.set(true);
      this.recalcMessage.set('');
      if (this.recalcMessageTimer) clearTimeout(this.recalcMessageTimer);
      this.api.recalculatePortfolio(this.portfolioId).subscribe({
        next: s => {
          this.summary.set(s); this.recalcLoading.set(false); this.recalcError.set(false);
          this.recalcMessage.set(`Rebuilt — ${s.positions.length} position${s.positions.length !== 1 ? 's' : ''}.`);
          this.recalcMessageTimer = setTimeout(() => this.recalcMessage.set(''), 5000);
        },
        error: e => {
          this.recalcLoading.set(false); this.recalcError.set(true);
          this.recalcMessage.set(e.error?.detail || 'Failed.');
          this.recalcMessageTimer = setTimeout(() => this.recalcMessage.set(''), 5000);
        },
      });
    } else {
      this.confirmRecalc.set(true);
      this.confirmRecalcTimer = setTimeout(() => this.confirmRecalc.set(false), 4000);
    }
  }

  onDeletePortfolioClick(): void {
    if (this.deletingPortfolio()) return;
    if (this.confirmDeletePortfolio()) {
      if (this.confirmDeleteTimer) clearTimeout(this.confirmDeleteTimer);
      this.confirmDeletePortfolio.set(false);
      this.deletingPortfolio.set(true);
      this.api.deletePortfolio(this.portfolioId).subscribe({
        next: () => { this.portfolioStore.remove(this.portfolioId); this.router.navigate(['/']); },
        error: e => {
          this.deletingPortfolio.set(false);
          this.deletePortfolioError.set(e.error?.detail || 'Failed to delete.');
          setTimeout(() => this.deletePortfolioError.set(''), 5000);
        },
      });
    } else {
      this.confirmDeletePortfolio.set(true);
      this.confirmDeleteTimer = setTimeout(() => this.confirmDeletePortfolio.set(false), 4000);
    }
  }

  getWeight(pos: Position): number {
    const total = +(this.summary()?.total_value_usd || 0) || 1;
    const val = +(pos.current_value_usd || pos.total_invested_usd) || 0;
    return Math.min((val / total) * 100, 100);
  }
}
