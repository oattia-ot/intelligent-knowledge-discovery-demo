export type ResultUrlStrategy = 'field' | 'templateId' | 'none';

export type ResultUrlOpenIn = 'new_tab' | 'same_tab';

export interface ResultUrlRule {
  strategy: ResultUrlStrategy;
  /** strategy=field: use this hit field as the URL */
  field?: string;
  /** strategy=templateId: load assets/templates/result-url/{templateId}.hbs */
  templateId?: string;
  /** Field names exposed to Handlebars (and ensure Query returns them). */
  fields?: string[];
  openIn?: ResultUrlOpenIn;
  label?: string;
  /**
   * How the preview modal loads the document.
   * `url` — skip View and use the resolved result URL.
   * `view` — IDOL View (default).
   */
  preview?: 'view' | 'url';
  /**
   * When preview is `url`, whether to embed the page in an iframe.
   * Set false for sites that send X-Frame-Options / CSP.
   * Default true.
   */
  iframe?: boolean;
  fallback?: ResultUrlRule;
}

export interface ResultUrlsFile {
  default: ResultUrlRule;
  byDatabase?: Record<string, ResultUrlRule>;
}
