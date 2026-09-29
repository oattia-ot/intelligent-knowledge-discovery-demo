import { environment } from '../../../environments/environment';

/** Append `?v=<configVersion>` so a config-only deploy cannot reuse a cached URL. */
export function cacheBustedAsset(path: string): string {
  const version = environment.configVersion?.trim();
  if (!version) {
    return path;
  }
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}v=${encodeURIComponent(version)}`;
}
