import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';

const USER_READ_XML = `<?xml version="1.0"?>
<autnresponse xmlns:autn="http://schemas.autonomy.com/aci/">
  <response>SUCCESS</response>
  <responsedata>
    <autn:authenticate>true</autn:authenticate>
    <autn:securityinfo>SEC_TOKEN</autn:securityinfo>
    <autn:roles>
      <autn:role>everyone</autn:role>
      <autn:rolename>KDUIAdmin</autn:rolename>
    </autn:roles>
  </responsedata>
</autnresponse>`;

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()]
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.clear();
  });

  it('stores Community roles from UserRead RoleList', () => {
    let userName = '';
    service.login('ada@demo.local', 'secret').subscribe((user) => {
      userName = user.username;
    });

    const request = http.expectOne(
      (candidate) =>
        candidate.url.includes('/community') ||
        candidate.url.includes('/Community')
    );
    expect(request.request.params.get('action')).toBe('UserRead');
    expect(request.request.params.get('RoleList')).toBe('true');
    request.flush(USER_READ_XML);

    expect(userName).toBe('ada@demo.local');
    expect(service.hasAdminRole()).toBe(true);
    expect(service.getUser()?.roles?.sort()).toEqual(
      ['everyone', 'KDUIAdmin'].sort()
    );
  });

  it('loads roles with RoleUserGetRoleList when UserRead omitted them', () => {
    const xml = `<?xml version="1.0"?>
      <autnresponse xmlns:autn="http://schemas.autonomy.com/aci/">
        <response>SUCCESS</response>
        <responsedata>
          <autn:authenticate>true</autn:authenticate>
          <autn:securityinfo>SEC_TOKEN</autn:securityinfo>
        </responsedata>
      </autnresponse>`;

    service.login('ada@demo.local', 'secret').subscribe();

    http
      .expectOne(
        (candidate) => candidate.params.get('action') === 'UserRead'
      )
      .flush(xml);

    const rolesReq = http.expectOne(
      (candidate) => candidate.params.get('action') === 'RoleUserGetRoleList'
    );
    expect(rolesReq.request.params.get('UserName')).toBe('ada@demo.local');
    rolesReq.flush(`<?xml version="1.0"?>
      <autnresponse xmlns:autn="http://schemas.autonomy.com/aci/">
        <response>SUCCESS</response>
        <responsedata>
          <autn:rolename>staff</autn:rolename>
        </responsedata>
      </autnresponse>`);

    expect(service.hasAdminRole()).toBe(false);
    expect(service.getUser()?.roles).toEqual(['staff']);
    expect(service.getUser()?.rolesLoaded).toBe(true);
  });
});
