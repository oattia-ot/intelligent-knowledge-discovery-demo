# AI test with Python

Create the ExecuteDocumentPython sample used to prove the IDOL NiFi 2
Python processor path.

Catalog id: `idol-ai-python`.  
Prompt: *Create an AI test with Python sample using ExecuteDocumentPython*.

## Steps

1. Sign in and open header **NiFi AI**.
2. Click **AI test with Python** in the sidebar (or paste the prompt
   and **Send**).
3. Review the plan in the thread. The group should include an
   `ExecuteDocumentPython` (or similarly named) processor.
4. Open the group in NiFi. Confirm the script / module path the
   template set.
5. Start the group and watch the Activity log plus NiFi bulletin
   board for Python runtime errors.

## Notes

- This is a **sample**, not a production enrichment pipeline.
- The orchestrator uses `create_ai_python_sample_flow` / the catalog
  recipe in `kd-nifi-ai-mcp/templates/`.
- Custom prompts can be saved with **+ Add template** (stored in the
  browser and posted to the orchestrator `templates/custom/` folder).

## Next

- [Create a sample NiFi flow](./nifi-ai-sample-flow.md)
- [Sources and grounded follow-ups](./ai-chat-sources-and-follow-ups.md)
