/** One Community user field shown on an expert card. */
export interface ExpertField {
  name: string;
  label: string;
  value: string;
  href?: string;
}

/** One person surfaced from Community profiles or Agentstore Profile Query. */
export interface ExpertPerson {
  username: string;
  displayName: string;
  email: string;
  /** Shared / matching concepts (Title Case stems). */
  terms: string[];
  /** Best IDOL hit weight (0–100). */
  weight: number;
  profileRef: string;
  isSelf?: boolean;
  /** Extra Community UserRead fields (telephone, …). */
  fields?: ExpertField[];
}
