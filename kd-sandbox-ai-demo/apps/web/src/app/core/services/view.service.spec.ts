import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { ViewService } from './view.service';

describe('ViewService', () => {
  let service: ViewService;
  let http: HttpTestingController;
  let createObjectUrl: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ViewService,
        {
          provide: AuthService,
          useValue: {
            getUser: () => ({
              username: 'ada@demo.local',
              token: 'security-token',
              stub: false
            }),
            getSecurityInfo: () => 'security-token'
          }
        }
      ]
    });
    service = TestBed.inject(ViewService);
    http = TestBed.inject(HttpTestingController);
    createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:redacted-preview');
  });

  afterEach(() => {
    createObjectUrl.mockRestore();
    http.verify();
  });

  it('uses Universal Viewing when configured', () => {
    let previewUrl = '';
    service.getPreviewBlobUrl('OpenText:123').subscribe(({ blobUrl, metrics }) => {
      previewUrl = blobUrl;
      expect(metrics.via).toBe('view');
    });

    http
      .expectOne((request) =>
        request.url.startsWith('assets/config/document-viewer.json')
      )
      .flush({
        documentViewer: {
          mode: 'universal',
          universalApiUrl: '/View',
          redactionApiUrl: '/RedactionView',
          snippetRedactionEnabled: true
        }
      });

    expect(previewUrl).toContain('action=View');
    http.expectNone(() => true);
  });

  it('loads redacted HTML into a blob when configured', () => {
    let result:
      | {
          blobUrl: string;
          metrics: { via?: 'view' | 'redaction' | 'url'; displayBytes: number };
        }
      | undefined;
    service.getPreviewBlobUrl('OpenText:456').subscribe((preview) => {
      result = preview;
    });

    http
      .expectOne((request) =>
        request.url.startsWith('assets/config/document-viewer.json')
      )
      .flush({
        documentViewer: {
          mode: 'redaction',
          universalApiUrl: '/View',
          redactionApiUrl: '/RedactionView',
          snippetRedactionEnabled: true
        }
      });

    const request = http.expectOne(
      '/RedactionView/api/v1/redactions/html'
    );
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({
      username: 'ada@demo.local',
      DREREFERENCE: 'OpenText:456'
    });
    expect(request.request.responseType).toBe('text');
    request.flush('<!doctype html><html><body>Redacted</body></html>');

    expect(result?.blobUrl).toBe('blob:redacted-preview');
    expect(result?.metrics.via).toBe('redaction');
    expect(result?.metrics.displayBytes).toBeGreaterThan(0);
    expect(createObjectUrl).toHaveBeenCalledOnce();
  });
});
