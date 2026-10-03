/**
 * Loaded from config/answer.json (synced to assets/config/answer.json).
 * Controls when free text is treated as an AnswerServer NLQA prompt.
 */
export interface AnswerConfigFile {
  $schema_comment?: string;
  /**
   * AnswerServer system(s) for Ask — sent as ACI `SystemNames`
   * (e.g. `Grok` or `Grok,Conversation`).
   */
  systemName?: string;
  /** Alias for systemName (preferred spelling in config). */
  systemNames?: string;
  /**
   * External LLM system added to `systemNames` (Settings -> Application).
   * The API key is stored only in config/answer.json, never in the served copy.
   */
  externalLlm?: { systemName?: string };
  /**
   * Conversation system for the AI chat page (`action=Converse`).
   * Demo: `KDChat`. Independent of Ask `systemNames` (Grok).
   */
  conversationSystemName?: string;
  /** Treat trailing `?` as a question. Default true. */
  detectTrailingQuestionMark?: boolean;
  /** Leading interrogatives: what, who, how, … */
  interrogatives?: string[];
  /**
   * Leading imperative / instructional verbs for RAG-style asks
   * without a trailing question mark: summarize, explain, …
   */
  imperatives?: string[];
  /** Allow optional "please " before an imperative. Default true. */
  allowPleasePrefix?: boolean;
  /** Verbs that form "tell me", "show me", … */
  meRequestVerbs?: string[];
  /** Verbs that form "can you", "could you", … */
  youRequestVerbs?: string[];
}
