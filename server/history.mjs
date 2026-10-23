const clean = (value, max = 4096) => typeof value === 'string' ? value.slice(0, max) : '';
const positive = value => Number.isSafeInteger(value) && value > 0;

export function normalizeMessage(owner, message) {
  if (!positive(message.message_id) || !positive(message.chat?.id) || (message.chat.type && message.chat.type !== 'private')) return null;
  const text = clean(message.text ?? message.caption, 16384);
  const entities = (message.entities || message.caption_entities || []).filter(e =>
    Number.isInteger(e.offset) && Number.isInteger(e.length) && e.offset >= 0 && e.length > 0 && e.offset + e.length <= text.length
  ).slice(0, 256).map(e => ({ type: clean(e.type, 40), offset: e.offset, length: e.length,
    ...(e.url ? { url: clean(e.url, 2048) } : {}), ...(e.custom_emoji_id ? { custom_emoji_id: clean(e.custom_emoji_id, 100) } : {}) }));
  let media = null;
  if (message.photo?.length) {
    const photos = [...message.photo].filter(p => p.file_id).sort((a, b) => (a.width * a.height) - (b.width * b.height));
    const preview = photos.find(p => p.width >= 320 && (!p.file_size || p.file_size <= 2_000_000)) || photos[0];
    media = { kind: 'photo', label: 'Фото', previewFileId: preview?.file_id };
  } else {
    for (const [kind, label] of Object.entries({ video: 'Видео', animation: 'Анимация', document: 'Файл', audio: 'Аудио', voice: 'Голосовое сообщение', video_note: 'Видеосообщение', sticker: 'Стикер' })) {
      const file = message[kind];
      if (file) { media = { kind, label: file.emoji ? `${label} ${clean(file.emoji, 32)}` : label, name: clean(file.file_name, 180), size: file.file_size || 0, previewFileId: file.thumbnail?.file_id }; break; }
    }
  }
  if (!media && message.contact) media = { kind: 'contact', label: `Контакт: ${clean(message.contact.first_name, 100)} ${clean(message.contact.last_name, 100)} · ${clean(message.contact.phone_number, 100)}` };
  if (!media && message.location) media = { kind: 'location', label: `Геопозиция: ${message.location.latitude}, ${message.location.longitude}` };
  if (!media && message.poll) media = { kind: 'poll', label: `Опрос: ${clean(message.poll.question, 300)}` };
  if (!media && message.dice) media = { kind: 'dice', label: `${clean(message.dice.emoji, 32)} ${message.dice.value}` };
  if (!media && !text) media = { kind: 'other', label: 'Сообщение без текста' };
  const date = positive(message.date) ? message.date : Math.floor(Date.now() / 1000);
  return { id: message.message_id, date, edited: message.edit_date || 0,
    outgoing: message.from?.id === owner || !!message.sender_business_bot, text, entities, media,
    replyTo: positive(message.reply_to_message?.message_id) ? message.reply_to_message.message_id : null };
}

export function publicMessage(message) {
  const { previewFileId, ...media } = message.media || {};
  return { ...message, media: message.media ? { ...media, preview: !!previewFileId } : null };
}
