import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { DocumentViewerConfigFile } from './config.service';
import { AuthService } from './auth.service';

interface AdminConfigResponse {
  ok?: boolean;
  config?: DocumentViewerConfigFile;
  error?: string;
}

/**
 * PUT/GET `config/*.json` via the thin admin-config API.
 * The API re-checks Community KDUIAdmin before writing.
 */
@Injectable({ providedIn: 'root' })
export class AdminConfigService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  loadDocumentViewer(): Observable<DocumentViewerConfigFile> {
    return this.request('GET');
  }

  saveDocumentViewer(
    config: DocumentViewerConfigFile
  ): Observable<DocumentViewerConfigFile> {
    return this.request('PUT', config);
  }

  private request(
    method: 'GET' | 'PUT',
    body?: DocumentViewerConfigFile
  ): Observable<DocumentViewerConfigFile> {
    const username = this.auth.getUser()?.username?.trim();
    if (!username) {
      return throwError(() => new Error('You are not signed in. Please sign in again.'));
    }

    const base = environment.adminApiUrl.replace(/\/+$/, '');
    const headers = new HttpHeaders({
      'X-Community-Username': username,
      'X-Community-SecurityInfo': this.auth.getSecurityInfo()
    });

    const call$ =
      method === 'PUT'
        ? this.http.put<AdminConfigResponse>(`${base}/config/document-viewer`, body, {
            headers
          })
        : this.http.get<AdminConfigResponse>(`${base}/config/document-viewer`, {
            headers
          });

    return call$.pipe(
      map((response) => {
        if (!response?.config?.documentViewer) {
          throw new Error(response?.error || 'Admin config service returned no file.');
        }
        return response.config;
      }),
      catchError((err) => throwError(() => this.toError(err)))
    );
  }

  private toError(err: unknown): Error {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      const detail =
        (typeof body === 'object' && body && 'error' in body
          ? String((body as { error?: string }).error || '')
          : '') || (typeof body === 'string' ? body : '');
      if (err.status === 0) {
        return new Error(
          'Cannot reach the admin config service. Restart ./serve.sh (it starts admin-config-api.mjs) or run that process for production Nginx.'
        );
      }
      if (err.status === 401 || err.status === 403) {
        return new Error(
          detail ||
            `You must belong to the ${this.auth.adminRoleName()} Community role to save admin settings.`
        );
      }
      return new Error(detail || `Admin config request failed (HTTP ${err.status}).`);
    }
    if (err instanceof Error) {
      return err;
    }
    return new Error('Admin config request failed.');
  }
}
