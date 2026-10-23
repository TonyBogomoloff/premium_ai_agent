import { loadConfig } from './config.mjs';
import { Store } from './store.mjs';
import { Telegram } from './telegram.mjs';
import { Catalog } from './catalog.mjs';
import { createApp } from './app.mjs';
import { poll } from './bot.mjs';
import { join } from 'node:path';

const config = loadConfig(); const telegram = new Telegram(config.token);
const bot = config.token ? await telegram.call('getMe') : {};
const dataDir = bot.id ? join(config.dataDir, `bot-${bot.id}`) : join(config.dataDir, 'preview');
const store = new Store(dataDir);
const catalog = new Catalog(store, telegram, dataDir);
const server = createApp({ config, store, telegram, catalog, bot });
server.requestTimeout = 120000; server.headersTimeout = 10000;
server.listen(config.port, config.host, () => console.log(`Mini App: http://${config.host}:${config.port} · ${bot.username ? '@' + bot.username : 'локальный предпросмотр'}`));
const controller = new AbortController();
if (config.token) {
  for (const [kind, names] of [['emoji', config.emojiSets], ['sticker', config.stickerSets]]) for (const name of names) {
    if (store.packs().some(p => p.name.toLowerCase() === name.toLowerCase())) continue;
    try { await catalog.add(0, name, kind); console.log('Каталог:', name); } catch (e) { console.warn('Набор не загружен:', name, e.code || e.name); }
  }
  if (config.polling) poll({ config, store, telegram, bot }, controller.signal).catch(() => console.warn('Polling остановлен.'));
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { controller.abort(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
