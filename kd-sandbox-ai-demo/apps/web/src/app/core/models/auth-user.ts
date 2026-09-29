export interface AuthUser {
  username: string;
  /** Community SecurityInfo token; empty in stub or unsecured Community sessions. */
  token: string;
  /** True when session was created without Community (shell only). */
  stub?: boolean;
  /**
   * True when Community authenticated the user but did not mint a SecurityInfo
   * token (common on sandbox Community with no security keys). Search still
   * runs; Content/View calls omit SecurityInfo.
   */
  unsecured?: boolean;
  /**
   * Community role names from UserRead `RoleList=true` or
   * `RoleUserGetRoleList`. Compared case-insensitively.
   */
  roles?: string[];
  /** True once roles were read (including an empty list). */
  rolesLoaded?: boolean;
}
