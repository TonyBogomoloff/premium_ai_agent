import { loadConfig } from '../server/config.mjs';
import { Telegram } from '../server/telegram.mjs';
const config = loadConfig();
if (!config.token) throw new Error('Задай PREMIUM_CONFIG с путём к config.json.');
const api = new Telegram(config.token);
const bot = await api.call('getMe');
console.log(JSON.stringify({ username: bot.username, business: bot.can_connect_to_business, id: bot.id }));
if (process.argv[2] === 'setup') {
  if (!config.publicUrl) throw new Error('Сначала задай PREMIUM_PUBLIC_URL или premium_ai_agent.public_url.');
  await api.call('setMyCommands', { commands: [{ command: 'start', description: 'Открыть редактор сообщений' }, { command: 'connect', description: 'Подключить секретаря' }, { command: 'help', description: 'Как пользоваться' }] });
  await api.call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Создать сообщение', web_app: { url: config.publicUrl } } });
  const menu = await api.call('getChatMenuButton');
  if (menu.type !== 'web_app' || new URL(menu.web_app.url).href !== new URL(config.publicUrl).href) throw new Error('Telegram не подтвердил кнопку открытия мини-эпа.');
  console.log('Меню и команды настроены:', config.publicUrl);
} else {
  const info = await api.call('getWebhookInfo');
  const menu = await api.call('getChatMenuButton');
  console.log(JSON.stringify({ hasWebhook: !!info.url, pendingUpdates: info.pending_update_count, menuType: menu.type, menuUrl: menu.web_app?.url || null }));
}
