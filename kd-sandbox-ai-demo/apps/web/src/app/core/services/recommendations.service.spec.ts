import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { RecommendationsService } from './recommendations.service';
import { CommunityProfileService } from './community-profile.service';
import { ContentSearchService } from './content-search.service';
import { ConfigService } from './config.service';
import { AuthService } from './auth.service';
import { SnippetRedactionService } from './snippet-redaction.service';
import { CommunityProfile, RecommendedDocument } from '../models/recommendation';

describe('RecommendationsService', () => {
  let service: RecommendationsService;
  let profiles: { getCurrentUserProfiles: ReturnType<typeof vi.fn> };
  let content: { query: ReturnType<typeof vi.fn> };
  let snippetRedaction: {
    redactRecommendations: ReturnType<typeof vi.fn>;
  };

  const profile: CommunityProfile = {
    id: '1-P0.1',
    name: 'Interest',
    weight: 80,
    terms: [
      { value: 'vat', weight: 90 },
      { value: 'tax', weight: 40 },
      { value: 'vat', weight: 20 }
    ]
  };

  beforeEach(() => {
    profiles = {
      getCurrentUserProfiles: vi.fn(() => of([profile]))
    };
    content = {
      query: vi.fn(() =>
        of({
          documents: [
            { reference: 'doc-a', title: 'A', score: 70 },
            { reference: 'doc-b', title: 'B', score: 60 }
          ] as RecommendedDocument[],
          totalHits: 2,
          queryText: 'vat~[90] tax~[40]'
        })
      )
    };
    snippetRedaction = {
      redactRecommendations: vi.fn((documents: RecommendedDocument[]) => of(documents))
    };

    TestBed.configureTestingModule({
      providers: [
        RecommendationsService,
        { provide: CommunityProfileService, useValue: profiles },
        { provide: ContentSearchService, useValue: content },
        {
          provide: ConfigService,
          useValue: {
            getRecommendationsConfig: () =>
              of({
                maxTerms: 30,
                maxProfiles: 3,
                maxResultsPerProfile: 2,
                highlight: true,
                summary: true
              }),
            getDatabases: () =>
              of({
                defaultScope: 'all',
                databases: [
                  { id: 'CAD', databaseMatch: 'CAD', label: 'CAD', defaultSelected: true }
                ]
              })
          }
        },
        {
          provide: AuthService,
          useValue: {
            getUser: () => ({ username: 'ada@demo.local', token: 'tok', stub: false })
          }
        },
        {
          provide: SnippetRedactionService,
          useValue: snippetRedaction
        }
      ]
    });
    service = TestBed.inject(RecommendationsService);
  });

  it('builds a weighted Content query from the top profile terms', () => {
    let docs: RecommendedDocument[] = [];
    service.getRecommendations().subscribe((r) => {
      docs = r.documents;
    });

    expect(content.query).toHaveBeenCalledTimes(1);
    const req = content.query.mock.calls[0][0];
    expect(req.text).toBe('vat~[90] tax~[40]');
    expect(req.maxResults).toBe(2);
    expect(req.sort).toBe('relevance');
    expect(req.databases).toEqual(['CAD']);
    expect(docs.map((d) => d.reference)).toEqual(['doc-a', 'doc-b']);
  });

  it('returns an empty list when the profile has no terms', () => {
    profiles.getCurrentUserProfiles.mockReturnValue(
      of([{ id: 'x', name: 'x', weight: 0, terms: [] }])
    );
    service.clearCache();
    let result = { documents: [{ reference: 'x' }], noProfileTerms: false };
    service.getRecommendations(true).subscribe((r) => {
      result = r;
    });
    expect(content.query).not.toHaveBeenCalled();
    expect(result.documents).toEqual([]);
    expect(result.noProfileTerms).toBe(true);
  });

  it('dedupes the same reference from multiple profiles', () => {
    profiles.getCurrentUserProfiles.mockReturnValue(
      of([
        profile,
        {
          id: '2-P0.1',
          name: 'Expertise',
          weight: 50,
          terms: [{ value: 'levy', weight: 70 }]
        }
      ])
    );
    content.query.mockImplementation((req: { text: string }) =>
      of({
        documents: [{ reference: 'shared', title: req.text, score: req.text.includes('levy') ? 99 : 10 }],
        totalHits: 1,
        queryText: req.text
      })
    );
    service.clearCache();
    let docs: RecommendedDocument[] = [];
    service.getRecommendations(true).subscribe((r) => {
      docs = r.documents;
    });
    expect(content.query).toHaveBeenCalledTimes(2);
    expect(docs).toHaveLength(1);
    expect(docs[0].score).toBe(99);
  });

  it('surfaces a Content error when every profile query fails', () => {
    content.query.mockReturnValue(throwError(() => new Error('Content down')));
    service.clearCache();
    let err: Error | undefined;
    service.getRecommendations(true).subscribe({
      error: (e: Error) => {
        err = e;
      }
    });
    expect(err?.message).toBe('Content down');
  });

  it('reuses the in-memory result so rerenders do not refetch', () => {
    service.getRecommendations().subscribe();
    service.getRecommendations().subscribe();
    expect(content.query).toHaveBeenCalledTimes(1);
    expect(snippetRedaction.redactRecommendations).toHaveBeenCalledTimes(2);
  });
});
