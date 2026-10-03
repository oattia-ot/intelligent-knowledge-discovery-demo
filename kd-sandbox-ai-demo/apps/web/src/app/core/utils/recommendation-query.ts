import { ProfileTerm, RecommendedDocument } from '../models/recommendation';

/** IDOL GET Text stays well under typical proxy / ACI URL limits. */
export const MAX_WEIGHTED_QUERY_CHARS = 1800;

const WEIGHTED_TERM_RE = /(?:"([^"]+)"|(\S+))~\[(\d+)\]/g;

/** Keep the strongest weight when the same term appears more than once. */
export function uniqueProfileTerms(terms: readonly ProfileTerm[]): ProfileTerm[] {
  const map = new Map<string, ProfileTerm>();
  for (const term of terms) {
    const value = (term.value ?? '').trim();
    if (value.length < 2) {
      continue;
    }
    const weight = Number(term.weight);
    if (!Number.isFinite(weight) || weight <= 0) {
      continue;
    }
    const key = value.toLowerCase();
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { value, weight });
    } else if (weight > prev.weight) {
      prev.weight = weight;
    }
  }
  return [...map.values()];
}

export function selectTopTerms(
  terms: readonly ProfileTerm[],
  maxTerms: number
): ProfileTerm[] {
  const n = Number.isFinite(maxTerms) ? Math.max(0, Math.floor(maxTerms)) : 0;
  return uniqueProfileTerms(terms)
    .sort((a, b) => b.weight - a.weight || a.value.localeCompare(b.value))
    .slice(0, n);
}

export function formatWeightedTerm(term: ProfileTerm): string {
  const raw = (term.value ?? '').trim().replace(/"/g, '');
  const body = /[\s]/.test(raw) ? `"${raw}"` : raw;
  const weight = Math.round(Number(term.weight) || 0);
  return `${body}~[${weight}]`;
}

/**
 * Build `termA~[90] termB~[75]`. Drops lowest-weight terms if the string
 * would exceed `maxChars`.
 */
export function buildWeightedQuery(
  terms: readonly ProfileTerm[],
  maxChars = MAX_WEIGHTED_QUERY_CHARS
): string {
  const parts: string[] = [];
  let len = 0;
  for (const term of terms) {
    const part = formatWeightedTerm(term);
    if (!part.startsWith('"') && !part.split('~[')[0]) {
      continue;
    }
    const next = parts.length ? len + 1 + part.length : part.length;
    if (next > maxChars) {
      break;
    }
    parts.push(part);
    len = next;
  }
  return parts.join(' ');
}

export function parseWeightedTermString(raw: string): ProfileTerm[] {
  const terms: ProfileTerm[] = [];
  const text = raw ?? '';
  WEIGHTED_TERM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WEIGHTED_TERM_RE.exec(text))) {
    const value = (match[1] || match[2] || '').trim();
    const weight = parseInt(match[3] || '0', 10);
    if (value) {
      terms.push({ value, weight: Number.isFinite(weight) ? weight : 0 });
    }
  }
  return uniqueProfileTerms(terms);
}

export function normalizeDocumentReference(ref: string): string {
  const raw = (ref ?? '').trim();
  if (!raw) {
    return '';
  }
  try {
    return decodeURIComponent(raw).replace(/[\\/]+$/, '').toLowerCase();
  } catch {
    return raw.replace(/[\\/]+$/, '').toLowerCase();
  }
}

/** Keep the highest-scoring copy of each reference, then sort by score desc. */
export function dedupeByReference(
  docs: readonly RecommendedDocument[]
): RecommendedDocument[] {
  const map = new Map<string, RecommendedDocument>();
  for (const doc of docs) {
    const key = normalizeDocumentReference(doc.reference);
    if (!key) {
      continue;
    }
    const prev = map.get(key);
    if (!prev || (doc.score ?? 0) > (prev.score ?? 0)) {
      map.set(key, doc);
    }
  }
  return [...map.values()].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
