import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SearchResult } from '../models/search';
import { AuthService } from './auth.service';
import { DocumentViewerSettingsService } from './document-viewer-settings.service';
import { SnippetRedactionService } from './snippet-redaction.service';

describe('SnippetRedactionService', () => {
  let service: SnippetRedactionService;
  let http: HttpTestingController;
  let viewer: {
    resolveViewer: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    viewer = {
      resolveViewer: vi.fn(() =>
        of({
          mode: 'universal' as const,
          universalApiUrl: '/View',
          redactionApiUrl: '/RedactionView',
          snippetRedactionEnabled: true
        })
      )
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        SnippetRedactionService,
        { provide: DocumentViewerSettingsService, useValue: viewer },
        {
          provide: AuthService,
          useValue: {
            getUser: () => ({
              username: 'ada@demo.local',
              token: 'token',
              stub: false
            })
          }
        }
      ]
    });
    service = TestBed.inject(SnippetRedactionService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('leaves snippets unchanged when snippet redaction is disabled', () => {
    viewer.resolveViewer.mockReturnValue(
      of({
        mode: 'universal',
        universalApiUrl: '/View',
        redactionApiUrl: '/RedactionView',
        snippetRedactionEnabled: false
      })
    );
    const hits = [
      {
        reference: 'doc-1',
        title: 'Document',
        summary: 'Finance applications',
        database: 'KD',
        date: '',
        mimeType: '',
        author: '',
        weight: 1,
        fields: {}
      }
    ];

    let result = hits;
    service.redactSearchResults(hits).subscribe((value) => {
      result = value;
    });

    expect(result).toBe(hits);
    http.expectNone(() => true);
  });

  it('emits empty search results without making a redaction request', () => {
    let result: SearchResult[] | undefined;

    service.redactSearchResults([]).subscribe((value) => {
      result = value;
    });

    expect(result).toEqual([]);
    expect(viewer.resolveViewer).not.toHaveBeenCalled();
    http.expectNone(() => true);
  });

  it('replaces search snippets with role-redacted text', () => {
    const hits = [
      {
        reference: 'doc-1',
        title: 'Document',
        summary: 'Finance applications',
        database: 'KD',
        date: '',
        mimeType: '',
        author: '',
        weight: 1,
        fields: {}
      }
    ];

    let summary = '';
    service.redactSearchResults(hits).subscribe((value) => {
      summary = value[0].summary;
    });

    const request = http.expectOne(
      '/RedactionView/api/v1/redactions/snippet'
    );
    expect(request.request.body).toEqual({
      username: 'ada@demo.local',
      text: 'Finance applications'
    });
    request.flush({
      status: 'success',
      redactedText: 'Finance ************'
    });

    expect(summary).toBe('Finance ************');
  });

  it('redacts multiple search snippets in one API request', () => {
    const hits: SearchResult[] = [
      {
        reference: 'doc-1',
        title: 'Document 1',
        summary: 'Salary forecast',
        database: 'KD',
        date: '',
        mimeType: '',
        author: '',
        weight: 1,
        fields: {}
      },
      {
        reference: 'doc-2',
        title: 'Document 2',
        summary: 'Public guidance',
        database: 'KD',
        date: '',
        mimeType: '',
        author: '',
        weight: 1,
        fields: {}
      }
    ];

    let summaries: string[] = [];
    service.redactSearchResults(hits).subscribe((value) => {
      summaries = value.map((hit) => hit.summary);
    });

    const request = http.expectOne(
      '/RedactionView/api/v1/redactions/snippet'
    );
    const batchedText = request.request.body.text as string;
    expect(batchedText).toContain('Salary forecast');
    expect(batchedText).toContain('Public guidance');
    request.flush({
      status: 'success',
      redactedText: batchedText.replace(
        'Salary forecast',
        '[Redacted] [Redacted]'
      )
    });

    expect(summaries).toEqual([
      '[Redacted] [Redacted]',
      'Public guidance'
    ]);
  });
});
