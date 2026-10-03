export interface ParametricFieldConfig {
  id: string;
  idolField: string;
  /** Name used in FieldText MATCH{…}:name (defaults to last segment of idolField). */
  fieldTextName?: string;
  label: string;
  multiSelect?: boolean;
  v1?: boolean;
  /** When false, keep the field in config but do not render it. Default true. */
  show?: boolean;
  /** Lower numbers appear first in Refine by. Omitted order sorts last. */
  order?: number;
  notes?: string;
}

export interface ParametricFiltersFile {
  fields: ParametricFieldConfig[];
}
