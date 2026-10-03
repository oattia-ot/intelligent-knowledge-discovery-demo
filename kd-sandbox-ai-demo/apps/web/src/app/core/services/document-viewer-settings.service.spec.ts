import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { DocumentViewerSettingsService } from './document-viewer-settings.service';

describe('DocumentViewerSettingsService', () => {
  let service: DocumentViewerSettingsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        DocumentViewerSettingsService,
        {
          provide: AuthService,
          useValue: {
            getUser: () => ({ username: 'admin@demo.local', token: 'tok' }),
            getSecurityInfo: () => 'tok',
            adminRoleName: () => 'KDUIAdmin'
          }
        }
      ]
    });
    service = TestBed.inject(DocumentViewerSettingsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('uses an in-memory draft without changing the configured default until save', () => {
    flushViewerConfig('universal');

    expect(service.configuredMode()).toBe('universal');
    expect(service.mode()).toBe('universal');
    expect(service.dirty()).toBe(false);

    service.setMode('redaction');

    expect(service.configuredMode()).toBe('universal');
    expect(service.mode()).toBe('redaction');
    expect(service.dirty()).toBe(true);
    expect(sessionStorage.getItem('kd_document_viewer')).toBeNull();
  });

  it('uses an in-memory draft for snippet redaction', () => {
    flushViewerConfig('universal', true);

    expect(service.configuredSnippetRedactionEnabled()).toBe(true);
    expect(service.snippetRedactionEnabled()).toBe(true);

    service.setSnippetRedactionEnabled(false);

    expect(service.configuredSnippetRedactionEnabled()).toBe(true);
    expect(service.snippetRedactionEnabled()).toBe(false);
    expect(service.dirty()).toBe(true);
  });

  it('keeps endpoint drafts in memory until save', () => {
    flushViewerConfig('universal');

    service.setUniversalApiUrl('/CustomView/');
    service.setRedactionApiUrl('/CustomRedaction/');

    expect(service.universalApiUrl()).toBe('/CustomView');
    expect(service.redactionApiUrl()).toBe('/CustomRedaction');
    expect(service.dirty()).toBe(true);
    expect(localStorage.getItem('kd_universal_view_endpoint')).toBeNull();
  });

  it('tests the Universal Viewing endpoint', () => {
    flushViewerConfig('universal');

    let message = '';
    service.testUniversalEndpoint().subscribe((value) => {
      message = value;
    });

    const request = http.expectOne(
      (candidate) =>
        candidate.url === '/View' &&
        candidate.params.get('action') === 'GetStatus'
    );
    expect(request.request.method).toBe('GET');
    request.flush('<autnresponse><response>SUCCESS</response></autnresponse>');

    expect(message).toContain('status: SUCCESS');
  });

  it('tests the role-based redaction health endpoint', () => {
    flushViewerConfig('redaction');

    let message = '';
    service.testRedactionEndpoint().subscribe((value) => {
      message = value;
    });

    const request = http.expectOne(
      '/RedactionView/api/v1/health_check'
    );
    expect(request.request.method).toBe('GET');
    request.flush({ status: 'healthy' });

    expect(message).toContain('status: healthy');
  });

  it('saves the draft to the admin config API and treats it as the configured default', () => {
    flushViewerConfig('universal');
    service.setMode('redaction');
    service.setSnippetRedactionEnabled(false);

    let savedMode: string | undefined;
    service.saveToServer().subscribe((viewer) => {
      savedMode = viewer.mode;
    });

    const request = http.expectOne('/api/admin/config/document-viewer');
    expect(request.request.method).toBe('PUT');
    expect(request.request.headers.get('X-Community-Username')).toBe(
      'admin@demo.local'
    );
    expect(request.request.body.documentViewer.mode).toBe('redaction');
    expect(request.request.body.documentViewer.snippetRedactionEnabled).toBe(
      false
    );
    request.flush({
      ok: true,
      config: {
        documentViewer: {
          mode: 'redaction',
          universalApiUrl: '/View',
          redactionApiUrl: '/RedactionView',
          snippetRedactionEnabled: false
        }
      }
    });

    expect(savedMode).toBe('redaction');
    expect(service.configuredMode()).toBe('redaction');
    expect(service.mode()).toBe('redaction');
    expect(service.dirty()).toBe(false);
  });

  function flushViewerConfig(
    mode: 'universal' | 'redaction',
    snippetRedactionEnabled = true
  ): void {
    http
      .expectOne((request) =>
        request.url.startsWith('assets/config/document-viewer.json')
      )
      .flush({
        documentViewer: {
          mode,
          universalApiUrl: '/View',
          redactionApiUrl: '/RedactionView',
          snippetRedactionEnabled
        }
      });
  }
});
