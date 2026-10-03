# Turn Experts on and search people

Experts is off by default. Turn it on, then search people by topic.

`expertise.json` must have `"enabled": true` or the feature is hidden
entirely (no Settings row, no Home pills, no header Experts).

## Steps

1. Sign in. Click header **Settings**.
2. Stay on **Business Configuration**.
3. Find **Experts**. Click the **On** pill (`.chip.op-btn`).
4. Close Settings. A header **Experts** pill appears, and Home shows
   **Documents** | **Experts** under the search box.
5. On Home, click **Experts**, type a topic (*tax policy*, *nifi*, …)
   and search.
6. Or click header **Experts** and use the Experts page search pill.
7. Results split into **Experts in “topic”** and **People like you**.

## Empty states

- *No profiles matched* — nobody’s Community terms overlap this topic
  yet. Preview documents in search so profiles gain terms.
- *No similar people yet* — your own `ProfileUser` is empty. See
  [Use and train a Community profile](./community-profile.md).

## Turn it off

Settings → Experts → **Off**. The header pill and Home kind row
disappear. `sessionStorage` key `fta_experts_search` remembers the
choice for this browser tab.
