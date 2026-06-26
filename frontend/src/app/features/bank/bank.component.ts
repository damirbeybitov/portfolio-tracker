import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../core/services/api.service';
import {
  BankAccount, BankAccountCreate, BankTransaction, BankTransactionCreate,
  BankInterestRate, BankTransactionType, AccountCurrency,
  UserSettings, Portfolio, Security
} from '../../core/models';

const TX_BADGES: Record<string, string> = {
  INCOME: 'badge-green', EXPENSE: 'badge-red', INTEREST: 'badge-blue',
  TRANSFER_IN: 'badge-green', TRANSFER_OUT: 'badge-red',
  STOCK_BUY: 'badge-red', STOCK_SELL: 'badge-green',
  DIVIDEND: 'badge-blue', TAX: 'badge-amber', COMMISSION: 'badge-amber', EXCHANGE: 'badge-muted'
};

const STOCK_TYPES: BankTransactionType[] = ['STOCK_BUY', 'STOCK_SELL'];

@Component({
  selector: 'app-bank',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <h1 class="page-title">Bank Accounts</h1>
          <p class="page-subtitle">Manage deposits, withdrawals, interest, and stock trades</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-secondary" (click)="showFxModal = true">Set FX Rate</button>
          <button class="btn btn-primary" (click)="openCreateAccount()">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
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
              <div class="account-card card"
                [class.active]="selectedAccountId() === acc.id"
                [class.deleting]="deletingAccountId() === acc.id"
                (click)="selectAccount(acc)">
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
                    <svg width="11" height="11" fill="none" stroke="var(--green)" stroke-width="2" viewBox="0 0 24 24">
                      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                    </svg>
                    {{ acc.current_rate }}% annual
                  </div>
                } @else {
                  <div class="ac-rate text-muted">No rate set</div>
                }
                <div class="ac-actions">
                  <button class="btn btn-ghost btn-sm" (click)="openTxModal(acc); $event.stopPropagation()">+ Transaction</button>
                  <button class="btn btn-ghost btn-sm" (click)="openRateModal(acc); $event.stopPropagation()">Set Rate</button>
                  <button class="btn-delete-account"
                    [class.confirming]="confirmDeleteAccountId() === acc.id"
                    [disabled]="deletingAccountId() === acc.id"
                    (click)="onDeleteAccountClick(acc); $event.stopPropagation()"
                    [title]="confirmDeleteAccountId() === acc.id ? 'Click again to confirm' : 'Delete account'">
                    @if (deletingAccountId() === acc.id) {
                      <div class="spinner" style="width:13px;height:13px;border-width:2px"></div>
                    } @else if (confirmDeleteAccountId() === acc.id) {
                      <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
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
                        <th>Details</th>
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
                          <td>
                            @if (isStockType(tx.type) && tx.ticker) {
                              <div class="stock-details">
                                <span class="mono" style="font-weight:700;font-size:13px">{{ tx.ticker }}</span>
                                <span class="text-secondary" style="font-size:11px">
                                  {{ tx.quantity }} × {{ selectedAccount()!.currency === 'USD' ? '$' : '₸' }}{{ tx.price_per_share | number:'1.2-4' }}
                                </span>
                              </div>
                            }
                          </td>
                          <td class="num-col num" [class.profit]="tx.amount > 0" [class.loss]="tx.amount < 0">
                            {{ tx.amount > 0 ? '+' : '' }}{{ selectedAccount()!.currency === 'USD' ? '$' : '₸' }}{{ tx.amount | number:'1.2-2' }}
                          </td>
                          <td class="num-col num">
                            {{ selectedAccount()!.currency === 'USD' ? '$' : '₸' }}{{ tx.balance_after | number:'1.2-2' }}
                          </td>
                          <td class="num-col num text-secondary">{{ tx.fx_rate ? (tx.fx_rate | number:'1.2-2') : '—' }}</td>
                          <td class="text-secondary" style="font-size:12px">{{ tx.notes || '' }}</td>
                          <td class="action-cell">
                            <button class="btn-delete"
                              [class.confirming]="confirmBankTxId() === tx.id"
                              [disabled]="deletingTxId() === tx.id"
                              (click)="onDeleteTxClick(tx)"
                              [title]="isStockType(tx.type) ? 'Deletes portfolio transaction too' : 'Delete'">
                              @if (deletingTxId() === tx.id) {
                                <div class="spinner" style="width:14px;height:14px;border-width:2px"></div>
                              } @else if (confirmBankTxId() === tx.id) {
                                <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>
                                <span>{{ isStockType(tx.type) ? 'Confirm (removes portfolio tx)' : 'Confirm' }}</span>
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
        <div class="modal modal-lg" (click)="$event.stopPropagation()">
          <div class="modal-header">
            <div>
              <h3>Add Transaction — {{ txTargetAccount?.name }}</h3>
              <!-- Type pills -->
              <div class="tx-type-pills">
                @for (grp of txTypeGroups; track grp.label) {
                  <div class="type-group">
                    <span class="group-label">{{ grp.label }}</span>
                    @for (t of grp.types; track t.value) {
                      <button class="type-pill" [class.active]="newTx.type === t.value"
                        (click)="selectTxType(t.value)">{{ t.label }}</button>
                    }
                  </div>
                }
              </div>
            </div>
            <button class="btn btn-ghost btn-sm" (click)="showTxModal = false">✕</button>
          </div>
          <div class="modal-body">
            @if (txError) { <div class="alert alert-error">{{ txError }}</div> }

            @if (isStockType(newTx.type)) {
              <!-- ── Stock buy/sell fields ── -->
              <div class="stock-section">
                <div class="stock-section-title">
                  {{ newTx.type === 'STOCK_BUY' ? '📈 Buying stock' : '📉 Selling stock' }}
                  <span class="text-muted" style="font-size:12px;font-weight:400">
                    — portfolio transaction will be created automatically
                  </span>
                </div>

                <!-- Portfolio selector -->
                <div class="form-group">
                  <label>Portfolio</label>
                  <select class="form-control" [(ngModel)]="newTx.portfolio_id">
                    <option [value]="undefined">Select portfolio...</option>
                    @for (p of portfolios(); track p.id) {
                      <option [value]="p.id">{{ p.name }}</option>
                    }
                  </select>
                </div>

                <!-- Ticker search -->
                <div class="form-group">
                  <label>Ticker</label>
                  @if (!selectedSecurity) {
                    <div class="search-wrap">
                      <input type="text" class="form-control" [(ngModel)]="tickerSearch"
                        (input)="searchSecurities()"
                        placeholder="Search ticker or name (AAPL, MSFT...)" autofocus>
                      @if (searchResults().length > 0) {
                        <div class="search-dropdown">
                          @for (s of searchResults(); track s.id) {
                            <div class="search-row" (click)="selectSecurity(s)">
                              <span class="badge badge-muted mono">{{ s.ticker }}</span>
                              <span class="sr-name">{{ s.name }}</span>
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
                              <span>Looking up...</span>
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
                      <span class="badge badge-accent mono">{{ selectedSecurity.ticker }}</span>
                      <span class="sel-name">{{ selectedSecurity.name }}</span>
                      <button class="btn btn-ghost btn-sm" (click)="clearSecurity()" style="margin-left:auto">Change</button>
                    </div>
                  }
                </div>

                <div class="tx-grid">
                  <div class="form-group">
                    <label>Quantity (shares)</label>
                    <input type="number" class="form-control" [(ngModel)]="newTx.quantity" min="0.0001" step="0.0001" placeholder="10">
                  </div>
                  <div class="form-group">
                    <label>Price per share ({{ txTargetAccount?.currency }})</label>
                    <input type="number" class="form-control" [(ngModel)]="newTx.price_per_share" min="0" step="0.01" placeholder="0.00"
                      (input)="recalcStockAmount()">
                  </div>
                  <div class="form-group">
                    <label>
                      FX Rate (USD/KZT)
                      @if (txTargetAccount?.currency === 'KZT') {
                        <span class="label-hint">required for KZT account</span>
                      } @else {
                        <span class="label-hint">auto if blank</span>
                      }
                    </label>
                    <input type="number" class="form-control" [(ngModel)]="newTx.fx_rate" step="0.01"
                      [placeholder]="'~' + fxRate()">
                  </div>
                  <div class="form-group">
                    <label>Date</label>
                    <input type="date" class="form-control" [(ngModel)]="newTx.date">
                  </div>
                </div>

                <!-- Amount preview -->
                @if (stockAmountPreview()) {
                  <div class="tx-preview-box">
                    <div class="preview-row">
                      <span>{{ newTx.type === 'STOCK_SELL' ? 'Proceeds' : 'Total Cost' }}</span>
                      <span class="num" [class.profit]="newTx.type === 'STOCK_SELL'" [class.loss]="newTx.type === 'STOCK_BUY'">
                        {{ txTargetAccount?.currency === 'USD' ? '$' : '₸' }}{{ stockAmountPreview() | number:'1.2-2' }}
                      </span>
                    </div>
                    <div class="preview-row" style="font-size:11px;color:var(--text-muted)">
                      Amount that will {{ newTx.type === 'STOCK_SELL' ? 'be credited to' : 'be debited from' }} this bank account
                    </div>
                  </div>
                }

                <div class="form-group">
                  <label>Notes (optional)</label>
                  <input type="text" class="form-control" [(ngModel)]="newTx.notes" placeholder="e.g. Long-term hold">
                </div>
              </div>
            } @else {
              <!-- ── Regular transaction fields ── -->
              <div class="form-group">
                <label>Date</label>
                <input type="date" class="form-control" [(ngModel)]="newTx.date">
              </div>
              <div class="form-group">
                <label>Amount <span class="text-muted">(positive = money in, negative = money out)</span></label>
                <input type="number" class="form-control" [(ngModel)]="newTx.amount" step="0.01">
              </div>

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

              @if (isCrossCurrencyTransfer()) {
                <div class="form-group">
                  <label>FX Rate (USD/KZT) <span class="required-mark">*</span></label>
                  <input type="number" class="form-control" [(ngModel)]="newTx.fx_rate" step="0.01" placeholder="e.g. 455.50">
                  <div class="fx-rate-hint">
                    <span>Live: {{ fxRate() | number:'1.2-2' }} KZT/USD</span>
                    <button type="button" class="btn-use-live" (click)="newTx.fx_rate = fxRate()">Use this</button>
                  </div>
                </div>
              } @else if (newTx.type === 'EXCHANGE') {
                <div class="form-group">
                  <label>FX Rate (USD/KZT)</label>
                  <input type="number" class="form-control" [(ngModel)]="newTx.fx_rate" step="0.01">
                </div>
              }

              <div class="form-group">
                <label>Notes (optional)</label>
                <input type="text" class="form-control" [(ngModel)]="newTx.notes">
              </div>
            }
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
    .stock-details { display: flex; flex-direction: column; gap: 2px; }

    /* Transaction type pills */
    .tx-type-pills { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 12px; }
    .type-group { display: flex; flex-direction: column; gap: 4px; }
    .group-label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.8px; color: var(--text-muted); font-weight: 700; padding: 0 4px; }
    .type-pill {
      padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;
      border: 1px solid var(--border); background: transparent; cursor: pointer;
      color: var(--text-secondary); transition: all var(--transition);
      &:hover { border-color: var(--border-active); color: var(--text-primary); }
      &.active { background: var(--accent); color: var(--text-inverse); border-color: var(--accent); }
    }

    /* Stock section */
    .stock-section { display: flex; flex-direction: column; gap: 16px; }
    .stock-section-title { font-weight: 600; font-size: 14px; color: var(--text-primary); }
    .tx-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .label-hint { font-size: 10px; color: var(--text-muted); font-weight: 400; text-transform: none; letter-spacing: 0; }
    .required-mark { color: var(--red); }

    /* Ticker search */
    .search-wrap { position: relative; }
    .search-dropdown {
      position: absolute; top: calc(100% + 4px); left: 0; right: 0;
      background: var(--bg-elevated); border: 1px solid var(--border-active);
      border-radius: var(--radius); z-index: 200; max-height: 220px; overflow-y: auto;
      box-shadow: var(--shadow-elevated);
    }
    .search-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; cursor: pointer; font-size: 13px; transition: background var(--transition); &:hover { background: var(--bg-overlay); } }
    .search-lookup { color: var(--accent); font-size: 12px; border-top: 1px solid var(--border); }
    .sr-name { color: var(--text-secondary); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .selected-sec { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm); }
    .sel-name { font-size: 13px; }

    /* Preview box */
    .tx-preview-box { background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px 16px; display: flex; flex-direction: column; gap: 6px; }
    .preview-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; color: var(--text-secondary); .num { font-size: 16px; color: var(--text-primary); font-weight: 600; } }

    /* FX rate */
    .fx-rate-hint { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; font-size: 12px; color: var(--text-secondary); }
    .btn-use-live { background: none; border: 1px solid var(--border-active); color: var(--accent); font-size: 11px; padding: 3px 10px; border-radius: 20px; cursor: pointer; transition: all var(--transition); &:hover { background: var(--accent-dim); } }

    /* Rate history */
    .rate-history { background: var(--bg-base); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; margin-bottom: 4px; }
    .rate-history-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 4px; }
    .rate-row { display: flex; align-items: center; gap: 12px; font-size: 13px; span:first-child { font-family: var(--font-mono); font-weight: 600; color: var(--green); } }

    /* Delete buttons */
    .btn-delete-account {
      display: inline-flex; align-items: center; gap: 5px; padding: 5px 12px; border-radius: var(--radius-sm);
      font-size: 12px; font-weight: 500; border: 1px solid transparent; cursor: pointer;
      background: transparent; color: var(--text-muted); transition: all var(--transition); white-space: nowrap; margin-left: auto;
      &:hover:not(:disabled):not(.confirming) { background: var(--red-dim); color: var(--red); border-color: rgba(248,113,113,0.25); }
      &.confirming { background: var(--red-dim); color: var(--red); border-color: rgba(248,113,113,0.4); animation: pulse-border 1s ease-in-out infinite; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    .action-cell { width: 160px; text-align: right; padding-right: 12px !important; }
    .btn-delete {
      display: inline-flex; align-items: center; gap: 5px; padding: 4px 9px; border-radius: var(--radius-sm);
      font-size: 11px; font-weight: 600; border: 1px solid transparent; cursor: pointer;
      background: transparent; color: var(--text-muted); transition: all var(--transition); white-space: nowrap;
      &:hover:not(:disabled):not(.confirming) { background: var(--red-dim); color: var(--red); border-color: rgba(248,113,113,0.25); }
      &.confirming { background: var(--red-dim); color: var(--red); border-color: rgba(248,113,113,0.4); animation: pulse-border 1s ease-in-out infinite; }
      &:disabled { opacity: 0.5; cursor: not-allowed; }
    }
    tr.deleting td { opacity: 0.4; transition: opacity 0.2s; }
    @keyframes pulse-border { 0%, 100% { border-color: rgba(248,113,113,0.4); } 50% { border-color: rgba(248,113,113,0.8); } }

    /* Toast */
    .toast { position: fixed; bottom: 24px; right: 24px; z-index: 9999; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: var(--radius); font-size: 13px; font-weight: 500; box-shadow: var(--shadow-elevated); animation: slideIn 0.2s ease; }
    .toast-error { background: var(--bg-elevated); border: 1px solid rgba(248,113,113,0.4); color: var(--red); }
    .toast-close { background: none; border: none; cursor: pointer; color: inherit; opacity: 0.7; padding: 0; margin-left: 4px; font-size: 14px; &:hover { opacity: 1; } }
    @keyframes slideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

    .modal-lg { max-width: 620px; }
  `]
})
export class BankComponent implements OnInit {
  loading = signal(true);
  txLoading = signal(false);
  accounts = signal<BankAccount[]>([]);
  portfolios = signal<Portfolio[]>([]);
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
  searchResults = signal<Security[]>([]);

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
  lookupLoading = false;
  searchLoading = false;

  txTargetAccount: BankAccount | null = null;
  rateTargetAccount: BankAccount | null = null;
  selectedSecurity: Security | null = null;
  tickerSearch = '';

  private confirmTimer: ReturnType<typeof setTimeout> | null = null;
  private confirmAccountTimer: ReturnType<typeof setTimeout> | null = null;
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  newAccount: BankAccountCreate = { name: '', currency: 'KZT', balance: 0 };
  newTx: Partial<BankTransactionCreate> & { type: BankTransactionType } = {
    type: 'INCOME', date: new Date().toISOString().split('T')[0], amount: 0
  };
  newRate = { rate_percent: 0, effective_from: new Date().toISOString().split('T')[0], notes: '' };
  fxForm = { date: new Date().toISOString().split('T')[0], usd_to_kzt: 0 };

  // Transaction type groups for the pill selector
  txTypeGroups = [
    {
      label: 'Cash',
      types: [
        { value: 'INCOME' as BankTransactionType, label: 'Income' },
        { value: 'EXPENSE' as BankTransactionType, label: 'Expense' },
        { value: 'INTEREST' as BankTransactionType, label: 'Interest' },
      ]
    },
    {
      label: 'Transfers',
      types: [
        { value: 'TRANSFER_IN' as BankTransactionType, label: 'Transfer In' },
        { value: 'TRANSFER_OUT' as BankTransactionType, label: 'Transfer Out' },
        { value: 'EXCHANGE' as BankTransactionType, label: 'Exchange' },
      ]
    },
    {
      label: 'Stocks',
      types: [
        { value: 'STOCK_BUY' as BankTransactionType, label: 'Stock Buy' },
        { value: 'STOCK_SELL' as BankTransactionType, label: 'Stock Sell' },
      ]
    },
    {
      label: 'Other',
      types: [
        { value: 'DIVIDEND' as BankTransactionType, label: 'Dividend' },
        { value: 'TAX' as BankTransactionType, label: 'Tax' },
        { value: 'COMMISSION' as BankTransactionType, label: 'Commission' },
      ]
    },
  ];

  visibleAccounts = () =>
    this.settings().hide_inactive_bank_accounts
      ? this.accounts().filter(a => a.is_active)
      : this.accounts();

  totalKzt = () => this.visibleAccounts().filter(a => a.currency === 'KZT').reduce((s, a) => s + +a.balance, 0);
  totalUsd = () => this.visibleAccounts().filter(a => a.currency === 'USD').reduce((s, a) => s + +a.balance, 0);
  totalUsdEquiv = () => this.totalUsd() + (this.totalKzt() / (this.fxRate() || 475));
  selectedAccount = () => this.accounts().find(a => a.id === this.selectedAccountId()) || null;

  isStockType = (type: string) => STOCK_TYPES.includes(type as BankTransactionType);

  stockAmountPreview = (): number | null => {
    const qty = +(this.newTx.quantity || 0);
    const price = +(this.newTx.price_per_share || 0);
    if (!qty || !price) return null;
    const raw = qty * price;
    return this.newTx.type === 'STOCK_BUY' ? -raw : raw;
  };

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.api.getSettings().subscribe({ next: s => this.settings.set(s), error: () => {} });
    this.api.listBankAccounts().subscribe(accs => {
      this.accounts.set(accs);
      this.loading.set(false);
      if (accs.length > 0) this.selectAccount(accs[0]);
    });
    this.api.getFxRate().subscribe(fx => {
      this.fxRate.set(+fx.usd_to_kzt);
      this.fxForm.usd_to_kzt = +fx.usd_to_kzt;
    });
    this.api.listPortfolios().subscribe(p => this.portfolios.set(p));
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
        this.showCreateModal = false; this.modalLoading = false;
        this.selectAccount(acc);
      },
      error: (e) => { this.modalError = e.error?.detail || 'Failed'; this.modalLoading = false; }
    });
  }

  openTxModal(acc: BankAccount): void {
    this.txTargetAccount = acc;
    this.newTx = { type: 'INCOME', date: new Date().toISOString().split('T')[0], amount: 0 };
    this.clearSecurity();
    this.txError = '';
    this.showTxModal = true;
  }

  selectTxType(type: BankTransactionType): void {
    this.newTx.type = type;
    // Auto-set amount sign hints for stock types
    if (type === 'STOCK_BUY') this.newTx.amount = 0;
    if (type === 'STOCK_SELL') this.newTx.amount = 0;
    this.clearSecurity();
  }

  recalcStockAmount(): void {
    const qty = +(this.newTx.quantity || 0);
    const price = +(this.newTx.price_per_share || 0);
    if (qty && price) {
      // Debit for buy (negative), credit for sell (positive)
      this.newTx.amount = this.newTx.type === 'STOCK_BUY' ? -(qty * price) : (qty * price);
    }
  }

  // ── Ticker search ─────────────────────────────────────────────────────────

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
    this.newTx.ticker = s.ticker;
    this.tickerSearch = s.ticker;
    this.searchResults.set([]);
  }

  clearSecurity(): void {
    this.selectedSecurity = null;
    this.newTx.ticker = undefined;
    this.tickerSearch = '';
    this.searchResults.set([]);
  }

  lookupTicker(): void {
    const ticker = this.tickerSearch.trim().toUpperCase();
    if (!ticker) return;
    this.lookupLoading = true;
    this.api.lookupSecurity(ticker).subscribe({
      next: s => { this.selectSecurity(s); this.lookupLoading = false; },
      error: e => { this.txError = e.error?.detail || `"${ticker}" not found.`; this.lookupLoading = false; },
    });
  }

  // ── Cross-currency transfer helpers ───────────────────────────────────────

  isCrossCurrencyTransfer(): boolean {
    if (!this.txTargetAccount) return false;
    if (this.newTx.type !== 'TRANSFER_IN' && this.newTx.type !== 'TRANSFER_OUT') return false;
    const relatedId = this.newTx.related_account_id;
    if (!relatedId) return false;
    const related = this.accounts().find(a => a.id === +relatedId);
    return !!related && related.currency !== this.txTargetAccount.currency;
  }

  // ── Add transaction ───────────────────────────────────────────────────────

  addTransaction(): void {
    if (!this.txTargetAccount) return;
    this.txError = '';

    // Validate stock fields
    if (this.isStockType(this.newTx.type)) {
      if (!this.newTx.ticker) { this.txError = 'Select a ticker.'; return; }
      if (!this.newTx.quantity || +this.newTx.quantity <= 0) { this.txError = 'Enter quantity.'; return; }
      if (!this.newTx.price_per_share || +this.newTx.price_per_share <= 0) { this.txError = 'Enter price per share.'; return; }
      if (!this.newTx.portfolio_id) { this.txError = 'Select a portfolio.'; return; }
      if (this.txTargetAccount.currency === 'KZT' && !this.newTx.fx_rate) {
        this.txError = 'FX rate required for KZT accounts.'; return;
      }
      // Auto-calculate amount from qty × price
      const qty = +this.newTx.quantity;
      const price = +this.newTx.price_per_share;
      this.newTx.amount = this.newTx.type === 'STOCK_BUY' ? -(qty * price) : (qty * price);
    }

    if ((this.newTx.type === 'TRANSFER_IN' || this.newTx.type === 'TRANSFER_OUT') && !this.newTx.related_account_id) {
      this.txError = 'Select the other account for this transfer.'; return;
    }
    if (this.isCrossCurrencyTransfer() && !this.newTx.fx_rate) {
      this.txError = 'FX rate required for cross-currency transfer.'; return;
    }

    this.txModalLoading = true;
    const payload: BankTransactionCreate = {
      type: this.newTx.type!,
      date: this.newTx.date!,
      amount: this.newTx.amount!,
      fx_rate: this.newTx.fx_rate || undefined,
      related_account_id: this.newTx.related_account_id || undefined,
      notes: this.newTx.notes || undefined,
      ticker: this.newTx.ticker || undefined,
      quantity: this.newTx.quantity ? +this.newTx.quantity : undefined,
      price_per_share: this.newTx.price_per_share ? +this.newTx.price_per_share : undefined,
      portfolio_id: this.newTx.portfolio_id || undefined,
    };

    const postedToAccountId = this.txTargetAccount.id;
    const isTransfer = (payload.type === 'TRANSFER_IN' || payload.type === 'TRANSFER_OUT') && !!payload.related_account_id;
    const relatedAccountId = payload.related_account_id;

    this.api.addBankTransaction(postedToAccountId, payload).subscribe({
      next: () => {
        this.showTxModal = false; this.txModalLoading = false;
        this.api.listBankAccounts().subscribe(accs => this.accounts.set(accs));
        const selectedId = this.selectedAccountId();
        const involved = selectedId === postedToAccountId || (isTransfer && selectedId === relatedAccountId);
        if (involved && selectedId) {
          this.api.listBankTransactions(selectedId).subscribe(txs => this.selectedTxs.set(txs));
        }
      },
      error: e => { this.txError = e.error?.detail || 'Failed to add transaction.'; this.txModalLoading = false; }
    });
  }

  // ── Delete transaction ────────────────────────────────────────────────────

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
      this.confirmTimer = setTimeout(() => this.confirmBankTxId.set(null), 3000);
    }
  }

  private executeDeleteBankTx(accountId: number, transactionId: number): void {
    this.deletingTxId.set(transactionId);
    this.deleteError.set('');
    this.api.deleteBankTransaction(accountId, transactionId).subscribe({
      next: () => {
        this.selectedTxs.update(txs => txs.filter(t => t.id !== transactionId));
        this.deletingTxId.set(null);
        this.api.listBankAccounts().subscribe(accs => this.accounts.set(accs));
      },
      error: e => {
        this.deleteError.set(e.error?.detail || 'Failed to delete transaction.');
        this.deletingTxId.set(null);
        setTimeout(() => this.deleteError.set(''), 5000);
      }
    });
  }

  // ── Delete account ────────────────────────────────────────────────────────

  onDeleteAccountClick(acc: BankAccount): void {
    if (this.confirmDeleteAccountId() === acc.id) {
      if (this.confirmAccountTimer) clearTimeout(this.confirmAccountTimer);
      this.confirmDeleteAccountId.set(null);
      this.executeDeleteAccount(acc);
    } else {
      if (this.confirmAccountTimer) clearTimeout(this.confirmAccountTimer);
      this.confirmDeleteAccountId.set(acc.id);
      this.confirmAccountTimer = setTimeout(() => this.confirmDeleteAccountId.set(null), 3000);
    }
  }

  private executeDeleteAccount(acc: BankAccount): void {
    this.deletingAccountId.set(acc.id);
    this.deleteError.set('');
    this.api.deleteBankAccount(acc.id).subscribe({
      next: () => {
        this.accounts.update(accs => accs.filter(a => a.id !== acc.id));
        this.deletingAccountId.set(null);
        if (this.selectedAccountId() === acc.id) {
          const remaining = this.visibleAccounts();
          if (remaining.length > 0) this.selectAccount(remaining[0]);
          else { this.selectedAccountId.set(null); this.selectedTxs.set([]); }
        }
      },
      error: e => {
        this.deleteError.set(e.error?.detail || 'Failed to delete account.');
        this.deletingAccountId.set(null);
        setTimeout(() => this.deleteError.set(''), 5000);
      }
    });
  }

  // ── Rate modal ────────────────────────────────────────────────────────────

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
      error: e => { this.rateError = e.error?.detail || 'Failed'; this.rateLoading = false; }
    });
  }

  setFxRate(): void {
    this.fxLoading = true; this.fxError = '';
    this.api.setFxRate(this.fxForm).subscribe({
      next: () => {
        this.fxRate.set(this.fxForm.usd_to_kzt);
        this.showFxModal = false; this.fxLoading = false;
      },
      error: e => { this.fxError = e.error?.detail || 'Failed'; this.fxLoading = false; }
    });
  }

  getTxBadge(type: string): string { return TX_BADGES[type] || 'badge-muted'; }
}
