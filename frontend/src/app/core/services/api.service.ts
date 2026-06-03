import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  AuthResponse, TokenResponse, Portfolio, PortfolioSummary, Transaction, TransactionCreate,
  Security, PortfolioAnalytics, BankSummary, OverallSummary,
  BankAccount, BankAccountCreate, BankInterestRate, BankTransaction, BankTransactionCreate,
  FxRate, UserResponse
} from '../models';

const API = '/api/v1';

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  // Auth
  register(data: { email: string; username: string; password: string }): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${API}/auth/register`, data);
  }
  login(email: string, password: string): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${API}/auth/login`, { email, password });
  }
  refresh(token: string): Observable<TokenResponse> {
    return this.http.post<TokenResponse>(`${API}/auth/refresh`, { refresh_token: token });
  }
  getMe(): Observable<UserResponse> {
    return this.http.get<UserResponse>(`${API}/auth/me`);
  }

  // Portfolios
  listPortfolios(): Observable<Portfolio[]> {
    return this.http.get<Portfolio[]>(`${API}/portfolios`);
  }
  createPortfolio(data: { name: string; description?: string; currency: string }): Observable<Portfolio> {
    return this.http.post<Portfolio>(`${API}/portfolios`, data);
  }
  updatePortfolio(id: number, data: Partial<Portfolio>): Observable<Portfolio> {
    return this.http.patch<Portfolio>(`${API}/portfolios/${id}`, data);
  }
  deletePortfolio(id: number): Observable<void> {
    return this.http.delete<void>(`${API}/portfolios/${id}`);
  }
  getPortfolioSummary(id: number): Observable<PortfolioSummary> {
    return this.http.get<PortfolioSummary>(`${API}/portfolios/${id}/summary`);
  }

  // Transactions
  listTransactions(portfolioId: number): Observable<Transaction[]> {
    return this.http.get<Transaction[]>(`${API}/portfolios/${portfolioId}/transactions`);
  }
  addTransaction(portfolioId: number, data: TransactionCreate): Observable<Transaction> {
    return this.http.post<Transaction>(`${API}/portfolios/${portfolioId}/transactions`, data);
  }

  // Securities
  searchSecurities(q: string): Observable<Security[]> {
    return this.http.get<Security[]>(`${API}/portfolios/securities/search`, { params: { q } });
  }
  lookupSecurity(ticker: string): Observable<Security> {
    return this.http.post<Security>(`${API}/portfolios/securities/lookup/${ticker}`, {});
  }

  // Analytics
  getPortfolioAnalytics(portfolioId: number): Observable<PortfolioAnalytics> {
    return this.http.get<PortfolioAnalytics>(`${API}/analytics/portfolio/${portfolioId}`);
  }
  getBankSummary(): Observable<BankSummary> {
    return this.http.get<BankSummary>(`${API}/analytics/bank`);
  }
  getOverallSummary(portfolioId: number): Observable<OverallSummary> {
    return this.http.get<OverallSummary>(`${API}/analytics/overview/${portfolioId}`);
  }

  // Bank accounts
  listBankAccounts(): Observable<BankAccount[]> {
    return this.http.get<BankAccount[]>(`${API}/bank/accounts`);
  }
  createBankAccount(data: BankAccountCreate): Observable<BankAccount> {
    return this.http.post<BankAccount>(`${API}/bank/accounts`, data);
  }
  updateBankAccount(id: number, data: Partial<BankAccount>): Observable<BankAccount> {
    return this.http.patch<BankAccount>(`${API}/bank/accounts/${id}`, data);
  }
  getBankRates(accountId: number): Observable<BankInterestRate[]> {
    return this.http.get<BankInterestRate[]>(`${API}/bank/accounts/${accountId}/rates`);
  }
  setBankRate(accountId: number, data: { rate_percent: number; effective_from: string; notes?: string }): Observable<BankInterestRate> {
    return this.http.post<BankInterestRate>(`${API}/bank/accounts/${accountId}/rates`, data);
  }
  listBankTransactions(accountId: number): Observable<BankTransaction[]> {
    return this.http.get<BankTransaction[]>(`${API}/bank/accounts/${accountId}/transactions`);
  }
  addBankTransaction(accountId: number, data: BankTransactionCreate): Observable<BankTransaction> {
    return this.http.post<BankTransaction>(`${API}/bank/accounts/${accountId}/transactions`, data);
  }
  getFxRate(date?: string): Observable<FxRate> {
    const params = date ? new HttpParams().set('target_date', date) : new HttpParams();
    return this.http.get<FxRate>(`${API}/bank/fx`, { params });
  }
  setFxRate(data: { date: string; usd_to_kzt: number }): Observable<FxRate> {
    return this.http.post<FxRate>(`${API}/bank/fx`, data);
  }
}
