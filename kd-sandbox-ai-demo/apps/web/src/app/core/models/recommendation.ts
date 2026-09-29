/** One weighted term from a Community user profile. */
export interface ProfileTerm {
  value: string;
  weight: number;
}

/** One Community profile for the signed-in user (Interest, Expertise, …). */
export interface CommunityProfile {
  id: string;
  name: string;
  namedArea?: string;
  /** Profile-level score when Community returns one. */
  weight: number;
  terms: ProfileTerm[];
}

/** Result of Community `ProfileClear` for the signed-in user. */
export interface ProfileClearResult {
  ok: boolean;
  /** User/profile was already gone — not treated as a hard failure. */
  alreadyAbsent: boolean;
  actionId: string;
  userName: string;
  pid?: string;
  message: string;
}

export interface ContentQueryRequest {
  text: string;
  maxResults: number;
  sort?: 'relevance' | 'date';
  print?: string;
  highlight?: boolean;
  summary?: boolean;
  summaryType?: string;
  characters?: number;
  minScore?: number;
  databases?: string[];
  fieldText?: string;
  minDate?: string;
  maxDate?: string;
}

export interface ContentQueryResponse {
  documents: RecommendedDocument[];
  totalHits: number;
  queryText: string;
}

export interface RecommendedDocument {
  reference: string;
  title?: string;
  summary?: string;
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface RecommendationsConfigFile {
  /**
   * Admin gate. When false, recommendations are unavailable: no Settings
   * controls, no header link, no home panel, and `/recommendations` redirects.
   * When true, Settings can still turn the feature Off for the session.
   */
  enabled?: boolean;
  /**
   * Default for the home (landing) panel. Session Settings can override.
   * Ignored when the feature itself is Off.
   */
  showOnHome?: boolean;
  maxTerms?: number;
  maxProfiles?: number;
  maxResultsPerProfile?: number;
  highlight?: boolean;
  minScore?: number;
  summary?: boolean;
  summaryType?: string;
  characters?: number;
  /**
   * DatabaseMatch values. Empty = all default-selected databases
   * from databases.json.
   */
  databases?: string[];
  fieldText?: string;
  minDate?: string;
  maxDate?: string;
  /** Optional Community NamedArea filter (e.g. Interest). Empty = all. */
  namedArea?: string;
}

export const DEFAULT_RECOMMENDATION_PARAMS = {
  maxTerms: 30,
  maxProfiles: 3,
  maxResultsPerProfile: 2,
  highlight: true,
  minScore: 0,
  summary: true,
  summaryType: 'Context',
  characters: 200
} as const;
