import { Pipe, PipeTransform } from '@angular/core';
import { markdownToHtml } from '../../core/utils/chat-format';

/**
 * Convert Answer Server / LLM markdown to HTML.
 * Always converts remaining **bold** / lists even when a wrapper div is present.
 * Bind with [innerHTML] so Angular's sanitizer strips scripts / unsafe URLs.
 */
@Pipe({
  name: 'markdown',
  standalone: true
})
export class MarkdownPipe implements PipeTransform {
  transform(value: string | null | undefined): string {
    return markdownToHtml(value ?? '');
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
