const AUTN_NS = 'http://schemas.autonomy.com/aci/';

const ROLE_LOCAL_NAMES = ['rolename', 'role'] as const;

/**
 * Collect Community role names from UserRead (`RoleList=true`) or
 * RoleUserGetRoleList XML. Tag shapes vary: `<autn:rolename>`,
 * `<autn:role>Name</autn:role>`, or `<autn:role><autn:name>…</autn:name>`.
 */
export function parseCommunityRoleNames(xmlText: string): string[] {
  const text = (xmlText ?? '').trim();
  if (!text || text.startsWith('<html') || text.includes('<HTML')) {
    return [];
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) {
    return [];
  }

  const status = (doc.querySelector('response')?.textContent ?? '')
    .trim()
    .toUpperCase();
  if (status && status !== 'SUCCESS') {
    return [];
  }

  const names = new Set<string>();
  const add = (value: string | null | undefined) => {
    const role = (value ?? '').trim();
    if (role) {
      names.add(role);
    }
  };

  for (const local of ROLE_LOCAL_NAMES) {
    const elements = [
      ...Array.from(doc.getElementsByTagNameNS(AUTN_NS, local)),
      ...Array.from(doc.getElementsByTagName(local))
    ];
    const seen = new Set<Element>();
    for (const el of elements) {
      if (seen.has(el)) {
        continue;
      }
      seen.add(el);
      const nested = [
        ...Array.from(el.getElementsByTagNameNS(AUTN_NS, 'name')),
        ...Array.from(el.getElementsByTagName('name')),
        ...Array.from(el.getElementsByTagNameNS(AUTN_NS, 'rolename')),
        ...Array.from(el.getElementsByTagName('rolename'))
      ].filter((child) => child !== el);
      if (nested.length) {
        for (const child of nested) {
          add(child.textContent);
        }
        continue;
      }
      if (!el.children.length) {
        add(el.textContent);
      }
    }
  }

  return [...names];
}

export function hasCommunityRole(
  roles: readonly string[] | null | undefined,
  roleName: string
): boolean {
  const wanted = roleName.trim().toLowerCase();
  if (!wanted) {
    return false;
  }
  return (roles ?? []).some((role) => role.trim().toLowerCase() === wanted);
}
