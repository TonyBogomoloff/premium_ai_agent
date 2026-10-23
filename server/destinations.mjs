import { AppError } from './auth.mjs';

export function destinationRights(kind) {
  return { is_anonymous: false, can_manage_chat: true, can_delete_messages: false,
    can_manage_video_chats: false, can_restrict_members: false, can_promote_members: false,
    can_change_info: false, can_invite_users: false, can_post_stories: false,
    can_edit_stories: false, can_delete_stories: false,
    ...(kind === 'channel' ? { can_post_messages: true, can_edit_messages: false } : {}) };
}

export async function verifyDestination(telegram, bot, owner, chatId, kind) {
  if (!['group', 'channel'].includes(kind) || !Number.isSafeInteger(chatId) || chatId >= 0) throw new AppError(400, 'Некорректный чат.');
  const chat = await telegram.call('getChat', { chat_id: chatId });
  if ((kind === 'channel' && chat.type !== 'channel') || (kind === 'group' && !['group', 'supergroup'].includes(chat.type))) throw new AppError(400, 'Выбери чат нужного типа.');
  const member = await telegram.call('getChatMember', { chat_id: chatId, user_id: bot.id });
  if (member.status !== 'administrator' || (kind === 'channel' && !member.can_post_messages)) throw new AppError(403, 'Добавь бота администратором. Для канала разреши публикацию сообщений.');
  if (kind === 'group' && member.is_anonymous) throw new AppError(403, 'Отключи анонимность бота в группе, чтобы сообщения отправлялись от его имени.');
  const user = await telegram.call('getChatMember', { chat_id: chatId, user_id: owner });
  if (!['creator', 'administrator'].includes(user.status) || (kind === 'channel' && user.status !== 'creator' && !user.can_post_messages)) throw new AppError(403, 'Подключать и использовать этот чат может его владелец или администратор с правом публикации.');
  return { id: chat.id, type: kind, title: chat.title || String(chat.id), username: chat.username || null };
}

export function recipientList(store, owner) {
  return [...store.recipients(owner).map(r => ({ key: `${r.connection}:${r.chat}`, name: r.name, username: r.username, incoming: r.incoming, kind: 'private' })),
    ...store.destinations(owner).map(r => ({ key: `bot:${r.chat}`, name: r.name, username: r.username, kind: r.kind }))];
}
