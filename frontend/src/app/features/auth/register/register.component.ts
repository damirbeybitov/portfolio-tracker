import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="auth-page">
      <div class="auth-card">
        <div class="auth-header">
          <div class="auth-logo"><span class="logo-mark">P</span></div>
          <h1>Create Account</h1>
          <p>Start tracking your portfolio today.</p>
        </div>

        <form (ngSubmit)="onSubmit()" class="auth-form">
          @if (error) {
            <div class="alert alert-error">{{ error }}</div>
          }
          <div class="form-group">
            <label>Email</label>
            <input type="email" class="form-control" [(ngModel)]="email" name="email" placeholder="you@example.com" required>
          </div>
          <div class="form-group">
            <label>Username</label>
            <input type="text" class="form-control" [(ngModel)]="username" name="username" placeholder="johndoe" required minlength="3">
          </div>
          <div class="form-group">
            <label>Password</label>
            <input type="password" class="form-control" [(ngModel)]="password" name="password" placeholder="Min. 8 characters" required minlength="8">
          </div>
          <button type="submit" class="btn btn-primary btn-lg w-full" [disabled]="loading">
            @if (loading) { <span class="spinner"></span> } @else { Create Account }
          </button>
        </form>

        <p class="auth-footer">Already have an account? <a routerLink="/auth/login">Sign in</a></p>
      </div>
      <div class="auth-bg">
        <div class="bg-grid"></div>
        <div class="bg-glow"></div>
      </div>
    </div>
  `,
  styles: [`
    .auth-page { min-height: 100vh; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; background: var(--bg-base); }
    .auth-bg { position: absolute; inset: 0; z-index: 0;
      .bg-grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px); background-size: 48px 48px; }
      .bg-glow { position: absolute; width: 600px; height: 600px; background: radial-gradient(circle, rgba(200,255,71,0.06) 0%, transparent 70%); bottom: -200px; left: -200px; border-radius: 50%; }
    }
    .auth-card { position: relative; z-index: 1; width: 100%; max-width: 420px; background: var(--bg-surface); border: 1px solid var(--border-active); border-radius: var(--radius-xl); padding: 48px; box-shadow: 0 32px 80px rgba(0,0,0,0.6); }
    .auth-header { text-align: center; margin-bottom: 36px;
      .auth-logo { width: 56px; height: 56px; background: var(--accent); border-radius: 16px; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; .logo-mark { font-family: var(--font-display); font-size: 28px; font-weight: 800; color: var(--text-inverse); } }
      h1 { font-size: 22px; margin-bottom: 6px; }
      p { color: var(--text-secondary); font-size: 14px; }
    }
    .auth-form { display: flex; flex-direction: column; gap: 20px; }
    .auth-footer { text-align: center; margin-top: 28px; font-size: 13px; color: var(--text-secondary); a { color: var(--accent); text-decoration: none; font-weight: 500; } }
  `]
})
export class RegisterComponent {
  email = ''; username = ''; password = '';
  loading = false; error = '';

  constructor(private auth: AuthService, private router: Router) {}

  onSubmit(): void {
    this.loading = true; this.error = '';
    this.auth.register({ email: this.email, username: this.username, password: this.password }).subscribe({
      next: () => this.router.navigate(['/']),
      error: (e) => { this.error = e.error?.detail || 'Registration failed.'; this.loading = false; }
    });
  }
}
