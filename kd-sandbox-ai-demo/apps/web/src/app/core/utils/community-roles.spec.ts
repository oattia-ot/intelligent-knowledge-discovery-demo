import { hasCommunityRole, parseCommunityRoleNames } from './community-roles';

describe('parseCommunityRoleNames', () => {
  it('reads autn:rolename and autn:role text from UserRead RoleList XML', () => {
    const xml = `<?xml version="1.0"?>
      <autnresponse xmlns:autn="http://schemas.autonomy.com/aci/">
        <response>SUCCESS</response>
        <responsedata>
          <autn:authenticate>true</autn:authenticate>
          <autn:roles>
            <autn:role>everyone</autn:role>
            <autn:rolename>KDUIAdmin</autn:rolename>
          </autn:roles>
        </responsedata>
      </autnresponse>`;

    expect(parseCommunityRoleNames(xml).sort()).toEqual(
      ['everyone', 'KDUIAdmin'].sort()
    );
  });

  it('reads nested role name elements from RoleUserGetRoleList', () => {
    const xml = `<?xml version="1.0"?>
      <autnresponse xmlns:autn="http://schemas.autonomy.com/aci/">
        <response>SUCCESS</response>
        <responsedata>
          <autn:role>
            <autn:name>KDUIAdmin</autn:name>
          </autn:role>
          <autn:role>
            <autn:name>staff</autn:name>
          </autn:role>
        </responsedata>
      </autnresponse>`;

    expect(parseCommunityRoleNames(xml)).toEqual(['KDUIAdmin', 'staff']);
  });

  it('returns an empty list on ACI errors', () => {
    const xml = `<autnresponse><response>ERROR</response>
      <errordescription>Not authorised</errordescription></autnresponse>`;
    expect(parseCommunityRoleNames(xml)).toEqual([]);
  });
});

describe('hasCommunityRole', () => {
  it('matches KDUIAdmin case-insensitively', () => {
    expect(hasCommunityRole(['everyone', 'kduIadmin'], 'KDUIAdmin')).toBe(true);
    expect(hasCommunityRole(['staff'], 'KDUIAdmin')).toBe(false);
    expect(hasCommunityRole(undefined, 'KDUIAdmin')).toBe(false);
  });
});
