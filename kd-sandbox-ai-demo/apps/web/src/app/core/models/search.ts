export interface SearchResult {
  reference: string;
  title: string;
  summary: string;
  database: string;
  date: string;
  mimeType: string;
  author: string;
  weight: number;
  /** IDOL hit id (`autn:id`) for Community ProfileUser. */
  idolId?: string;
  /** Flattened IDOL fields for templates (upper-case keys preferred). */
  fields: Record<string, string>;
  /** Resolved open URL from result-urls.json + Handlebars (if any). */
  url?: string | null;
  /** Link target from config. */
  urlOpenIn?: 'new_tab' | 'same_tab';
  /** Optional link label from config. */
  urlLabel?: string;
}

export interface SearchResponse {
  hits: SearchResult[];
  totalHits: number;
  numHits: number;
  queryText: string;
  start: number;
  pageSize: number;
}

export interface SearchRequest {
  queryText: string;
  databases: string[];
  start?: number;
  pageSize?: number;
  /** IDOL FieldText expression (e.g. MATCH{PDF}:PART_MIMETYPE AND …). */
  fieldText?: string;
}

export interface FacetValue {
  value: string;
  count: number;
}

export interface FacetField {
  /** Config id (e.g. mime). */
  id: string;
  /** Full parametric path DOCUMENT/… */
  idolField: string;
  /** Short name for FieldText MATCH. */
  fieldTextName: string;
  label: string;
  multiSelect: boolean;
  values: FacetValue[];
  /** MATCH for parametric tag values; STRING for Query-sampled stored fields. */
  fieldTextOperator?: 'MATCH' | 'STRING';
}

export interface FacetRequest {
  queryText: string;
  databases: string[];
  /** Optional FieldText so facet counts respect other active filters. */
  fieldText?: string;
  /** idolField paths to request (from parametric-filters.json). */
  idolFields: string[];
}
