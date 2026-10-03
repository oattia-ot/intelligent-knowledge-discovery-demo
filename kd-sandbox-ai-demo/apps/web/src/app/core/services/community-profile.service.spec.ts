import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { CommunityProfileService } from './community-profile.service';
import { AuthService } from './auth.service';

describe('CommunityProfileService', () => {
  let service: CommunityProfileService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        CommunityProfileService,
        {
          provide: AuthService,
          useValue: {
            getUser: () => ({ username: 'ada@demo.local', token: 'tok', stub: false }),
            getSecurityInfo: () => 'tok'
          }
        }
      ]
    });
    service = TestBed.inject(CommunityProfileService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('parses ProfileRead XML terms and weights', () => {
    const xml = `<?xml version="1.0"?>
      <autnresponse xmlns:autn="http://schemas.autonomy.com/aci/">
        <response>SUCCESS</response>
        <responsedata>
          <autn:hit>
            <autn:reference>1-P0.1</autn:reference>
            <autn:weight>80</autn:weight>
            <autn:title>Interest</autn:title>
            <autn:content>
              <DOCUMENT>
                <USERNAME>ada@demo.local</USERNAME>
                <TRAINING>vat~[90] tax~[40] vat~[20]</TRAINING>
                <NAMEDAREA>Interest</NAMEDAREA>
              </DOCUMENT>
            </autn:content>
            <autn:term>levy~[55]</autn:term>
          </autn:hit>
        </responsedata>
      </autnresponse>`;

    let profiles: ReturnType<CommunityProfileService['parseProfileRead']> = [];
    service.getCurrentUserProfiles().subscribe((p) => {
      profiles = p;
    });

    const req = http.expectOne((r) => r.url.includes('/community') || r.url.includes('/Community'));
    expect(req.request.params.get('action')).toBe('ProfileRead');
    expect(req.request.params.get('UserName')).toBe('ada@demo.local');
    expect(req.request.params.get('ShowTerms')).toBe('true');
    req.flush(xml);

    expect(profiles.length).toBe(1);
    expect(profiles[0].namedArea).toBe('Interest');
    expect(profiles[0].terms.map((t) => t.value).sort()).toEqual(['levy', 'tax', 'vat']);
    expect(profiles[0].terms.find((t) => t.value === 'vat')?.weight).toBe(90);
  });

  it('parses nested autn:term name/weight XML', () => {
    const xml = `<?xml version="1.0"?>
      <autnresponse xmlns:autn="http://schemas.autonomy.com/aci/">
        <response>SUCCESS</response>
        <responsedata>
          <autn:profile>
            <autn:name>Interest</autn:name>
            <autn:pid>9-P0.1</autn:pid>
            <autn:weight>12</autn:weight>
            <autn:term>
              <autn:name>schematic</autn:name>
              <autn:weight>88</autn:weight>
            </autn:term>
            <autn:term weight="70">pcb</autn:term>
          </autn:profile>
        </responsedata>
      </autnresponse>`;

    const profiles = service.parseProfileRead(xml, 'ada@demo.local');
    expect(profiles[0].id).toBe('9-P0.1');
    expect(profiles[0].terms).toEqual([
      { value: 'schematic', weight: 88 },
      { value: 'pcb', weight: 70 }
    ]);
  });

  it('returns an empty list when the user has no profile terms', () => {
    const xml = `<?xml version="1.0"?>
      <autnresponse><response>SUCCESS</response><responsedata></responsedata></autnresponse>`;
    expect(service.parseProfileRead(xml, 'ada@demo.local')).toEqual([]);
  });

  it('sends ProfileClear for the signed-in user with ActionID', () => {
    let result: { ok: boolean; userName: string; actionId: string } | undefined;
    service.clearCurrentUserProfile().subscribe((r) => {
      result = r;
    });

    const req = http.expectOne((r) => r.url.includes('/community') || r.url.includes('/Community'));
    expect(req.request.params.get('action')).toBe('ProfileClear');
    expect(req.request.params.get('UserName')).toBe('ada@demo.local');
    expect(req.request.params.get('PID')).toBeNull();
    expect(req.request.params.get('ActionID')).toMatch(/^KD_ProfileClear_/);
    req.flush(
      `<?xml version="1.0"?><autnresponse><response>SUCCESS</response><responsedata></responsedata></autnresponse>`
    );

    expect(result?.ok).toBe(true);
    expect(result?.userName).toBe('ada@demo.local');
  });

  it('sends PID when clearing a specific profile', () => {
    service.clearCurrentUserProfile('9-P0.1').subscribe();
    const req = http.expectOne((r) => r.url.includes('/community') || r.url.includes('/Community'));
    expect(req.request.params.get('PID')).toBe('9-P0.1');
    req.flush(
      `<?xml version="1.0"?><autnresponse><response>SUCCESS</response></autnresponse>`
    );
  });

  it('treats a missing profile as a non-fatal outcome', () => {
    const xml = `<?xml version="1.0"?>
      <autnresponse>
        <response>ERROR</response>
        <responsedata><errordescription>Profile not found</errordescription></responsedata>
      </autnresponse>`;
    const result = service.parseProfileClear(xml, 'ada@demo.local', 'aid-1');
    expect(result.ok).toBe(true);
    expect(result.alreadyAbsent).toBe(true);
  });
});
