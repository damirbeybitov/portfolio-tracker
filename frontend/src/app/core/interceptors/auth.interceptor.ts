import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { throwError, catchError, switchMap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ApiService } from '../services/api.service';
import { Router } from '@angular/router';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const api = inject(ApiService);
  const router = inject(Router);

  const token = auth.getAccessToken();
  const authReq = token
    ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
    : req;

  return next(authReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && !req.url.includes('/auth/')) {
        const refresh = auth.getRefreshToken();
        if (refresh) {
          return api.refresh(refresh).pipe(
            switchMap(tokens => {
              auth.setTokens(tokens.access_token, tokens.refresh_token);
              const retried = req.clone({ setHeaders: { Authorization: `Bearer ${tokens.access_token}` } });
              return next(retried);
            }),
            catchError(() => {
              auth.logout();
              return throwError(() => err);
            })
          );
        }
        auth.logout();
      }
      return throwError(() => err);
    })
  );
};
