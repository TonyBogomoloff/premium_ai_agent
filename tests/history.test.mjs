import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { handleUpdate } from '../server/bot.mjs';
import { publicMessage } from '../server/history.mjs';

const token = '123456:history_test';
const connection = { id: 'connection-A', user: { id: 10 }, is_enabled: true, rights: { can_reply: true } };
const message = (id, extra = {}) => ({ message_id: id, date: 1700000000 + id, business_connection_id: connection.id, chat: { id: 30, type: 'private', first_name: 'Анна' }, from: { id: 30 }, text: `Сообщение ${id}`, ...extra });
function auth(owner = 10) {
  const data = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: owner }) };
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  data.hash = createHmac('sha256', secret).update(Object.entries(data).sort().map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex');
  return `tma ${new URLSearchParams(data)}`;
}

test('History keeps the newest 100 per owner/dialog; edits and deletions cannot be overwritten by old events', () => {
  const dir = mkdtempSync(join(tmpdir(), 'emoji-history-test-')); let store = new Store(dir);
  try {
    for (let id = 1; id <= 103; id++) store.recordMessage(10, connection.id, message(id));
    store.recordMessage(11, connection.id, message(1, { text: 'Другой пользователь' }));
    store.recordMessage(10, 'connection-B', message(1, { text: 'Другое подключение' }));
    store.recordMessage(10, connection.id, message(104, { chat: { id: 31, type: 'private' }, text: 'Другой чат' }));
    assert.equal(store.history(10, connection.id, 30).length, 100);
    assert.equal(store.history(10, connection.id, 30)[0].id, 4);
    store.recordMessage(10, connection.id, message(103, { text: 'Исправлено', edit_date: 1700000500 }));
    store.recordMessage(10, connection.id, message(103));
    assert.equal(store.historyMessage(10, connection.id, 30, 103).text, 'Исправлено');
    store.deleteMessages(10, connection.id, 30, [103]);
    store.recordMessage(10, connection.id, message(103, { text: 'Запоздавшая правка', edit_date: 1700000600 }));
    const deleted = store.historyMessage(10, connection.id, 30, 103);
    assert.equal(deleted.deleted, true); assert.equal(deleted.text, ''); assert.equal(deleted.media, null);
    assert.equal(store.history(11, connection.id, 30)[0].text, 'Другой пользователь');
    assert.equal(store.history(10, 'connection-B', 30)[0].text, 'Другое подключение');
    assert.equal(store.history(10, connection.id, 31)[0].text, 'Другой чат');
    store.deleteMessages(10, connection.id, 30, [200]);
    store.recordMessage(10, connection.id, message(200, { from: { id: 10 }, text: 'Запоздалый ответ отправки' }));
    assert.equal(store.historyMessage(10, connection.id, 30, 200), null);
    store.db.close(); store = new Store(dir);
    assert.equal(store.history(10, connection.id, 30).length, 100);
    assert.equal(store.historyMessage(10, connection.id, 30, 103).deleted, true);
    assert.equal(store.history(11, connection.id, 30)[0].text, 'Другой пользователь');
  } finally { store.db.close(); rmSync(dir, { recursive: true }); }
});

test('Business updates capture both directions, caption/media, edits and deletion without retaining deleted content', async () => {
  const store = new Store(':memory:'); store.connection(connection);
  const ctx = { store, telegram: {}, config: {}, bot: {} };
  try {
    await handleUpdate({ business_message: message(1) }, ctx);
    await handleUpdate({ business_message: message(2, { from: { id: 10 }, text: undefined, caption: 'Подпись', photo: [{ file_id: 'private-file-id', width: 320, height: 320 }] }) }, ctx);
    assert.equal(store.historyMessage(10, connection.id, 30, 1).outgoing, false);
    const outgoing = store.historyMessage(10, connection.id, 30, 2);
    assert.equal(outgoing.outgoing, true); assert.equal(outgoing.text, 'Подпись');
    assert.equal(publicMessage(outgoing).media.preview, true);
    assert(!JSON.stringify(publicMessage(outgoing)).includes('private-file-id'));
    await handleUpdate({ edited_business_message: message(1, { text: 'Новая версия', edit_date: 1700000200 }) }, ctx);
    assert.equal(store.historyMessage(10, connection.id, 30, 1).text, 'Новая версия');
    await handleUpdate({ deleted_business_messages: { business_connection_id: connection.id, chat: { id: 30 }, message_ids: [1] } }, ctx);
    assert.equal(store.historyMessage(10, connection.id, 30, 1).text, '');
  } finally { store.db.close(); }
});

