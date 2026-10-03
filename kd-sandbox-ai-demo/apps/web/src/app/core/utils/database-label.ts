/** User-facing database name. Keeps IDOL match values (e.g. KD) off the UI. */
export function databaseDisplayName(
  raw: string,
  databases: readonly { id?: string; databaseMatch?: string; label?: string }[] = []
): string {
  const n = (raw ?? '').trim();
  if (!n) {
    return '';
  }
  const db = databases.find(
    (d) => d.databaseMatch === n || d.id === n || d.label === n
  );
  if (db?.label?.trim()) {
    return db.label.trim();
  }
  if (/^KD$/i.test(n)) {
    return 'Files';
  }
  const stripped = n.replace(/^KD[_\s-]+/i, '').replace(/\s+/g, ' ').trim();
  return stripped || n;
}

export function databaseDisplayList(
  names: readonly string[],
  databases: readonly { id?: string; databaseMatch?: string; label?: string }[] = []
): string {
  return names
    .map((n) => databaseDisplayName(n, databases))
    .filter(Boolean)
    .join(', ');
}
