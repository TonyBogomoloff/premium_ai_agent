import { AppError } from './auth.mjs';
const marks = new Set(['bold', 'italic', 'underline', 'strike', 'spoiler', 'code', 'link']);
const telegramMarks = { strike: 'strikethrough' };

export function compileDocument(doc, lookup, { allowEmpty = false, maxLength = 4096 } = {}) {
  if (doc?.type !== 'doc' || !Array.isArray(doc.content) || doc.content.length > 512) throw new AppError(400, 'Некорректное сообщение.');
  let text = '', emojiCount = 0; const entities = [];
  for (const [index, paragraph] of doc.content.entries()) {
    if (!['paragraph', 'codeBlock'].includes(paragraph.type) || (paragraph.content && !Array.isArray(paragraph.content))) throw new AppError(400, 'Неподдерживаемый формат сообщения.');
    if (index) text += '\n';
    const blockStart = text.length;
    const pre = paragraph.type === 'codeBlock';
    const quote = paragraph.attrs?.quote;
    if (quote && !['blockquote', 'expandable'].includes(quote)) throw new AppError(400, 'Некорректная цитата.');
    for (const node of paragraph.content || []) {
      const offset = text.length;
      if (pre && node.type !== 'text') throw new AppError(400, 'В блоке кода допустим только текст.');
      if (node.type === 'text' && typeof node.text === 'string') text += node.text;
      else if (node.type === 'hardBreak') text += '\n';
      else if (node.type === 'customEmoji') {
        const id = String(node.attrs?.id || ''); const emoji = lookup(id);
        if (!emoji || !/^\d+$/.test(id)) throw new AppError(400, 'Эмодзи больше нет в каталоге. Добавь его набор заново.');
        text += emoji.alt;
        entities.push({ type: 'custom_emoji', offset, length: emoji.alt.length, custom_emoji_id: id });
        emojiCount++;
      } else throw new AppError(400, 'Неподдерживаемый фрагмент сообщения.');
      if (node.marks && (!Array.isArray(node.marks) || node.marks.length > 7)) throw new AppError(400, 'Некорректное оформление.');
      const nodeMarks = node.marks || [];
      if ((pre && nodeMarks.length) || (nodeMarks.some(m => m.type === 'code') && (nodeMarks.length > 1 || node.type !== 'text'))) throw new AppError(400, 'Код нельзя совмещать с другим оформлением.');
      for (const mark of nodeMarks) {
        if (!marks.has(mark.type)) throw new AppError(400, 'Неподдерживаемое оформление.');
        const extra = {};
        if (mark.type === 'link') {
          try { const url = new URL(mark.attrs?.href); if (!['http:', 'https:'].includes(url.protocol)) throw Error(); extra.url = url.href; } catch { throw new AppError(400, 'Некорректная ссылка.'); }
        }
        if (text.length > offset) entities.push({ type: mark.type === 'link' ? 'text_link' : telegramMarks[mark.type] || mark.type, offset, length: text.length - offset, ...extra });
      }
      if (text.length > 4096 || emojiCount > 100) throw new AppError(400, 'Максимум 4096 символов и 100 премиум-эмодзи в сообщении.');
    }
    if (text.length > blockStart && (pre || quote)) entities.push({ type: pre ? 'pre' : quote === 'expandable' ? 'expandable_blockquote' : 'blockquote', offset: blockStart, length: text.length - blockStart });
  }
  if (text.length > 4096) throw new AppError(400, 'Максимум 4096 символов.');
  if (text.length > maxLength) throw new AppError(400, `Максимум ${maxLength} символов в подписи.`);
  if (!allowEmpty && !text.trim()) throw new AppError(400, 'Сначала напиши сообщение.');
  return { text, entities: entities.sort((a, b) => a.offset - b.offset || b.length - a.length), emojiCount };
}

// Telegram can accept a message while dropping custom emoji entities.
// Keep only counts in the receipt; never retain the message text or emoji IDs.
export function verifyCustomEmoji(compiled, message) {
  const expected = compiled.entities.filter(e => e.type === 'custom_emoji');
  const actual = (message.entities || []).filter(e => e.type === 'custom_emoji');
  const start = typeof message.text === 'string' && message.text.length ? compiled.text.indexOf(message.text) : -1;
  const sameText = start >= 0 && !compiled.text.slice(0, start).trim() && !compiled.text.slice(start + message.text.length).trim();
  const remaining = [...actual];
  let confirmed = 0;
  if (sameText) for (const e of expected) {
    const index = remaining.findIndex(a => a.custom_emoji_id === e.custom_emoji_id && a.offset === e.offset - start && a.length === e.length);
    if (index >= 0) { confirmed++; remaining.splice(index, 1); }
  }
  return { expected: expected.length, returned: actual.length, confirmed, preserved: confirmed === expected.length && !remaining.length };
}
