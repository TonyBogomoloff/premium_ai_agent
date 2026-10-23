import { createHmac, timingSafeEqual } from 'node:crypto';

export class AppError extends Error {
  constructor(status, message, code = 'invalid_request') { super(message); this.status = status; this.code = code; }
}

export function authenticate(initData, token, now = Date.now()) {
  if (!token || !initData || initData.length > 16384) throw new AppError(401, 'Открой редактор через нашего Telegram-бота.', 'auth_required');
  const entries = [...new URLSearchParams(initData).entries()];
  if (new Set(entries.map(([k]) => k)).size !== entries.length) throw new AppError(401, 'Недействительная авторизация.');
  const params = Object.fromEntries(entries);
  if (!/^[a-f0-9]{64}$/.test(params.hash || '')) throw new AppError(401, 'Недействительная авторизация.');
  const data = entries.filter(([k]) => k !== 'hash').sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const expected = createHmac('sha256', secret).update(data).digest();
  if (!timingSafeEqual(expected, Buffer.from(params.hash, 'hex'))) throw new AppError(401, 'Недействительная авторизация.');
  const age = now / 1000 - Number(params.auth_date);
  if (!Number.isFinite(age) || age < -30 || age > 3600) throw new AppError(401, 'Закрой и заново открой мини-эп: сессия истекла.', 'auth_expired');
  let user;
  try { user = JSON.parse(params.user); } catch { throw new AppError(401, 'Нет данных пользователя.'); }
  if (!Number.isSafeInteger(user.id) || user.id <= 0 || user.is_bot) throw new AppError(401, 'Недействительный пользователь.');
  return user;
}