async function fixture(t, { revoked = false, missingReply = false } = {}) {
  const store = new Store(':memory:'); store.connection(connection); store.recipient(10, connection.id, message(1).chat);
  store.recordMessage(10, connection.id, message(1));
  store.recordMessage(10, connection.id, message(2, { chat: { id: 31, type: 'private' } }));
  store.recordMessage(10, connection.id, message(3, { photo: [{ file_id: 'private-file-id', width: 320, height: 320 }] }));
  let sends = 0, downloads = 0; const payloads = [];
  const telegram = { async call(method, payload) {
    if (method === 'getBusinessConnection') return { ...connection, is_enabled: !revoked };
    if (method.startsWith('send')) {
      sends++; const data = payload instanceof FormData ? Object.fromEntries([...payload].map(([k,v]) => [k, ['caption_entities','reply_parameters'].includes(k) ? JSON.parse(v) : v])) : payload;
      payloads.push(data);
      return message(100, { text: data.text, caption: data.caption, entities: data.entities, caption_entities: data.caption_entities, from: { id: 10 }, reply_to_message: missingReply ? undefined : { message_id: data.reply_parameters?.message_id } });
    }
    throw Error('Unexpected Telegram call');
  }, async file(id) { downloads++; assert.equal(id, 'private-file-id'); return Buffer.from([255,216,255]); } };
  const app = createApp({ config: { token, publicUrl: '' }, store, telegram, catalog: { list: () => [], lookup: () => null } });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  t.after(() => { app.closeAllConnections(); app.close(); store.db.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const get = (path, owner = 10) => fetch(base + path, { headers: { authorization: auth(owner) } });
  const send = (extra = {}, media = false) => {
    const data = { recipient: 'connection-A:30', requestId: 'reply-test-111111111111', document: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ответ' }] }] }, replyTo: 1, ...extra };
    if (!media) return fetch(base + '/api/send', { method: 'POST', headers: { authorization: auth(), 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const body = new FormData(); body.set('payload', JSON.stringify({ ...data, attachmentKind: 'document' })); body.set('attachment', new Blob(['file']), 'test.txt');
    return fetch(base + '/api/send', { method: 'POST', headers: { authorization: auth() }, body });
  };
  return { store, get, send, payloads, sends: () => sends, downloads: () => downloads };
}

test('History and thumbnails require the same owner and active connection', async t => {
  const f = await fixture(t);
  assert.equal((await f.get('/api/history?recipient=connection-A:30', 11)).status, 403);
  assert.equal((await f.get('/api/history/media?recipient=connection-A:30&id=3', 11)).status, 403); assert.equal(f.downloads(), 0);
  const history = await (await f.get('/api/history?recipient=connection-A:30')).json(); assert.equal(history.messages.length, 2);
  assert.equal((await f.get('/api/history/media?recipient=connection-A:30&id=3')).status, 200); assert.equal(f.downloads(), 1);
  const revoked = await fixture(t, { revoked: true }); assert.equal((await revoked.get('/api/history?recipient=connection-A:30')).status, 403);
});

test('Replies are scoped to this dialog, included in duplicate protection, saved once and work with media', async t => {
  const f = await fixture(t);
  assert.equal((await f.send({ replyTo: 2 })).status, 409); assert.equal(f.sends(), 0);
  assert.equal((await f.send({ replyTo: '1' })).status, 400);
  const response = await f.send(); assert.equal(response.status, 200); assert.equal((await response.json()).emojiDelivery.replyPreserved, true);
  assert.deepEqual(f.payloads[0].reply_parameters, { message_id: 1 });
  assert.equal(f.store.historyMessage(10, connection.id, 30, 100).replyTo, 1);
  assert.equal(f.store.historyMessage(10, connection.id, 30, 100).outgoing, true);
  assert.equal((await f.send()).status, 200); assert.equal(f.sends(), 1);
  assert.equal((await f.send({ replyTo: 3 })).status, 409); assert.equal(f.sends(), 1);
  assert.equal((await f.send({ requestId: 'reply-media-222222222222' }, true)).status, 200);
  assert.deepEqual(f.payloads[1].reply_parameters, { message_id: 1 });
  f.store.deleteMessages(10, connection.id, 30, [1]);
  assert.equal((await f.send({ requestId: 'reply-deleted-33333333333' })).status, 409); assert.equal(f.sends(), 2);
});

test('Telegram dropping a Business reply is reported as a successful send with a warning, never retried', async t => {
  const f = await fixture(t, { missingReply: true });
  const result = await (await f.send()).json(); assert.equal(result.sent, true); assert.equal(result.emojiDelivery.replyPreserved, false);
  const duplicate = await (await f.send()).json(); assert.equal(duplicate.emojiDelivery.replyPreserved, false); assert.equal(f.sends(), 1);
});
