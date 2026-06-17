import { Injectable, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Portfolio } from '../models';

/**
 * Shared portfolio list state.
 *
 * The sidebar (LayoutComponent) only ever fetched the portfolio list once,
 * on app load. That's fine until something else — the Dashboard, the
 * Portfolio detail page — creates or deletes a portfolio; without a shared
 * source of truth the sidebar would silently go stale until a full reload.
 *
 * This is intentionally tiny (a signal + three methods). No need to reach
 * for NgRx or anything heavier at this scale — every page that touches the
 * portfolio list just calls refresh()/add()/remove() and everyone else
 * reading `portfolios()` updates automatically.
 */
@Injectable({ providedIn: 'root' })
export class PortfolioStoreService {
  portfolios = signal<Portfolio[]>([]);
  loaded = signal(false);

  constructor(private api: ApiService) {}

  refresh(): void {
    this.api.listPortfolios().subscribe({
      next: (p) => {
        this.portfolios.set(p);
        this.loaded.set(true);
      },
    });
  }

  add(portfolio: Portfolio): void {
    this.portfolios.update((list) => [...list, portfolio]);
  }

  remove(id: number): void {
    this.portfolios.update((list) => list.filter((p) => p.id !== id));
  }
}