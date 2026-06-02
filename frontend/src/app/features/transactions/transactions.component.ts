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
                </tr>
              </thead>
              <tbody>
                @for (tx of filtered(); track tx.id) {
                  <tr>
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
}
