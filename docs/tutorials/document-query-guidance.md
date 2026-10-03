# Document query guidance

Search IDOL Content from Home and read results.

## Steps

1. Sign in. Click header **Home** if you are not already on `/home`.
2. If the Documents / Experts pills are visible, select **Documents**.
3. Type a term or a natural-language question. Suggestions appear
   under the box; arrow keys + Enter accept one.
4. Submit with Enter or the magnifier.
5. On `/search`:
   - Use facets on the side to narrow databases / fields.
   - Open a hit to preview (View). Preview is what trains
     `ProfileUser` — there is no separate “create profile” form.
   - Use the Answer panel actions to jump into AI Chat.
6. Settings → Business Configuration controls the concept
   **operator** (AND / OR / NEAR family) and **summary** type/length.
   Those chips are `.chip.op-btn` pills, same radius as NiFi AI.

## Query tips

- Several concepts: keep **AND** unless you want a broader **OR**.
- Trailing `?` favors the Answer panel.
- An empty / wildcard query can list documents when the server allows
  it — use facets immediately.

## Next

- [Start from a document search](./ai-chat-from-document-search.md)
- [Turn Experts on and search people](./experts-on-and-search.md)
