# Button layout

Operational actions use the same pill as the NiFi AI header control:
icon + label (when there is an icon), `border-radius: 999px`,
`.hdr-btn` in the navy header and `.op-btn` on light surfaces.

## Header (left → right)

| Control | When it appears | Class |
|---------|-----------------|-------|
| **Home** | Signed in | `.hdr-btn` (left of the logo) |
| Logo / title | Always | brand group |
| **Experts** | Settings → Experts is **On** and `expertise.json` has `"enabled": true` | `.hdr-btn` |
| **Recommendations** | Settings → Recommendations is **On** | `.hdr-btn` |
| **NiFi AI** | `nifi-ai.json` `"enabled": true` | `.hdr-btn` |
| **AI Chat** | Signed in | `.hdr-btn` |
| **Admin** | Signed-in user has an admin Community role | `.hdr-btn` |
| **Settings** | Always (also on the login screen) | `.hdr-btn` |
| **Sign out** | Signed in | `.hdr-btn.hdr-btn--emphasis` |

NiFi AI overlay chrome (Home, Connection, dialog Close / Test, template
Cancel / Save, Activity Clear / Close) uses the same pill in
`kd-nifi-ai-mcp/ui/index.html` (`.app-btn`).

## In-page `.op-btn` actions

| Surface | Controls |
|---------|----------|
| Home | **Documents** / **Experts** search-kind pills |
| Experts | **Search** |
| Search answer panel | **Continue in AI chat**, **New conversation** |
| AI Chat | **New conversation**, **Send** |
| Settings | On / Off chips and other `.chip.op-btn` rows (operator, summary, Recommendations, Experts) |

Do not introduce a third button radius. If you add an action, give it
`.hdr-btn` (header) or `.op-btn` (page).
