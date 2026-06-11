import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import { Transaction, TransactionType } from '../../core/models';

const TX_BADGES: Record<TransactionType, string> = {
  BUY: 'badge-green', SELL: 'badge-red', DIVIDEND: 'badge-blue',
  TAX: 'badge-amber', SPLIT: 'badge-muted', COMMISSION: 'badge-muted'
};

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <a [routerLink]="['/portfolio', portfolioId]" class="back-link">← Back to Portfolio</a>
          <h1 class="page-title">Transaction History</h1>
          <p class="page-subtitle">{{ filtered().length }} of {{ transactions().length }} transactions</p>
        </div>
      </div>

      <!-- Filters -->
      <div class="filters card" style="margin-bottom:20px; padding:16px 20px;">
        <div class="flex gap-3 items-center flex-wrap">
          <div class="form-group" style="min-width:200px; margin:0">
            <input type="text" class="form-control" [(ngModel)]="filterText" (input)="applyFilters()"
              placeholder="Search by ticker, name...">
          </div>
          <select class="form-control" style="width:auto" [(ngModel)]="filterType" (change)="applyFilters()">
            <option value="">All Types</option>
            <option value="BUY">Buy</option>
            <option value="SELL">Sell</option>
            <option value="DIVIDEND">Dividend</option>
            <option value="TAX">Tax</option>
            <option value="SPLIT">Split</option>
            <option value="COMMISSION">Commission</option>
          </select>
          <input type="date" class="form-control" style="width:auto" [(ngModel)]="filterFrom" (change)="applyFilters()" placeholder="From">
          <input type="date" class="form-control" style="width:auto" [(ngModel)]="filterTo" (change)="applyFilters()" placeholder="To">
          @if (filterText || filterType || filterFrom || filterTo) {
            <button class="btn btn-ghost btn-sm" (click)="clearFilters()">Clear filters</button>
          }
        </div>
      </div>

      @if (loading()) {
        <div class="loading-overlay"><div class="spinner"></div></div>
      } @else {
        <div class="card">
          @if (filtered().length === 0) {
            <div class="empty-state">
              <div class="empty-icon">📋</div>
              <div class="empty-title">No transactions</div>
              <div class="empty-desc">Transactions will appear here once you add them</div>
            </div>
          } @else {
            <table class="data-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Security</th>
                  <th class="num-col">Qty</th>
                  <th class="num-col">Price (USD)</th>
                  <th class="num-col">Total (USD)</th>
                  <th class="num-col">Total (KZT)</th>
                  <th class="num-col">FX Rate</th>
                  <th class="num-col">Commission</th>
                  <th>Notes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                @for (tx of filtered(); track tx.id) {
                  <tr [class.deleting]="deletingId() === tx.id">
                    <td class="date-cell num">{{ tx.date | date:'dd MMM yyyy' }}</td>
                    <td>
                      <span class="badge" [class]="getBadge(tx.type)">{{ tx.type }}</span>
                    </td>
                    <td>
                      <div class="security-info">
                        <span class="ticker">{{ tx.security.ticker }}</span>
                        <span class="sec-name">{{ tx.security.name }}</span>
                      </div>
                    </td>
                    <td class="num-col num">{{ tx.quantity | number:'1.0-4' }}</td>
                    <td class="num-col num">{{ tx.price_usd | currency:'USD':'symbol':'1.2-4' }}</td>
                    <td class="num-col num" [class.profit]="tx.type==='SELL'" [class.loss]="tx.type==='BUY'">
                      {{ tx.type === 'SELL' ? '+' : (tx.type === 'BUY' ? '-' : '') }}{{ tx.total_usd | currency:'USD':'symbol':'1.2-2' }}
                    </td>
                    <td class="num-col num">₸ {{ tx.total_kzt | number:'1.0-0' }}</td>
                    <td class="num-col num text-secondary">{{ tx.fx_rate_usd_kzt | number:'1.2-2' }}</td>
                    <td class="num-col num">
                      @if (+tx.commission_usd > 0) {
                        <span class="text-secondary">{{ tx.commission_usd | currency:'USD':'symbol':'1.2-2' }}</span>
                      } @else { — }
                    </td>
                    <td class="notes-cell">
                      @if (tx.notes) {
                        <span class="note-text" [title]="tx.notes">{{ tx.notes }}</span>
                      }
                    </td>
                    <td class="action-cell">
                      <button
                        class="btn-delete"
                        [class.confirming]="confirmDeleteId() === tx.id"
                        [disabled]="deletingId() === tx.id"
                        (click)="onDeleteClick(tx)"
                        [title]="confirmDeleteId() === tx.id ? 'Click again to confirm deletion' : 'Delete transaction'"
                      >
                        @if (deletingId() === tx.id) {
                          <div class="spinner" style="width:14px;height:14px;border-width:2px"></div>
                        } @else if (confirmDeleteId() === tx.id) {
                          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                            <polyline points="20 6 9 17 4 12"/>
                          </svg>
                          <span>Confirm</span>
                        } @else {
                          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            <path d="M10 11v6M14 11v6"/>
                            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                          </svg>
                        }
                      </button>
                    </td>
                  </tr>
                }
              </tbody>
            </table>

            <!-- Totals row -->
            <div class="totals-bar">
              <span class="tot-label">Total Invested:</span>
              <span class="tot-value num">{{ totals().invested | currency:'USD':'symbol':'1.2-2' }}</span>
              <span class="tot-sep">|</span>
              <span class="tot-label">Total Proceeds:</span>
              <span class="tot-value num profit">{{ totals().proceeds | currency:'USD':'symbol':'1.2-2' }}</span>
              <span class="tot-sep">|</span>
              <span class="tot-label">Commissions:</span>
              <span class="tot-value num loss">{{ totals().commissions | currency:'USD':'symbol':'1.2-2' }}</span>
            </div>
          }
        </div>
      }
    </div>

    <!-- Delete error toast -->
    @if (deleteError()) {
      <div class="toast toast-error">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        {{ deleteError() }}
        <button class="toast-close" (click)="deleteError.set('')">✕</button>
      </div>
    }
  `,
  styles: [`
    .back-link { font-size: 13px; color: var(--text-secondary); text-decoration: none; display: block; margin-bottom: 8px; &:hover { color: var(--accent); } }
    .num-col { text-align: right; }
    .date-cell { color: var(--text-secondary); font-size: 13px; white-space: nowrap; }
    .security-info { display: flex; flex-direction: column; gap: 2px; .ticker { font-family: var(--font-mono); font-weight: 600; font-size: 13px; } .sec-name { font-size: 11px; color: var(--text-muted); } }
    .notes-cell { max-width: 160px; }
    .note-text { font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
    .totals-bar { display: flex; align-items: center; gap: 16px; padding: 14px 20px; background: var(--bg-elevated); border-top: 1px solid var(--border); border-radius: 0 0 var(--radius-lg) var(--radius-lg); flex-wrap: wrap; }
    .tot-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px; }
    .tot-value { font-size: 14px; font-weight: 600; }
    .tot-sep { color: var(--border-active); }

    /* Row deleting state */
    tr.deleting td { opacity: 0.4; transition: opacity 0.2s; }

    /* Delete button */
    .action-cell { width: 80px; text-align: right; padding-right: 12px !important; }
    .btn-delete {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 4px 9px; border-radius: var(--radius-sm);
      font-size: 11px; font-weight: 600;
      border: 1px solid transparent; cursor: pointer;
      background: transparent; color: var(--text-muted);
      transition: all var(--transition); white-space: nowrap;
      &:hover:not(:disabled):not(.confirming) {
        background: var(--red-dim); color: var(--red);
        border-color: rgba(248,113,113,0.25);
      }
      &.confirming {
        background: var(--red-dim); color: var(--red);
        border-color: rgba(248,113,113,0.4);
        animation: pulse-border 1s ease-in-out infinite;
      }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    @keyframes pulse-border {
      0%, 100% { border-color: rgba(248,113,113,0.4); }
      50% { border-color: rgba(248,113,113,0.8); }
    }

    /* Toast */
    .toast {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      display: flex; align-items: center; gap: 10px;
      padding: 12px 16px; border-radius: var(--radius);
      font-size: 13px; font-weight: 500;
      box-shadow: var(--shadow-elevated);
      animation: slideIn 0.2s ease;
    }
    .toast-error { background: var(--bg-elevated); border: 1px solid rgba(248,113,113,0.4); color: var(--red); }
    .toast-close { background: none; border: none; cursor: pointer; color: inherit; opacity: 0.7; padding: 0; margin-left: 4px; font-size: 14px; &:hover { opacity: 1; } }
    @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
  `]
})
export class TransactionsComponent implements OnInit {
  portfolioId!: number;
  loading = signal(true);
  transactions = signal<Transaction[]>([]);
  filtered = signal<Transaction[]>([]);
  filterText = '';
  filterType = '';
  filterFrom = '';
  filterTo = '';
  totals = signal({ invested: 0, proceeds: 0, commissions: 0 });
  deletingId = signal<number | null>(null);
  confirmDeleteId = signal<number | null>(null);
  deleteError = signal('');
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private route: ActivatedRoute, private api: ApiService) {}

  ngOnInit(): void {
    this.portfolioId = +this.route.snapshot.paramMap.get('id')!;
    this.api.listTransactions(this.portfolioId).subscribe({
      next: (txs) => {
        this.transactions.set(txs);
        this.applyFilters();
        this.loading.set(false);
      },
      error: () => this.loading.set(false)
    });
  }

  applyFilters(): void {
    let result = this.transactions();
    if (this.filterText) {
      const q = this.filterText.toLowerCase();
      result = result.filter(t => t.security.ticker.toLowerCase().includes(q) || t.security.name.toLowerCase().includes(q));
    }
    if (this.filterType) result = result.filter(t => t.type === this.filterType);
    if (this.filterFrom) result = result.filter(t => t.date >= this.filterFrom);
    if (this.filterTo) result = result.filter(t => t.date <= this.filterTo);
    this.filtered.set(result);
    this.calcTotals(result);
  }

  calcTotals(txs: Transaction[]): void {
    let invested = 0, proceeds = 0, commissions = 0;
    txs.forEach(t => {
      if (t.type === 'BUY') invested += +t.total_usd;
      if (t.type === 'SELL') proceeds += +t.total_usd;
      commissions += +t.commission_usd;
    });
    this.totals.set({ invested, proceeds, commissions });
  }

  clearFilters(): void {
    this.filterText = ''; this.filterType = ''; this.filterFrom = ''; this.filterTo = '';
    this.applyFilters();
  }

  getBadge(type: TransactionType): string { return TX_BADGES[type] || 'badge-muted'; }

  onDeleteClick(tx: Transaction): void {
    if (this.confirmDeleteId() === tx.id) {
      // Second click — confirmed, proceed with deletion
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
      this.confirmDeleteId.set(null);
      this.executeDelete(tx.id);
    } else {
      // First click — ask for confirmation
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
      this.confirmDeleteId.set(tx.id);
      // Auto-cancel confirmation after 3 seconds
      this.confirmTimer = setTimeout(() => {
        this.confirmDeleteId.set(null);
      }, 3000);
    }
  }

  private executeDelete(transactionId: number): void {
    this.deletingId.set(transactionId);
    this.deleteError.set('');
    this.api.deleteTransaction(this.portfolioId, transactionId).subscribe({
      next: () => {
        this.transactions.update(txs => txs.filter(t => t.id !== transactionId));
        this.applyFilters();
        this.deletingId.set(null);
      },
      error: (e) => {
        this.deleteError.set(e.error?.detail || 'Failed to delete transaction.');
        this.deletingId.set(null);
        // Auto-dismiss error after 5s
        setTimeout(() => this.deleteError.set(''), 5000);
      }
    });
  }
}