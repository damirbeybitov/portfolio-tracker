import { Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';
import { AuthResponse, UserResponse } from '../models';

const ACCESS_TOKEN_KEY = 'pt_access';
const REFRESH_TOKEN_KEY = 'pt_refresh';

@Injectable({ providedIn: 'root' })
export class AuthService {
  currentUser = signal<UserResponse | null>(null);

  constructor(private api: ApiService, private router: Router) {
    const token = this.getAccessToken();
    if (token) {
      this.api.getMe().subscribe({
        next: (user) => this.currentUser.set(user),
        error: () => this.clearTokens()
      });
    }
  }

  login(email: string, password: string): Observable<AuthResponse> {
    return this.api.login(email, password).pipe(
      tap(res => {
        this.setTokens(res.tokens.access_token, res.tokens.refresh_token);
        this.currentUser.set(res.user);
      })
    );
  }

  register(data: { email: string; username: string; password: string }): Observable<AuthResponse> {
    return this.api.register(data).pipe(
      tap(res => {
        this.setTokens(res.tokens.access_token, res.tokens.refresh_token);
        this.currentUser.set(res.user);
      })
    );
  }

  logout(): void {
    this.clearTokens();
    this.currentUser.set(null);
    this.router.navigate(['/auth/login']);
  }

  getAccessToken(): string | null {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  }

  getRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  setTokens(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_TOKEN_KEY, access);
    localStorage.setItem(REFRESH_TOKEN_KEY, refresh);
  }

  clearTokens(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  isAuthenticated(): boolean {
    return !!this.getAccessToken();
  }
}
