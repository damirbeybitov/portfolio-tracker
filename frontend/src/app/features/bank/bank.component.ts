import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import {
  BankAccount, BankAccountCreate, BankTransaction, BankTransactionCreate,
  BankInterestRate, BankTransactionType, AccountCurrency,
  UserSettings
} from '../../core/models';

const TX_BADGES: Record<string, string> = {
  INCOME: 'badge-green', EXPENSE: 'badge-red', INTEREST: 'badge-blue',
  TRANSFER_IN: 'badge-green', TRANSFER_OUT: 'badge-red',
  STOCK_BUY: 'badge-red', STOCK_SELL: 'badge-green',
  DIVIDEND: 'badge-blue', TAX: 'badge-amber', COMMISSION: 'badge-amber', EXCHANGE: 'badge-muted'
};

@Component({
  selector: 'app-bank',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Bank Accounts</h1>
          <p class="page-subtitle">Manage deposits, withdrawals, and interest</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-secondary" (click)="showFxModal = true">Set FX Rate</button>
          <button class="btn btn-primary" (click)="openCreateAccount()">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Account
          </button>
        </div>
      </div>

      @if (loading()) {
        <div class="loading-overlay"><div class="spinner"></div><span>Loading accounts...</span></div>
      } @else {
        <!-- Summary cards -->
        <div class="grid-4" style="margin-bottom:24px">
          <div class="card stat-card">
            <div class="stat-label">Total KZT</div>
            <div class="stat-value num">₸ {{ totalKzt() | number:'1.0-0' }}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">Total USD</div>
            <div class="stat-value num">{{ totalUsd() | currency:'USD':'symbol':'1.2-2' }}</div>
          </div>
          <div class="card stat-card">
            <div class="stat-label">Total (USD equiv)</div>
            <div class="stat-value num">{{ totalUsdEquiv() | currency:'USD':'symbol':'1.2-2' }}</div>
            <div class="stat-sub">At rate {{ fxRate() | number:'1.2-2' }}</div>
          </div>
          <div class="card stat-card" style="cursor:pointer" (click)="showFxModal = true">
            <div class="stat-label">FX Rate USD/KZT</div>
            <div class="stat-value num">{{ fxRate() | number:'1.2-2' }}</div>
            <div class="stat-sub flex items-center gap-2"><span class="pulse-dot"></span>Click to update</div>
          </div>
        </div>

        <!-- Accounts grid -->
        @if (visibleAccounts().length === 0) {
          <div class="card empty-state">
            <div class="empty-icon">🏦</div>
            <div class="empty-title">No bank accounts</div>
            <div class="empty-desc">Add your KZT or USD accounts to track balances and interest</div>
            <button class="btn btn-primary mt-4" (click)="openCreateAccount()">Add Account</button>
          </div>
        } @else {
          <div class="accounts-grid">
            @for (acc of visibleAccounts(); track acc.id) {
              <div class="account-card card" [class.active]="selectedAccountId() === acc.id" [class.deleting]="deletingAccountId() === acc.id" (click)="selectAccount(acc)">
                <div class="ac-header">
                  <div class="ac-name">{{ acc.name }}</div>
                  <div class="flex gap-2 items-center">
                    @if (!acc.is_active) { <span class="badge badge-muted">Inactive</span> }
                    <span class="badge" [class.badge-blue]="acc.currency==='USD'" [class.badge-amber]="acc.currency==='KZT'">
                      {{ acc.currency }}
                    </span>
                  </div>
                </div>
                <div class="ac-balance num">
                  {{ acc.currency === 'USD' ? '$' : '₸' }}{{ acc.balance | number:'1.2-2' }}
                </div>
                @if (acc.current_rate) {
                  <div class="ac-rate">
                    <svg width="11" height="11" fill="none" stroke="var(--green)" stroke-width="2" viewBox="0 0 24 24"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/></svg>
                    {{ acc.current_rate }}% annual rate
                  </div>
                } @else {
                  <div class="ac-rate text-muted">No rate set</div>
                }
                <div class="ac-actions">
                  <button class="btn btn-ghost btn-sm" (click)="openTxModal(acc); $event.stopPropagation()">+ Transaction</button>
                  <button class="btn btn-ghost btn-sm" (click)="openRateModal(acc); $event.stopPropagation()">Set Rate</button>
                  <button
                    class="btn-delete-account"
                    [class.confirming]="confirmDeleteAccountId() === acc.id"
                    [disabled]="deletingAccountId() === acc.id"
                    (click)="onDeleteAccountClick(acc); $event.stopPropagation()"
                    [title]="confirmDeleteAccountId() === acc.id ? 'Click again to confirm' : 'Delete account'"
                  >
                    @if (deletingAccountId() === acc.id) {
                      <div class="spinner" style="width:13px;height:13px;border-width:2px"></div>
                    } @else if (confirmDeleteAccountId() === acc.id) {
                      <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                      <span>Confirm</span>
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
            }
          </div>

          <!-- Selected account detail -->
          @if (selectedAccount()) {
            <div class="account-detail" style="margin-top:24px">
              <div class="detail-header">
                <h2>{{ selectedAccount()!.name }} — Transactions</h2>
                <div class="flex gap-2">
                  <button class="btn btn-ghost btn-sm" (click)="showRates()">Interest Rates</button>
                  <button class="btn btn-secondary btn-sm" (click)="openTxModal(selectedAccount()!)">+ Add Transaction</button>
                </div>
              </div>

              @if (txLoading()) {
                <div class="loading-overlay" style="padding:40px"><div class="spinner"></div></div>
              } @else if (selectedTxs().length === 0) {
                <div class="empty-state" style="padding:40px">
                  <div class="empty-icon">📋</div>
                  <div class="empty-title">No transactions</div>
                </div>
              } @else {
                <div class="card">
                  <table class="data-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th class="num-col">Amount</th>
                        <th class="num-col">Balance After</th>
                        <th class="num-col">FX Rate</th>
                        <th>Notes</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      @for (tx of selectedTxs(); track tx.id) {
                        <tr [class.deleting]="deletingTxId() === tx.id">
                          <td class="num date-cell">{{ tx.date | date:'dd MMM yyyy' }}</td>
                          <td><span class="badge" [class]="getTxBadge(tx.type)">{{ tx.type }}</span></td>
                          <td class="num-col num" [class.profit]="tx.amount > 0" [class.loss]="tx.amount < 0">
                            {{ tx.amount > 0 ? '+' : '' }}{{ selectedAccount()!.currency === 'USD' ? '$' : '₸' }}{{ tx.amount | number:'1.2-2' }}
                          </td>
                          <td class="num-col num">
                            {{ selectedAccount()!.currency === 'USD' ? '$' : '₸' }}{{ tx.balance_after | number:'1.2-2' }}
                          </td>
                          <td class="num-col num text-secondary">
                            {{ tx.fx_rate ? (tx.fx_rate | number:'1.2-2') : '—' }}
                          </td>
                          <td class="text-secondary" style="font-size:12px">{{ tx.notes || '' }}</td>
                          <td class="action-cell">
                            <button
                              class="btn-delete"
                              [class.confirming]="confirmBankTxId() === tx.id"
                              [disabled]="deletingTxId() === tx.id"
                              (click)="onDeleteTxClick(tx)"
                              [title]="confirmBankTxId() === tx.id ? 'Click again to confirm' : 'Delete transaction'"
                            >
                              @if (deletingTxId() === tx.id) {
                                <div class="spinner" style="width:14px;height:14px;border-width:2px"></div>
                              } @else if (confirmBankTxId() === tx.id) {
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
                </div>
              }
            </div>
          }
        }
      }
    </div>

    <!-- Create Account Modal -->
    @if (showCreateModal) {
      <div class="modal-backdrop" (click)="showCreateModal = false">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>New Bank Account</h3>
            <button class="btn btn-ghost btn-sm" (click)="showCreateModal = false">✕</button>
          </div>
          <div class="modal-body">
            @if (modalError) { <div class="alert alert-error">{{ modalError }}</div> }
            <div class="form-group">
              <label>Account Name</label>
              <input type="text" class="form-control" [(ngModel)]="newAccount.name" placeholder="e.g. Halyk Bank KZT">
            </div>
            <div class="form-group">
              <label>Currency</label>
              <select class="form-control" [(ngModel)]="newAccount.currency">
                <option value="KZT">KZT — Kazakhstani Tenge</option>
                <option value="USD">USD — US Dollar</option>
              </select>
            </div>
            <div class="form-group">
              <label>Opening Balance</label>
              <input type="number" class="form-control" [(ngModel)]="newAccount.balance" min="0" step="0.01">
            </div>
            <div class="form-group">
              <label>Notes (optional)</label>
              <input type="text" class="form-control" [(ngModel)]="newAccount.notes">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="showCreateModal = false">Cancel</button>
            <button class="btn btn-primary" (click)="createAccount()" [disabled]="modalLoading">
              @if (modalLoading) { <span class="spinner"></span> } @else { Create }
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Add Transaction Modal -->
    @if (showTxModal) {
      <div class="modal-backdrop" (click)="showTxModal = false">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>Add Transaction — {{ txTargetAccount?.name }}</h3>
            <button class="btn btn-ghost btn-sm" (click)="showTxModal = false">✕</button>
          </div>
          <div class="modal-body">
            @if (txError) { <div class="alert alert-error">{{ txError }}</div> }
            <div class="form-group">
              <label>Type</label>
              <select class="form-control" [(ngModel)]="newTx.type">
                <option value="INCOME">Income (deposit)</option>
                <option value="EXPENSE">Expense (withdrawal)</option>
                <option value="INTEREST">Interest earned</option>
                <option value="TRANSFER_IN">Transfer In</option>
                <option value="TRANSFER_OUT">Transfer Out</option>
                <option value="STOCK_BUY">Stock Buy (debit)</option>
                <option value="STOCK_SELL">Stock Sell (credit)</option>
                <option value="DIVIDEND">Dividend received</option>
                <option value="TAX">Tax payment</option>
                <option value="COMMISSION">Commission</option>
                <option value="EXCHANGE">Currency Exchange</option>
              </select>
            </div>
            <div class="form-group">
              <label>Date</label>
              <input type="date" class="form-control" [(ngModel)]="newTx.date">
            </div>
            <div class="form-group">
              <label>Amount <span class="text-muted">(positive = money in, negative = money out)</span></label>
              <input type="number" class="form-control" [(ngModel)]="newTx.amount" step="0.01">
            </div>
            @if (newTx.type === 'EXCHANGE') {
              <div class="form-group">
                <label>FX Rate (USD/KZT)</label>
                <input type="number" class="form-control" [(ngModel)]="newTx.fx_rate" step="0.01" placeholder="e.g. 455.50">
              </div>
            }
            @if (newTx.type === 'TRANSFER_IN' || newTx.type === 'TRANSFER_OUT') {
              <div class="form-group">
                <label>Related Account</label>
                <select class="form-control" [(ngModel)]="newTx.related_account_id">
                  <option [value]="undefined">None</option>
                  @for (acc of visibleAccounts(); track acc.id) {
                    @if (acc.id !== txTargetAccount?.id) {
                      <option [value]="acc.id">{{ acc.name }} ({{ acc.currency }})</option>
                    }
                  }
                </select>
              </div>
            }
            <div class="form-group">
              <label>Notes (optional)</label>
              <input type="text" class="form-control" [(ngModel)]="newTx.notes">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="showTxModal = false">Cancel</button>
            <button class="btn btn-primary" (click)="addTransaction()" [disabled]="txModalLoading">
              @if (txModalLoading) { <span class="spinner"></span> } @else { Add Transaction }
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Set Interest Rate Modal -->
    @if (showRateModal) {
      <div class="modal-backdrop" (click)="showRateModal = false">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>Set Interest Rate — {{ rateTargetAccount?.name }}</h3>
            <button class="btn btn-ghost btn-sm" (click)="showRateModal = false">✕</button>
          </div>
          <div class="modal-body">
            @if (rateError) { <div class="alert alert-error">{{ rateError }}</div> }
            @if (currentRates().length > 0) {
              <div class="rate-history">
                <div class="rate-history-label">Rate History</div>
                @for (r of currentRates(); track r.id) {
                  <div class="rate-row">
                    <span class="num">{{ r.rate_percent }}%</span>
                    <span class="text-secondary">from {{ r.effective_from | date:'dd MMM yyyy' }}</span>
                    @if (r.notes) { <span class="text-muted" style="font-size:11px">{{ r.notes }}</span> }
                  </div>
                }
              </div>
            }
            <div class="form-group">
              <label>Annual Rate (%)</label>
              <input type="number" class="form-control" [(ngModel)]="newRate.rate_percent" min="0" max="100" step="0.01" placeholder="e.g. 14.5">
            </div>
            <div class="form-group">
              <label>Effective From</label>
              <input type="date" class="form-control" [(ngModel)]="newRate.effective_from">
            </div>
            <div class="form-group">
              <label>Notes (optional)</label>
              <input type="text" class="form-control" [(ngModel)]="newRate.notes">
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="showRateModal = false">Cancel</button>
            <button class="btn btn-primary" (click)="setRate()" [disabled]="rateLoading">
              @if (rateLoading) { <span class="spinner"></span> } @else { Set Rate }
            </button>
          </div>
        </div>
      </div>
    }

    <!-- FX Rate Modal -->
    @if (showFxModal) {
      <div class="modal-backdrop" (click)="showFxModal = false">
        <div class="modal" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <h3>Set FX Rate (USD/KZT)</h3>
            <button class="btn btn-ghost btn-sm" (click)="showFxModal = false">✕</button>
          </div>
          <div class="modal-body">
            @if (fxError) { <div class="alert alert-error">{{ fxError }}</div> }
            <div class="form-group">
              <label>Date</label>
              <input type="date" class="form-control" [(ngModel)]="fxForm.date">
            </div>
            <div class="form-group">
              <label>USD to KZT Rate</label>
              <input type="number" class="form-control" [(ngModel)]="fxForm.usd_to_kzt" min="0" step="0.01" placeholder="e.g. 455.50">
            </div>
            <div class="alert" style="background:var(--accent-dim);color:var(--accent);border-color:var(--accent-border);font-size:12px">
              Current auto-fetched rate: {{ fxRate() | number:'1.2-2' }} KZT per USD
            </div>
          </div>
          <div class="modal-footer">
            <button class="btn btn-secondary" (click)="showFxModal = false">Cancel</button>
            <button class="btn btn-primary" (click)="setFxRate()" [disabled]="fxLoading">
              @if (fxLoading) { <span class="spinner"></span> } @else { Set Rate }
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Error toast -->
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
    .accounts-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .account-card { padding: 22px; display: flex; flex-direction: column; gap: 8px; cursor: pointer; transition: all var(--transition);
      &:hover { border-color: var(--border-active); box-shadow: var(--shadow-elevated); }
      &.active { border-color: var(--accent-border); box-shadow: var(--shadow-accent); }
      &.deleting { opacity: 0.4; pointer-events: none; }
    }
    .ac-header { display: flex; align-items: center; justify-content: space-between; }
    .ac-name { font-family: var(--font-display); font-size: 15px; font-weight: 700; }
    .ac-balance { font-size: 28px; font-weight: 500; letter-spacing: -0.5px; margin: 4px 0; }
    .ac-rate { display: flex; align-items: center; gap: 5px; font-size: 12px; color: var(--green); }
    .ac-actions { display: flex; gap: 8px; margin-top: 8px; padding-top: 14px; border-top: 1px solid var(--border); align-items: center; }
    .detail-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; h2 { font-family: var(--font-display); font-size: 16px; } }
    .num-col { text-align: right; }
    .date-cell { color: var(--text-secondary); font-size: 13px; white-space: nowrap; }
    .rate-history { background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 4px; }
    .rate-history-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 4px; }
    .rate-row { display: flex; align-items: center; gap: 12px; font-size: 13px; span:first-child { font-family: var(--font-mono); font-weight: 600; color: var(--green); } }

    /* Row deleting state */
    tr.deleting td { opacity: 0.4; transition: opacity 0.2s; }

    /* Delete button (transaction row) */
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

    /* Delete button (account card) */
    .btn-delete-account {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 12px; border-radius: var(--radius-sm);
      font-size: 12px; font-weight: 500;
      border: 1px solid transparent; cursor: pointer;
      background: transparent; color: var(--text-muted);
      transition: all var(--transition); white-space: nowrap;
      margin-left: auto;
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
export class BankComponent implements OnInit {
  loading = signal(true);
  txLoading = signal(false);
  accounts = signal<BankAccount[]>([]);
  selectedAccountId = signal<number | null>(null);
  selectedTxs = signal<BankTransaction[]>([]);
  currentRates = signal<BankInterestRate[]>([]);
  settings = signal<UserSettings>({ hide_inactive_bank_accounts: false });
  fxRate = signal(450);
  deletingTxId = signal<number | null>(null);
  confirmBankTxId = signal<number | null>(null);
  deletingAccountId = signal<number | null>(null);
  confirmDeleteAccountId = signal<number | null>(null);
  deleteError = signal('');
  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  private confirmAccountTimer: ReturnType<typeof setTimeout> | null = null;
  private settingsLoaded = false;
  private accountsLoaded = false;

  // Modals
  showCreateModal = false;
  showTxModal = false;
  showRateModal = false;
  showFxModal = false;
  modalLoading = false;
  modalError = '';
  txModalLoading = false;
  txError = '';
  rateLoading = false;
  rateError = '';
  fxLoading = false;
  fxError = '';

  txTargetAccount: BankAccount | null = null;
  rateTargetAccount: BankAccount | null = null;

  newAccount: BankAccountCreate = { name: '', currency: 'KZT', balance: 0 };
  newTx: Partial<BankTransactionCreate> & { type: BankTransactionType } = {
    type: 'INCOME', date: new Date().toISOString().split('T')[0], amount: 0
  };
  newRate = { rate_percent: 0, effective_from: new Date().toISOString().split('T')[0], notes: '' };
  fxForm = { date: new Date().toISOString().split('T')[0], usd_to_kzt: 0 };

  visibleAccounts = () =>
    this.settings().hide_inactive_bank_accounts
      ? this.accounts().filter(a => a.is_active)
      : this.accounts();

  totalKzt = () => this.visibleAccounts().filter(a => a.currency === 'KZT').reduce((s, a) => s + +a.balance, 0);
  totalUsd = () => this.visibleAccounts().filter(a => a.currency === 'USD').reduce((s, a) => s + +a.balance, 0);
  totalUsdEquiv = () => this.totalUsd() + (this.totalKzt() / this.fxRate());
  selectedAccount = () => this.accounts().find(a => a.id === this.selectedAccountId()) || null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.getSettings().subscribe({
      next: (s) => {
        this.settings.set(s);
        this.settingsLoaded = true;
        this.maybeReselect();
      },
      error: () => {
        this.settingsLoaded = true; // still mark as "done" so the other branch can proceed
        this.maybeReselect();
      }
    });

    this.api.listBankAccounts().subscribe(accs => {
      this.accounts.set(accs);
      this.loading.set(false);
      if (accs.length > 0) this.selectAccount(accs[0]);

      this.accountsLoaded = true;
      this.maybeReselect();
    });

    this.api.getFxRate().subscribe(fx => {
      this.fxRate.set(+fx.usd_to_kzt);
      this.fxForm.usd_to_kzt = +fx.usd_to_kzt;
    });
  }

  selectAccount(acc: BankAccount): void {
    this.selectedAccountId.set(acc.id);
    this.txLoading.set(true);
    this.confirmBankTxId.set(null);
    this.api.listBankTransactions(acc.id).subscribe(txs => {
      this.selectedTxs.set(txs);
      this.txLoading.set(false);
    });
  }

  private maybeReselect(): void {
    const visible = this.visibleAccounts();
    const current = this.selectedAccountId();
    if (current !== null && !visible.some(a => a.id === current)) {
      if (visible.length > 0) this.selectAccount(visible[0]);
      else { this.selectedAccountId.set(null); this.selectedTxs.set([]); }
    }
  }

  openCreateAccount(): void {
    this.newAccount = { name: '', currency: 'KZT', balance: 0 };
    this.modalError = '';
    this.showCreateModal = true;
  }

  createAccount(): void {
    if (!this.newAccount.name) return;
    this.modalLoading = true; this.modalError = '';
    this.api.createBankAccount(this.newAccount).subscribe({
      next: (acc) => {
        this.accounts.update(prev => [...prev, acc]);
        this.showCreateModal = false;
        this.modalLoading = false;
        this.selectAccount(acc);
      },
      error: (e) => { this.modalError = e.error?.detail || 'Failed'; this.modalLoading = false; }
    });
  }

  openTxModal(acc: BankAccount): void {
    this.txTargetAccount = acc;
    this.newTx = { type: 'INCOME', date: new Date().toISOString().split('T')[0], amount: 0 };
    this.txError = '';
    this.showTxModal = true;
  }

  addTransaction(): void {
    if (!this.txTargetAccount) return;
    if ((this.newTx.type === 'TRANSFER_IN' || this.newTx.type === 'TRANSFER_OUT') && !this.newTx.related_account_id) {
      this.txError = 'Select the other account for this transfer.';
      return;
    }
    this.txModalLoading = true; this.txError = '';
    const payload: BankTransactionCreate = {
      type: this.newTx.type!,
      date: this.newTx.date!,
      amount: this.newTx.amount!,
      fx_rate: this.newTx.fx_rate || undefined,
      related_account_id: this.newTx.related_account_id || undefined,
      notes: this.newTx.notes || undefined,
    };
    // The backend now auto-creates the mirrored leg on the related account
    // for TRANSFER_IN/TRANSFER_OUT, so both accounts' balances changed —
    // not just the one we posted to — and we need to know the related
    // account's id up front so we can refresh its transaction list too if
    // it happens to be the one currently selected on screen.
    const isTransfer = (payload.type === 'TRANSFER_IN' || payload.type === 'TRANSFER_OUT') && !!payload.related_account_id;
    const relatedAccountId = payload.related_account_id;
    const postedToAccountId = this.txTargetAccount.id;

    this.api.addBankTransaction(postedToAccountId, payload).subscribe({
      next: () => {
        this.showTxModal = false; this.txModalLoading = false;
        // Always refresh the account list — both legs' balances may have changed.
        this.api.listBankAccounts().subscribe(accs => this.accounts.set(accs));

        const selectedId = this.selectedAccountId();
        const selectedIsInvolved =
          selectedId === postedToAccountId || (isTransfer && selectedId === relatedAccountId);

        if (selectedIsInvolved) {
          this.api.listBankTransactions(selectedId!).subscribe(txs => this.selectedTxs.set(txs));
        }
      },
      error: (e) => { this.txError = e.error?.detail || 'Failed'; this.txModalLoading = false; }
    });
  }

  onDeleteTxClick(tx: BankTransaction): void {
    const acc = this.selectedAccount();
    if (!acc) return;

    if (this.confirmBankTxId() === tx.id) {
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
      this.confirmBankTxId.set(null);
      this.executeDeleteBankTx(acc.id, tx.id);
    } else {
      if (this.confirmTimer) clearTimeout(this.confirmTimer);
      this.confirmBankTxId.set(tx.id);
      this.confirmTimer = setTimeout(() => {
        this.confirmBankTxId.set(null);
      }, 3000);
    }
  }

  private executeDeleteBankTx(accountId: number, transactionId: number): void {
    this.deletingTxId.set(transactionId);
    this.deleteError.set('');
    this.api.deleteBankTransaction(accountId, transactionId).subscribe({
      next: () => {
        this.selectedTxs.update(txs => txs.filter(t => t.id !== transactionId));
        this.deletingTxId.set(null);
        // Refresh account to get updated balance
        this.api.listBankAccounts().subscribe(accs => this.accounts.set(accs));
      },
      error: (e) => {
        this.deleteError.set(e.error?.detail || 'Failed to delete transaction.');
        this.deletingTxId.set(null);
        setTimeout(() => this.deleteError.set(''), 5000);
      }
    });
  }

  onDeleteAccountClick(acc: BankAccount): void {
    if (this.confirmDeleteAccountId() === acc.id) {
      if (this.confirmAccountTimer) clearTimeout(this.confirmAccountTimer);
      this.confirmDeleteAccountId.set(null);
      this.executeDeleteAccount(acc);
    } else {
      if (this.confirmAccountTimer) clearTimeout(this.confirmAccountTimer);
      this.confirmDeleteAccountId.set(acc.id);
      this.confirmAccountTimer = setTimeout(() => {
        this.confirmDeleteAccountId.set(null);
      }, 3000);
    }
  }

  private executeDeleteAccount(acc: BankAccount): void {
    this.deletingAccountId.set(acc.id);
    this.deleteError.set('');
    this.api.deleteBankAccount(acc.id).subscribe({
      next: () => {
        this.accounts.update(accs => accs.filter(a => a.id !== acc.id));
        this.deletingAccountId.set(null);

        // If the deleted account was selected, select another or clear
        if (this.selectedAccountId() === acc.id) {
          const remaining = this.accounts();
          if (remaining.length > 0) {
            this.selectAccount(remaining[0]);
          } else {
            this.selectedAccountId.set(null);
            this.selectedTxs.set([]);
          }
        }
      },
      error: (e) => {
        this.deleteError.set(e.error?.detail || 'Failed to delete account.');
        this.deletingAccountId.set(null);
        setTimeout(() => this.deleteError.set(''), 5000);
      }
    });
  }

  openRateModal(acc: BankAccount): void {
    this.rateTargetAccount = acc;
    this.newRate = { rate_percent: acc.current_rate || 0, effective_from: new Date().toISOString().split('T')[0], notes: '' };
    this.rateError = '';
    this.api.getBankRates(acc.id).subscribe(r => this.currentRates.set(r));
    this.showRateModal = true;
  }

  showRates(): void {
    if (this.selectedAccount()) this.openRateModal(this.selectedAccount()!);
  }

  setRate(): void {
    if (!this.rateTargetAccount) return;
    this.rateLoading = true; this.rateError = '';
    this.api.setBankRate(this.rateTargetAccount.id, this.newRate).subscribe({
      next: () => {
        this.showRateModal = false; this.rateLoading = false;
        this.api.listBankAccounts().subscribe(accs => this.accounts.set(accs));
      },
      error: (e) => { this.rateError = e.error?.detail || 'Failed'; this.rateLoading = false; }
    });
  }

  setFxRate(): void {
    this.fxLoading = true; this.fxError = '';
    this.api.setFxRate(this.fxForm).subscribe({
      next: () => {
        this.fxRate.set(this.fxForm.usd_to_kzt);
        this.showFxModal = false;
        this.fxLoading = false;
      },
      error: (e) => { this.fxError = e.error?.detail || 'Failed'; this.fxLoading = false; }
    });
  }

  getTxBadge(type: string): string { return TX_BADGES[type] || 'badge-muted'; }
}