import { destinationRights, verifyDestination, recipientList } from './destinations.mjs';
import { createServer } from 'node:http';
import { createHash, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { authenticate, AppError } from './auth.mjs';
import { compileDocument, verifyCustomEmoji } from './document.mjs';
import { readAttachmentRequest } from './attachment.mjs';
import { publicMessage } from './history.mjs';

export function createApp({ config, store, telegram, catalog, bot = {}, staticDir = 'dist' }) {
  const limits = new Map(); const dist = resolve(staticDir);
  const uploading = new Set();
  function rate(key, max = 90) {
    const now = Date.now();
    if (limits.size > 10000) for (const [k, v] of limits) if (v.until < now) limits.delete(k);
    const current = limits.get(key);
    const entry = current?.until > now ? current : { count: 0, until: now + 60000 };
    entry.count++; limits.set(key, entry);
    if (entry.count > max) throw new AppError(429, 'Слишком много действий. Подожди минуту.');
  }
  const json = (res, status, value) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); };
  return createServer(async (req, res) => {
    let uploadOwner;
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org; base-uri 'none'; form-action 'none'");
    try {
      const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
      if (path === '/healthz') return json(res, 200, { ok: true, telegram: !!config.token, username: bot.username || null });
      if ((path.startsWith('/api/emoji/') || path.startsWith('/api/sticker/')) && req.method === 'GET') {
        const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
        const visitor = config.publicUrl && loopback ? req.headers['cf-connecting-ip'] || req.socket.remoteAddress : req.socket.remoteAddress;
        rate(`asset:${visitor}`, 600);
        const kind = path.startsWith('/api/sticker/') ? 'sticker' : 'emoji';
        const asset = await catalog.asset(path.slice(kind === 'sticker' ? 13 : 11), url.searchParams.get('thumb') === '1', kind);
        res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'public,max-age=86400' }); return res.end(asset.bytes);
      }
      if (path === '/api/catalog' && req.method === 'GET') return json(res, 200, { packs: catalog.list(), stickerPacks: catalog.list(0, 'sticker'), username: bot.username || null });
      if (path.startsWith('/api/')) {
        const user = authenticate((req.headers.authorization || '').replace(/^tma /, ''), config.token);
        rate(`user:${user.id}`);
        if (req.headers.origin && config.publicUrl && req.headers.origin !== new URL(config.publicUrl).origin) throw new AppError(403, 'Недопустимый источник запроса.');
        let body = {}, attachment;
        if (req.method === 'POST' && path === '/api/send' && req.headers['content-type']?.startsWith('multipart/form-data')) {
          if (uploading.has(user.id) || uploading.size >= 2) throw new AppError(429, 'Сейчас загружается другой файл. Подожди немного.');
          uploading.add(user.id); uploadOwner = user.id;
          ({ body, attachment } = await readAttachmentRequest(req));
        } else if (req.method === 'POST') body = await readJson(req);
        if (path === '/api/bootstrap' && req.method === 'GET') {
          const connections = store.connections(user.id);
          return json(res, 200, { user: { id: user.id, first_name: user.first_name }, username: bot.username, connected: connections.length > 0, canReply: connections.some(c => c.rights?.can_reply),
            recipients: recipientList(store, user.id), packs: catalog.list(user.id), stickerPacks: catalog.list(user.id, 'sticker') });
        }
        if ((path === '/api/history' || path === '/api/history/media') && req.method === 'GET') {
          const recipient = store.recipients(user.id).find(r => `${r.connection}:${r.chat}` === url.searchParams.get('recipient'));
          if (!recipient) throw new AppError(403, 'Этот диалог недоступен.');
          const connection = await telegram.call('getBusinessConnection', { business_connection_id: recipient.connection });
          if (connection.id !== recipient.connection || connection.user.id !== user.id || !connection.is_enabled) throw new AppError(403, 'Доступ к диалогу отключён.');
          store.connection(connection);
          if (path === '/api/history') return json(res, 200, { messages: store.history(user.id, recipient.connection, recipient.chat).map(publicMessage), canReply: !!connection.rights?.can_reply, limit: 100 });
          const message = store.historyMessage(user.id, recipient.connection, recipient.chat, Number(url.searchParams.get('id')));
          if (!message || message.deleted || !message.media?.previewFileId) throw new AppError(404, 'Предпросмотр недоступен.');
          const bytes = await telegram.file(message.media.previewFileId);
          const type = bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? 'image/png' : bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' ? 'image/webp' : null;
          if (!type) throw new AppError(404, 'Предпросмотр недоступен.');
          res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }); return res.end(bytes);
        }
        if (path === '/api/packs' && req.method === 'POST') { rate(`import:${user.id}`, 6); return json(res, 200, { pack: await catalog.add(user.id, body.name, body.kind ?? 'emoji') }); }
        if (path === '/api/select-recipient' && req.method === 'POST') {
          const kind = body.kind || 'private';
          if (!['private', 'group', 'channel'].includes(kind)) throw new AppError(400, 'Некорректный тип чата.');
          if (kind !== 'private') {
            const requestId = randomInt(1, 2147483647); store.destinationRequest(requestId, user.id, kind);
            const prepared = await telegram.call('savePreparedKeyboardButton', { user_id: user.id, button: { text: kind === 'channel' ? 'Выбрать канал' : 'Выбрать группу', request_chat: { request_id: requestId, chat_is_channel: kind === 'channel', user_administrator_rights: destinationRights(kind), bot_administrator_rights: destinationRights(kind), bot_is_member: true, request_title: true, request_username: true } } });
            return json(res, 200, { id: prepared.id, requestId });
          }
          if (!store.connections(user.id).some(c => c.rights?.can_reply)) throw new AppError(409, 'Сначала подключи секретаря и разреши отправку сообщений.');
          const requestId = randomInt(1, 2147483647); store.selection(requestId, user.id);
          const prepared = await telegram.call('savePreparedKeyboardButton', { user_id: user.id, button: { text: 'Выбрать получателя', request_users: { request_id: requestId, user_is_bot: false, max_quantity: 1, request_name: true, request_username: true } } });
          return json(res, 200, { id: prepared.id, requestId });
        }
        if (path === '/api/selection' && req.method === 'GET') {
          const destination = store.selectedDestination(Number(url.searchParams.get('id')), user.id);
          if (destination) return json(res, 200, { recipient: destination.result ? `bot:${destination.result}` : null, error: destination.error });
          const chat = store.selected(Number(url.searchParams.get('id')), user.id);
          const selected = store.recipients(user.id).find(r => r.chat === chat);
          return json(res, 200, { recipient: selected ? `${selected.connection}:${selected.chat}` : null });
        }
        if (path === '/api/send' && req.method === 'POST') {
          rate(`send:${user.id}`, 12);
          if (!/^[a-zA-Z0-9-]{16,80}$/.test(body.requestId || '')) throw new AppError(400, 'Некорректный идентификатор отправки.');
          const recipient = store.recipients(user.id).find(r => `${r.connection}:${r.chat}` === body.recipient) || store.destinations(user.id).find(r => `bot:${r.chat}` === body.recipient);
          if (!recipient) throw new AppError(403, 'Выбери получателя из своего списка.');
          let sticker;
          if (body.stickerId !== undefined) {
            if (typeof body.stickerId !== 'string' || !/^[a-f0-9]{64}$/.test(body.stickerId)) throw new AppError(400, 'Выбери стикер из каталога.');
            sticker = catalog.lookup(body.stickerId, user.id, 'sticker');
            if (!sticker) throw new AppError(403, 'Стикер недоступен. Добавь его набор в свой каталог.');
            if (body.document !== undefined || attachment || body.attachmentKind !== undefined) throw new AppError(400, 'Стикер отправляется отдельно от текста и вложения.');
          }
          if (body.attachmentKind && !attachment) throw new AppError(400, 'Прикрепи файл заново.');
          const compiled = sticker ? null : compileDocument(body.document, id => catalog.lookup(id, user.id), { allowEmpty: !!attachment, maxLength: attachment ? 1024 : 4096 });
          const payload = { ...(recipient.connection ? { business_connection_id: recipient.connection } : {}), chat_id: recipient.chat, ...(sticker ? { sticker: sticker.file } : attachment
            ? { caption: compiled.text, caption_entities: compiled.entities }
            : { text: compiled.text, entities: compiled.entities, link_preview_options: { is_disabled: true } }) };
          if (body.replyTo !== undefined && body.replyTo !== null) {
            if (!Number.isSafeInteger(body.replyTo) || body.replyTo <= 0 || !recipient.connection) throw new AppError(400, 'Некорректное сообщение для ответа.');
            payload.reply_parameters = { message_id: body.replyTo };
          }
          const digest = createHash('sha256').update(JSON.stringify(attachment ? { payload, kind: attachment.kind, hash: attachment.hash, name: attachment.name } : payload)).digest('hex');
          const previous = store.delivery(user.id, body.requestId);
          if (previous) {
            if (previous.digest !== digest) throw new AppError(409, 'Сообщение изменилось. Повтори отправку с новым идентификатором.');
            if (previous.status === 'sent') return json(res, 200, deliveryResult(previous.message, previous.emoji_report ? JSON.parse(previous.emoji_report) : null));
            throw new AppError(409, previous.status === 'failed' ? 'Предыдущая отправка отклонена. Попробуй отправить заново.' : 'Отправка уже началась, но результат не подтверждён. Проверь чат перед повторной отправкой.', previous.status === 'failed' ? 'telegram_rejected' : 'delivery_unknown');
          }
          if (!recipient.connection) await verifyDestination(telegram, bot, user.id, recipient.chat, recipient.kind);
          else {
          const connection = await telegram.call('getBusinessConnection', { business_connection_id: recipient.connection });
          store.connection(connection);
          if (connection.id !== recipient.connection || connection.user.id !== user.id || !connection.is_enabled || !connection.rights?.can_reply) throw new AppError(403, 'У секретаря нет права отправлять от твоего имени.');
          }
          if (store.delivery(user.id, body.requestId)) throw new AppError(409, 'Эта отправка уже обрабатывается. Проверь чат.', 'delivery_unknown');
          if (payload.reply_parameters) {
            const target = store.historyMessage(user.id, recipient.connection, recipient.chat, body.replyTo);
            if (!target || target.deleted) throw new AppError(409, 'Сообщение для ответа удалено или больше не входит в историю. Выбери другое.', 'reply_unavailable');
          }
          // Reserve immediately before the only side effect. Never automatically retry an ambiguous delivery.
          store.reserveDelivery(user.id, body.requestId, digest);
          try {
            let sent;
            if (attachment) {
              const form = new FormData();
              for (const [key, value] of Object.entries(payload)) form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
              form.set(attachment.kind, new Blob([attachment.bytes], { type: attachment.type }), attachment.name);
              sent = await telegram.call(({ photo: 'sendPhoto', video: 'sendVideo', document: 'sendDocument' })[attachment.kind], form, 90000);
            } else sent = await telegram.call(sticker ? 'sendSticker' : 'sendMessage', payload);
            const report = sticker ? { kind: 'sticker', preserved: sent.sticker?.file_unique_id === sticker.unique,
              premiumExpected: sticker.premium, premiumPreserved: sticker.premium ? !!sent.sticker?.premium_animation : null }
              : verifyCustomEmoji(compiled, attachment ? { text: sent.caption, entities: sent.caption_entities } : sent);
            // Business replies may be sent without a reply when the original disappears.
            // Check the returned message and report this without retrying the delivery.
            if (payload.reply_parameters) report.replyPreserved = sent.reply_to_message?.message_id === body.replyTo;
            if (recipient.connection) store.recordMessage(user.id, recipient.connection, { ...sent,
              chat: { id: recipient.chat, type: 'private' }, from: { id: user.id } });
            store.finishDelivery(user.id, body.requestId, 'sent', sent.message_id, report);
            return json(res, 200, deliveryResult(sent.message_id, report));
          } catch (error) {
            const rejected = error.code === 'telegram_rejected';
            store.finishDelivery(user.id, body.requestId, rejected ? 'failed' : 'unknown');
            if (!rejected) throw new AppError(502, 'Не удалось подтвердить отправку. Проверь чат: сообщение могло дойти. Автоматически повторять не будем.', 'delivery_unknown');
            throw error;
          }
        }
        throw new AppError(404, 'Метод не найден.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError(405, 'Метод не поддерживается.');
      const filename = path === '/' ? resolve(dist, 'index.html') : resolve(dist, `.${decodeURIComponent(path)}`);
      if (!filename.startsWith(dist + sep)) throw new AppError(404, 'Страница не найдена.');
      let bytes;
      try { bytes = await readFile(filename); } catch { throw new AppError(404, 'Страница не найдена. Выполни сборку приложения.'); }
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
      res.writeHead(200, { 'content-type': mime[extname(filename)] || 'application/octet-stream', 'cache-control': path.startsWith('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!error.status) console.error('Request failed:', error.code || error.name);
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Не получилось выполнить действие. Попробуй ещё раз.', code: error.code || 'server_error' });
      else res.end();
    } finally { if (uploadOwner !== undefined) uploading.delete(uploadOwner); }
  });
}

function deliveryResult(messageId, report) {
  return { sent: true, messageId, ...(report?.kind === 'sticker' ? { stickerDelivery: report } : { emojiDelivery: report }) };
}

async function readJson(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError(415, 'Ожидается JSON.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 131072) throw new AppError(413, 'Сообщение слишком большое.'); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks)); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); return value; } catch { throw new AppError(400, 'Некорректный JSON.'); }
}
