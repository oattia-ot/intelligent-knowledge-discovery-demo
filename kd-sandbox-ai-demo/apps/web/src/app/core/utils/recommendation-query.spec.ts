import {
  buildWeightedQuery,
  dedupeByReference,
  formatWeightedTerm,
  parseWeightedTermString,
  selectTopTerms,
  uniqueProfileTerms
} from './recommendation-query';
import { RecommendedDocument } from '../models/recommendation';

describe('recommendation-query', () => {
  it('keeps the strongest weight for duplicate terms', () => {
    const terms = uniqueProfileTerms([
      { value: 'VAT', weight: 40 },
      { value: 'vat', weight: 90 },
      { value: 'tax', weight: 10 },
      { value: 'x', weight: 99 },
      { value: 'zero', weight: 0 }
    ]);
    expect(terms).toEqual([
      { value: 'VAT', weight: 90 },
      { value: 'tax', weight: 10 }
    ]);
  });

  it('selects top N terms by descending weight', () => {
    const top = selectTopTerms(
      [
        { value: 'levy', weight: 10 },
        { value: 'vat', weight: 90 },
        { value: 'tax', weight: 75 }
      ],
      2
    );
    expect(top.map((t) => t.value)).toEqual(['vat', 'tax']);
  });

  it('builds a weighted query string', () => {
    const q = buildWeightedQuery([
      { value: 'vat', weight: 90 },
      { value: 'value added tax', weight: 75 },
      { value: 'tax', weight: 60 }
    ]);
    expect(q).toBe('vat~[90] "value added tax"~[75] tax~[60]');
  });

  it('quotes multi-word terms and drops extras when the query is too long', () => {
    const terms = Array.from({ length: 40 }, (_, i) => ({
      value: `term${i}withpadding`,
      weight: 100 - i
    }));
    const q = buildWeightedQuery(terms, 80);
    expect(q.length).toBeLessThanOrEqual(80);
    expect(q.startsWith('term0withpadding~[100]')).toBe(true);
    expect(q.includes('term39withpadding')).toBe(false);
  });

  it('parses TRAINING-style weighted terms', () => {
    const terms = parseWeightedTermString('VAT~[90] "value added"~[75] tax~[12]');
    expect(terms).toEqual([
      { value: 'VAT', weight: 90 },
      { value: 'value added', weight: 75 },
      { value: 'tax', weight: 12 }
    ]);
  });

  it('dedupes documents by reference and keeps the highest score', () => {
    const docs: RecommendedDocument[] = [
      { reference: 'A/doc', title: 'first', score: 40 },
      { reference: 'a/doc', title: 'better', score: 80 },
      { reference: 'B', title: 'other', score: 50 },
      { reference: '', title: 'skip', score: 99 }
    ];
    const out = dedupeByReference(docs);
    expect(out.map((d) => d.title)).toEqual(['better', 'other']);
    expect(out[0].score).toBe(80);
  });

  it('formats a single weighted term', () => {
    expect(formatWeightedTerm({ value: 'vat', weight: 90.4 })).toBe('vat~[90]');
  });
});
