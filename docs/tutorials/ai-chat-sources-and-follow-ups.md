# Sources and grounded follow-ups

Read citations under an assistant turn and ask a question that stays
on those documents.

## Steps

1. From `/search`, run a question that returns an Answer panel, then
   **Continue in AI chat**.
2. In the assistant bubble, open the **sources** list (title +
   database). HTTP refs open in a new tab.
3. Ask a follow-up that only makes sense given those hits, for
   example: *What does the second source say about …?*
4. Click **Send**.
5. If the toolbar shows **Sources only**, the assistant is constrained
   to the locked refs from the previous turn.
6. Use **New conversation** when you want the whole catalog again.

## Grounding rules of thumb

- Prefer follow-ups that name a source title or a term from the snippet.
- If the model answers off-corpus, start a new conversation from a
  tighter document search.
- Previewing a hit in search still trains the Community profile; chat
  citations alone do not.

## Next

- [Use and train a Community profile](./community-profile.md)
