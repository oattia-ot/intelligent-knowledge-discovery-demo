# Milestone 15 — My Recommendations + searchable Settings

Intelligent Knowledge Discovery Demo can recommend documents from the signed-in user’s Knowledge Discovery **profile terms**, and all **session** settings live on a dedicated **`/settings`** page that can be searched. Deployment document-viewer settings later moved to **`/admin`** (M16).

**Date:** 26/08/2026  
**Requirements:** `recommendation.md` (Find-style: Community profile → weighted Content Query → dedupe). Settings overflowed the header dropdown, so ⚙ now opens a full page.

## What shipped

### My Recommendations

Find-style flow, **no middle-tier API**, **no QMS** on this path:

1. Community `ProfileRead` + `ShowTerms=true` for the signed-in user.
2. Sort terms by weight; take top N (`maxTerms`, default 30); drop duplicate terms (keep strongest weight).
3. Build Text like `vat~[90] tax~[75]`.
4. Content `action=Query` (relevance, Summary, Highlight, SecurityInfo, `ResponseFormat=simplejson`).
5. Up to `maxProfiles` (default 3) profiles × `maxResultsPerProfile` (default 2); merge and **dedupe by `DREREFERENCE`**.
6. UI: loading, empty (no profile vs no hits), Community/Content errors.

| Surface | Behaviour |
|---------|-----------|
| Home | **My Recommendations** panel under the search box (optional; see Settings) |
| Header | Star icon (**My Recommendations**); hidden when the feature is Off |
| `/recommendations` | Full page; auth + `recommendationsEnabledGuard` |

Preview / download / open-source match search cards. Preview still trains via Community `ProfileUser` when Experts search is on.

**Back:** from search results → header Recommendations → **← Back to search results** (same `/search?q=…`). From home → **← Back to search home**. Direct visit uses last search in the session if present.

### Header icons

Next to Sign out, authenticated chrome is icon-only (tooltip + `aria-label`):

| Icon | Goes to |
|------|---------|
| Star | `/recommendations` (if Recommendations is On) |
| Chat bubble | `/chat` (AI chat) |
| ⚙ | `/settings` |

### Settings (`/settings`)

Header **⚙** opens **`/settings`**, not a dropdown.

| Section | What it controls |
|---------|------------------|
| Join concepts with | AND / OR / YNEAR / WNEAR / DNEAR / NEAR |
| Summary type | Context / Concept / Quick / Paragraph / Sentence / Off |
| Summary length | 50–800 characters |
| Troubleshooting | Last QMS **Expanded query** |
| Recommendations | App-wide On/Off; **Show on home** On/Off |
| Experts search | On/Off (hidden if `expertise.json` `"enabled": false`) |
| My profile | Opens `/settings/profiles` — search terms, expand table, delete (`ProfileClear`) |

**Find a setting…** filters sections by title, hint, and keywords (e.g. `NEAR`, `summary`, `home`). The filter is in the URL (`/settings?q=summary`). Back from Settings returns to search results when that is where you came from.

### Profile settings (`/settings/profiles`)

Dedicated sub-page from **Settings → Open profile settings**:

- Search by **term**, profile name, or PID (`?q=`). Matching profiles expand; matching term rows are highlighted.
- Expand a profile to a **# / Term / Weight** table (strongest first) before delete.
- **Delete** one profile (`PID`) or **Delete my profile** (all). Confirm names the signed-in user. Community `ProfileClear` only — not `UserDelete`.
- **← Back to settings**.

Session values stay in `sessionStorage` via `ConceptSearchSettingsService` (same keys as the old dropdown). Search still re-queries when operator / summary change after you return to results.

### Config (`config/recommendations.json`)

| Key | Default | Role |
|-----|---------|------|
| `enabled` | `true` | Admin gate. `false` hides recs everywhere, including Settings controls |
| `showOnHome` | `true` | Default for the home panel until the user overrides it |
| `maxTerms` | `30` | Top weighted profile terms |
| `maxProfiles` | `3` | Profiles to query |
| `maxResultsPerProfile` | `2` | Hits per profile |
| `highlight` / `summary` / `minScore` | true / true / 0 | Content Query |
| `databases` | `[]` | Empty = all default-selected DBs |

Copied to `apps/web/src/assets/config/` by `sync-config.sh`.

## Architecture (Angular → Nginx proxy only)

```
GET /Community/?action=ProfileRead&UserName=…&ShowTerms=true
GET /Content/?action=Query&Text=vat~[90] tax~[75]
  &DatabaseMatch=…
  &Print=Fields&PrintFields=…
  &MaxResults=2
  &Summary=Context&Characters=200
  &Highlight=SummaryTerms
  &SecurityInfo=…
  &ResponseFormat=simplejson
```

| Piece | Location |
|-------|----------|
| Models | `apps/web/src/app/core/models/recommendation.ts` |
| Community | `community-profile.service.ts` |
| Content | `content-search.service.ts` |
| Orchestration | `recommendations.service.ts` |
| Query helpers | `core/utils/recommendation-query.ts` |
| UI | `features/recommendations/my-recommendations.component.*` |
| Settings page | `features/settings/settings.component.*` |
| Profile settings | `features/settings/settings-profiles.component.*` |
| Guard | `recommendations-enabled.guard.ts` |
| Last search URL | `search-init.service.ts` (`kd_last_search_url`) |

ADR: [ADR-021](./DECISIONS.md), [ADR-022](./DECISIONS.md), [ADR-023](./DECISIONS.md).

## How to demo

1. Sign in. Preview a few search results (trains Community `ProfileUser` if Experts is On).
2. Open **home** — **My Recommendations** cards, or the header **star**.
3. From a results page, open the star, then **← Back to search results**.
4. Header **⚙** → **Settings**. Type `recommend` or `summary`. Toggle **Recommendations** Off — star and home panel disappear; `/recommendations` redirects home. **Show on home** Off keeps the page/star only.
5. Empty profile: a user who has never previewed documents sees the empty-state copy (not an error).
6. **Settings → Open profile settings** (`/settings/profiles`). Search a term (e.g. `vat`); expand the table; confirm delete. Recommendations empty until you preview documents again. Sign-in still works.

## Out of scope (unchanged)

- New backend / static recommendation feed.
- QMS ExpandQuery on the recommendation Query (Content only).
- Persisting prefs in Community (still sessionStorage; M10).
