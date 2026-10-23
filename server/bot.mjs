import { verifyDestination } from './destinations.mjs';
export async function handleUpdate(update, { store, telegram, config, bot }) {
  if (update.business_connection) { store.connection(update.business_connection); return; }
  if (update.business_message || update.edited_business_message) {
    const m = update.business_message || update.edited_business_message;
    let c = store.getConnection(m.business_connection_id);
    if (!c) { c = await telegram.call('getBusinessConnection', { business_connection_id: m.business_connection_id }); store.connection(c); }
    if (!c.is_enabled) return;
    const incoming = m.from?.id !== c.user.id && !m.sender_business_bot ? m.date : 0;
    store.recipient(c.user.id, c.id, m.chat, incoming);
    store.recordMessage(c.user.id, c.id, m); return;
  }
  if (update.deleted_business_messages) {
    const m = update.deleted_business_messages;
    const c = store.getConnection(m.business_connection_id);
    if (c) store.deleteMessages(c.user.id, c.id, m.chat.id, m.message_ids);
    return;
  }
  const m = update.message;
  if (!m || m.chat.type !== 'private' || !m.from || m.from.is_bot) return;
  if (m.chat_shared) {
    const pending = store.claimDestination(m.chat_shared.request_id, m.from.id);
    if (!pending) return;
    try {
      const chat = await verifyDestination(telegram, bot, m.from.id, m.chat_shared.chat_id, pending.kind);
      store.destination(m.from.id, chat);
      store.finishDestination(m.chat_shared.request_id, m.from.id, chat.id);
    } catch (error) {
      store.finishDestination(m.chat_shared.request_id, m.from.id, null, error.status === 403 || error.status === 400 ? error.message : 'Не удалось проверить права в чате. Проверь права бота и выбери чат снова.');
    }
    return;
  }
  if (m.users_shared?.users?.length && store.completeSelection(m.users_shared.request_id, m.from.id, m.users_shared.users[0].user_id)) {
    for (const c of store.connections(m.from.id)) for (const u of m.users_shared.users) store.recipient(m.from.id, c.id, { ...u, id: u.user_id });
    return;
  }
  if (!/^\/(start|help|connect)(?:\s|$|@)/.test(m.text || '')) return;
  const connection = /connect/.test(m.text);
  const text = connection
    ? `Подключи @${bot.username} в настройках Telegram: «Автоматизация чатов» / «Telegram Business» → «Чат-боты». Разреши отправку сообщений и выбери нужные личные чаты. Затем вернись в редактор.`
    : 'Создай сообщение с премиум-эмодзи: напиши текст, выбери оформление и отправь адресату.\n\nДля отправки от твоего имени подключи бота к аккаунту: /connect';
  const reply_markup = config.publicUrl ? { inline_keyboard: [[{ text: 'Открыть редактор ✨', web_app: { url: config.publicUrl } }]] } : undefined;
  await telegram.call('sendMessage', { chat_id: m.chat.id, text, ...(reply_markup ? { reply_markup } : {}) });
}

export async function poll(ctx, signal) {
  const info = await ctx.telegram.call('getWebhookInfo');
  if (info.url) { console.warn('У бота уже настроен webhook. Polling не запущен; существующее подключение сохранено.'); return; }
  let offset = Number(ctx.store.getMeta('offset') || 0);
  while (!signal.aborted) {
    try {
      const updates = await ctx.telegram.call('getUpdates', { offset, timeout: 25, allowed_updates: ['message', 'business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages'] }, 30000);
      for (const update of updates) {
        await handleUpdate(update, ctx);
        offset = update.update_id + 1; ctx.store.setMeta('offset', offset);
      }
    } catch (error) {
      console.warn('Telegram polling:', error.code || 'unavailable');
      if (error.telegramCode === 409) { console.warn('Другой процесс получает обновления этого бота. Polling остановлен.'); return; }
      await new Promise(resolve => setTimeout(resolve, Math.min(30000, Math.max(2000, (error.retryAfter || 3) * 1000))));
    }
  }
}
