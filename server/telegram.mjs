import { AppError } from './auth.mjs';

export class Telegram {
  constructor(token) { this.token = token; }
  async call(method, body = {}, timeout = 15000) {
    let response;
    try {
      response = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST', headers: body instanceof FormData ? {} : { 'content-type': 'application/json' }, body: body instanceof FormData ? body : JSON.stringify(body), signal: AbortSignal.timeout(timeout),
      });
    } catch { throw new AppError(502, 'Telegram не ответил вовремя.', 'telegram_unavailable'); }
    let data;
    try { data = await response.json(); } catch { throw new AppError(502, 'Не удалось прочитать ответ Telegram.', 'telegram_unavailable'); }
    if (!data.ok) {
      const err = new AppError(data.error_code === 429 ? 429 : 400, telegramMessage(data.description), 'telegram_rejected');
      err.telegramCode = data.error_code; err.retryAfter = data.parameters?.retry_after; throw err;
    }
    return data.result;
  }
  async file(fileId) {
    const file = await this.call('getFile', { file_id: fileId });
    if (file.file_size > 2_000_000) throw new AppError(400, 'Слишком большой файл эмодзи.');
    let r;
    try { r = await fetch(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`, { signal: AbortSignal.timeout(15000) }); }
    catch { throw new AppError(502, 'Не удалось загрузить эмодзи.'); }
    if (!r.ok) throw new AppError(502, 'Не удалось загрузить эмодзи.');
    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length > 2_000_000) throw new AppError(400, 'Слишком большой файл эмодзи.');
    return bytes;
  }
}

function telegramMessage(description = '') {
  if (/STICKERSET_INVALID/i.test(description)) return 'Набор не найден. Проверь ссылку на набор в Telegram.';
  if (/PREMIUM/i.test(description)) return 'Telegram не разрешил отправку этого Premium-стикера. Проверь Premium у подключённого аккаунта или выбери другой стикер.';
  if (/STICKER/i.test(description)) return 'Telegram не принял стикер. Добавь его набор заново или выбери другой.';
  if (/BUSINESS|CHAT_WRITE|CHAT_NOT_FOUND|chat not found|bot was blocked/i.test(description)) return 'Telegram не разрешил отправку в этот чат. Проверь подключение секретаря и доступ к диалогу.';
  if (/EMOJI|ENTITY/i.test(description)) return 'Telegram не принял оформление. Попробуй другой набор эмодзи.';
  if (/Too Many/i.test(description)) return 'Слишком много запросов. Попробуй чуть позже.';
  if (/Unauthorized/i.test(description)) return 'Токен бота недействителен.';
  return 'Telegram отклонил запрос. Попробуй ещё раз.';
}
