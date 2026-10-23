import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import curatedPacks from './curated-packs.json' with { type: 'json' };
import curatedStickers from './curated-stickers.json' with { type: 'json' };

export function loadConfig(env = process.env) {
  const path = resolve(env.PREMIUM_CONFIG || 'config.json');
  let data = {};
  if (existsSync(path)) data = JSON.parse(readFileSync(path, 'utf8'));
  else if (env.PREMIUM_CONFIG) throw new Error('Файл PREMIUM_CONFIG не найден.');
  const app = data.premium_ai_agent || {};
  const token = env.PREMIUM_BOT_TOKEN || data.bot_token_premium_emoji_app || '';
  if (token && !/^\d+:[\w-]+$/.test(token)) throw new Error('Неверный формат токена.');
  const publicUrl = (env.PREMIUM_PUBLIC_URL || app.public_url || '').replace(/\/$/, '');
  if (publicUrl && new URL(publicUrl).protocol !== 'https:') throw new Error('public_url должен начинаться с https://');
  return {
    token, publicUrl, host: env.PREMIUM_HOST || app.host || '127.0.0.1',
    port: Number(env.PREMIUM_PORT || app.port || 8787),
    dataDir: resolve(env.PREMIUM_DATA_DIR || '.data'),
    emojiSets: [...new Set([...curatedPacks, ...(app.emoji_sets || [])])],
    stickerSets: [...new Set([...curatedStickers, ...(app.sticker_sets || [])])],
    polling: env.PREMIUM_POLLING === '0' ? false : app.polling !== false,
  };
}
