import { AnswerSource } from '../services/answer.service';

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** When true, render with the markdown pipe; otherwise treat as HTML/plain. */
  markdown?: boolean;
  sources?: AnswerSource[];
  createdAt: number;
}

export interface ChatSeed {
  question: string;
  answerText: string;
  sources: AnswerSource[];
  databases: string[];
  returnUrl?: string;
}

export interface ChatPersistedState {
  sessionId: string;
  systemName: string;
  messages: ChatMessage[];
  databases: string[];
  /** DREREFERENCEs locked when continuing from an Answer panel. */
  lockedRefs: string[];
  continuedFromSearch: boolean;
  returnUrl?: string;
}

export interface ChatLaunch {
  mode: 'continue' | 'new';
  seed?: ChatSeed;
}
