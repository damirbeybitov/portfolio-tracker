// Auth
export interface UserResponse {
  id: number;
  email: string;
  username: string;
  is_active: boolean;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface AuthResponse {
  user: UserResponse;
  tokens: TokenResponse;
}

// Portfolio
export interface Portfolio {
  id: number;
  name: string;
  description?: string;
  currency: string;
  created_at: string;
}

export interface Security {
  id: number;
  ticker: string;
  name: string;
  exchange?: string;
  currency: string;
  sector?: string;
  industry?: string;
}

export interface Position {
  id: number;
  portfolio_id: number;
  security: Security;
  quantity: number;
  avg_cost_usd: number;
  avg_cost_kzt: number;
  total_invested_usd: number;
  total_invested_kzt: number;
  current_price_usd?: number;
  current_price_kzt?: number;
  current_value_usd?: number;
  current_value_kzt?: number;
  profit_usd?: number;
  profit_kzt?: number;
  profit_percent?: number;
}

export type TransactionType = 'BUY' | 'SELL' | 'DIVIDEND' | 'TAX' | 'SPLIT' | 'COMMISSION';

export interface Transaction {
  id: number;
  portfolio_id: number;
  security: Security;
  type: TransactionType;
  date: string;
  quantity: number;
  price_usd: number;
  price_kzt: number;
  total_usd: number;
  total_kzt: number;
  fx_rate_usd_kzt: number;
  commission_usd: number;
  commission_kzt: number;
  split_ratio?: number;
  notes?: string;
  created_at: string;
}

export interface TransactionCreate {
  security_id: number;
  type: TransactionType;
  date: string;
  quantity: number;
  price_usd: number;
  fx_rate_usd_kzt?: number;
  commission_usd: number;
  split_ratio?: number;
  notes?: string;
}

export interface PortfolioSummary {
  portfolio: Portfolio;
  total_value_usd: number;
  total_value_kzt: number;
  total_invested_usd: number;
  total_invested_kzt: number;
  total_profit_usd: number;
  total_profit_kzt: number;
  total_profit_percent: number;
  positions: Position[];
  fx_rate: number;
}

// Analytics
export interface PeriodPnl {
  period: '1D' | '1W' | '1M' | '1Y';
  profit_usd: number;
  profit_kzt: number;
  profit_percent: number;
  value_start_usd: number;
  value_end_usd: number;
}

export interface PortfolioAnalytics {
  total_value_usd: number;
  total_value_kzt: number;
  total_invested_usd: number;
  total_profit_usd: number;
  total_profit_kzt: number;
  total_profit_percent: number;
  pnl_1d: PeriodPnl;
  pnl_1w: PeriodPnl;
  pnl_1m: PeriodPnl;
  pnl_1y: PeriodPnl;
  fx_rate: number;
  positions_profit: PositionProfit[];
}

export interface PositionProfit {
  ticker: string;
  name: string;
  quantity: number;
  avg_cost_usd: number;
  current_price_usd: number;
  current_value_usd: number;
  current_value_kzt: number;
  profit_usd: number;
  profit_kzt: number;
  profit_percent: number;
}

export interface BankSummary {
  total_kzt: number;
  total_usd: number;
  total_usd_equivalent: number;
  total_interest_earned_kzt: number;
  total_interest_earned_usd: number;
  accounts: BankAccountSummary[];
}

export interface BankAccountSummary {
  id: number;
  name: string;
  currency: 'KZT' | 'USD';
  balance: number;
  balance_usd_equiv: number;
  current_rate_percent?: number;
  interest_earned: number;
}

export interface OverallSummary {
  portfolio: PortfolioAnalytics;
  bank: BankSummary;
  grand_total_usd: number;
  grand_total_kzt: number;
  fx_rate: number;
}

// Bank
export type AccountCurrency = 'KZT' | 'USD';
export type BankTransactionType =
  | 'INCOME' | 'EXPENSE' | 'INTEREST' | 'TRANSFER_IN' | 'TRANSFER_OUT'
  | 'STOCK_BUY' | 'STOCK_SELL' | 'DIVIDEND' | 'TAX' | 'COMMISSION' | 'EXCHANGE';

export interface BankAccount {
  id: number;
  name: string;
  currency: AccountCurrency;
  balance: number;
  is_active: boolean;
  notes?: string;
  current_rate?: number;
  created_at: string;
}

export interface BankAccountCreate {
  name: string;
  currency: AccountCurrency;
  balance: number;
  notes?: string;
}

export interface BankInterestRate {
  id: number;
  account_id: number;
  rate_percent: number;
  effective_from: string;
  notes?: string;
  created_at: string;
}

export interface BankTransaction {
  id: number;
  account_id: number;
  type: BankTransactionType;
  date: string;
  amount: number;
  balance_after: number;
  related_account_id?: number;
  fx_rate?: number;
  notes?: string;
  created_at: string;
}

export interface BankTransactionCreate {
  type: BankTransactionType;
  date: string;
  amount: number;
  related_account_id?: number;
  fx_rate?: number;
  notes?: string;
}

export interface FxRate {
  date: string;
  usd_to_kzt: number;
}
