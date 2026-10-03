import { marked } from 'marked';
import {
  AnswerSource,
  fallbackTitleFromReference,
  isUsableSourceTitle
} from '../services/answer.service';

const MARKDOWN_TOKEN =
  /(\*\*[^*]+\*\*|__[^_]+__|(^|\n)\s{0,3}#{1,6}\s|(^|\n)\s{0,3}[-*+]\s|(^|\n)\s{0,3}\d+\.\s|`[^`]+`)/;

/** True when the string still contains markdown that should be converted. */
export function hasMarkdownTokens(text: string): boolean {
  return MARKDOWN_TOKEN.test(text ?? '');
}

/**
 * True when the payload is already structured HTML we should not flatten.
 * A lone KDChat wrapper <div style="font-family…"> around markdown is NOT
 * "already HTML" — that is the case that previously skipped marked.
 */
export function isMostlyHtml(text: string): boolean {
  const t = unwrapKdchatWrapper(text ?? '').trim();
  if (!t || !/<[a-zA-Z][\s\S]*>/.test(t)) {
    return false;
  }
  if (hasMarkdownTokens(t)) {
    return false;
  }
  const tags = t.match(/<\/?[a-zA-Z][^>]*>/g) || [];
  return tags.length >= 2;
}

/** Peel the KDChat font-family wrapper so markdown inside can be parsed. */
export function unwrapKdchatWrapper(text: string): string {
  const t = (text ?? '').trim();
  const wrapped = t.match(
    /^<div\b[^>]*style\s*=\s*['"][^'"]*font-family[^'"]*['"][^>]*>([\s\S]*)<\/div>\s*$/i
  );
  if (wrapped) {
    return wrapped[1].trim();
  }
  return t;
}

/** Unwrap ```html ... ``` (and similar) so the markup is rendered, not shown as code. */
export function unwrapHtmlFences(text: string): string {
  let out = text ?? '';
  out = out.replace(/```(?:html|xml|htm)\s*\r?\n?([\s\S]*?)```/gi, '$1');
  out = out.replace(/```\s*\r?\n?(<\/?[a-zA-Z][\s\S]*?>[\s\S]*?)```/g, '$1');
  return out.trim();
}

/** If the whole payload is entity-escaped HTML (`&lt;div&gt;…`), unescape once. */
export function unescapeIfEscapedHtml(text: string): string {
  const t = (text ?? '').trim();
  if (!t) {
    return t;
  }
  const escapedTags = (t.match(/&lt;\/?[a-zA-Z]/gi) || []).length;
  const realTags = (t.match(/<\/?[a-zA-Z]/g) || []).length;
  if (escapedTags >= 2 && escapedTags > realTags) {
    return t
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }
  return t;
}

export function displayTitle(src: AnswerSource): string {
  if (isUsableSourceTitle(src.title, src.ref)) {
    return src.title.trim();
  }
  return fallbackTitleFromReference(src.ref);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = (v ?? '').trim();
    if (!t || seen.has(t)) {
      continue;
    }
    seen.add(t);
    out.push(t);
  }
  return out;
}

function titledLink(src: AnswerSource): string {
  const ref = (src.ref || '').trim();
  const title = displayTitle(src);
  if (ref.startsWith('http')) {
    return `<a href="${escapeAttr(ref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(title)}</a>`;
  }
  return `<span>${escapeHtml(title)}</span>`;
}

/**
 * Replace DREREFERENCE / URL occurrences (bare or already linked) with the
 * document title. Existing <a href="ref">…</a> keep the href, change the label.
 */
export function replaceReferencesWithTitles(html: string, sources: AnswerSource[]): string {
  let out = html ?? '';
  const list = (sources ?? []).filter((s) => (s.ref || '').trim());
  // Longest refs first so a prefix of another ref is not replaced first.
  list.sort((a, b) => b.ref.length - a.ref.length);

  for (const src of list) {
    const ref = src.ref.trim();
    const variants = unique([ref, safeDecode(ref)]);
    for (const variant of variants) {
      const reLink = new RegExp(
        `<a\\b[^>]*href=["']${escapeRegExp(variant)}["'][^>]*>[\\s\\S]*?<\\/a>`,
        'gi'
      );
      out = out.replace(reLink, titledLink(src));
      const reBare = new RegExp(escapeRegExp(variant), 'g');
      out = out.replace(reBare, titledLink(src));
    }
  }

  // Collapse accidental nested anchors from a second pass.
  out = out.replace(/<a\b[^>]*>\s*(<a\b[^>]*>[\s\S]*?<\/a>)\s*<\/a>/gi, '$1');
  return out;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function stripChatChrome(html: string): string {
  const t = html ?? '';
  return t
    .replace(/<p[^>]*>\s*Searched:[\s\S]*?<\/p>/gi, '')
    .replace(/<div[^>]*>\s*Searched:[\s\S]*?<\/div>/gi, '')
    .trim();
}

/** Prepare assistant text: unwrap HTML fences, unescape, drop KDChat chrome. */
export function prepareAssistantText(raw: string): string {
  let text = (raw ?? '').trim();
  if (!text) {
    return '';
  }
  text = unwrapHtmlFences(text);
  text = unescapeIfEscapedHtml(text);
  text = unwrapKdchatWrapper(text);
  text = stripChatChrome(text);
  return text.trim();
}

/** Convert leftover **bold** / *em* that marked skipped inside HTML blocks. */
export function convertInlineMarkdown(html: string): string {
  return (html ?? '')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^A-Za-z0-9*])\*([^*\n]+)\*(?![A-Za-z0-9*])/g, '$1<em>$2</em>');
}

/**
 * Always turn model markdown into HTML.
 * Wrapper divs / a few leftover tags must not skip conversion.
 */
export function markdownToHtml(raw: string): string {
  let text = prepareAssistantText(raw);
  if (!text) {
    return '';
  }
  if (hasMarkdownTokens(text)) {
    try {
      text = String(marked.parse(text, { async: false, gfm: true, breaks: true }));
    } catch {
      text = text.replace(/\n/g, '<br>');
    }
  }
  return convertInlineMarkdown(text);
}
