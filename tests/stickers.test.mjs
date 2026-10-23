import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { AppError } from '../server/auth.mjs';
import { Store } from '../server/store.mjs';
import { Catalog, packName } from '../server/catalog.mjs';
import { createApp } from '../server/app.mjs';

const token = '123456:sticker_test';
const regular = { type: 'regular', file_id: 'private-file-id', file_unique_id: 'stable-id', emoji: '🍒', is_animated: true, thumbnail: { file_id: 'private-thumb-id' }, premium_animation: { file_id: 'private-effect-id' } };
const set = (name = 'TestStickers') => ({ name, title: 'Test stickers', sticker_type: 'regular', stickers: [regular, { ...regular, file_id: 'second-file', file_unique_id: 'second-id', premium_animation: undefined, is_animated: false }] });
function auth(user = 10) {
  const data = { auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: user, first_name: 'Test' }) };
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  data.hash = createHmac('sha256', secret).update(Object.entries(data).sort().map(([k, v]) => `${k}=${v}`).join('\n')).digest('hex');
  return `tma ${new URLSearchParams(data)}`;
}

test('Sticker import validates pack type, isolates owners and keeps existing emoji packs usable', async t => {
  const store = new Store(':memory:'); t.after(() => store.db.close());
  store.pack(0, { name: 'LegacyEmoji', title: 'Old pack', emojis: [{ id: '123', alt: '✨', file: 'emoji-file', format: 'webp' }] });
  let current = set();
  const catalog = new Catalog(store, { call: async () => current }, '/tmp');
  assert.equal(packName('https://t.me/addstickers/TestStickers?x=1', 'sticker'), 'TestStickers');
  for (const name of ['https://evil.test/addstickers/Test', 'https://t.me/addemoji/Test', '../Test']) assert.throws(() => packName(name, 'sticker'));
  assert.throws(() => packName('Test', 'mask'));
  const pack = await catalog.add(10, 'TestStickers', 'sticker');
  assert.equal(pack.stickers[0].premium, true); assert.equal(pack.stickers[1].premium, false);
  assert.ok(pack.stickers[0].src.startsWith('/api/sticker/'));
  assert.doesNotMatch(JSON.stringify(pack), /private-|stable-id|file_id/);
  assert.equal(catalog.lookup(pack.stickers[0].id, 11, 'sticker'), undefined);
  assert.equal(catalog.lookup(pack.stickers[0].id, 10), undefined);
  assert.equal(catalog.list(11, 'sticker').length, 0);
  assert.equal(catalog.list(10)[0].emojis[0].id, '123');
  assert.equal(catalog.lookup('123', 10).alt, '✨');
  assert.deepEqual(store.packs(10).flatMap(p => p.emojis).map(e => e.id), ['123'], 'The previous release can still read stored packs after a rollback');
  current = { ...set(), stickers: [{ ...regular, file_id: 'refreshed-file-id' }] };
  assert.equal((await catalog.add(10, 'TestStickers', 'sticker')).stickers[0].id, pack.stickers[0].id);
  for (const sticker_type of ['custom_emoji', 'mask']) {
    current = { ...set('Wrong'), sticker_type };
    await assert.rejects(catalog.add(10, 'Wrong', 'sticker'), /Нужен набор стикеров/);
  }
  current = set(); await assert.rejects(catalog.add(10, 'TestStickers'), /вкладке «Стикеры»/);
});

test('Sticker assets decode TGS, serve JPEG thumbnails correctly and cache without exposing file IDs', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'stickers-test-')); const store = new Store(':memory:');
  t.after(async () => { store.db.close(); await rm(dir, { recursive: true, force: true }); });
  const downloads = [];
  const telegram = { call: async () => set(), file: async id => {
    downloads.push(id); return id === 'private-thumb-id' ? Buffer.from([255, 216, 255, 217]) : gzipSync('{"v":"5.7.4","layers":[]}');
  } };
  const catalog = new Catalog(store, telegram, dir);
  const pack = await catalog.add(0, 'TestStickers', 'sticker'); const id = pack.stickers[0].id;
  const asset = await catalog.asset(id, false, 'sticker');
  assert.equal(asset.type, 'application/json'); assert.deepEqual(JSON.parse(asset.bytes), { v: '5.7.4', layers: [] });
  assert.equal((await catalog.asset(id, true, 'sticker')).type, 'image/jpeg');
  await catalog.asset(id, false, 'sticker'); await catalog.asset(id, true, 'sticker');
  assert.deepEqual(downloads, ['private-file-id', 'private-thumb-id']);
  await assert.rejects(catalog.asset('../private-file-id', false, 'sticker'));
  await assert.rejects(catalog.asset(id, false, 'emoji'));
});

async function fixture(t, options = {}) {
  const store = new Store(':memory:'); const sends = [];
  const connection = { id: 'connection-A', user: { id: 10 }, is_enabled: true, rights: { can_reply: true } };
  store.connection(connection); store.recipient(10, connection.id, { id: 30, type: 'private', first_name: 'Recipient' });
  store.destination(10, { id: -40, type: 'group', title: 'Group', username: null });
  const telegram = { async call(method, payload) {
    if (method === 'getStickerSet') return set(payload.name);
    if (method === 'getBusinessConnection') return { ...connection, rights: { can_reply: !options.revoked } };
    if (method === 'getChat') return { id: -40, type: 'supergroup' };
    if (method === 'getChatMember') return { status: 'administrator', is_anonymous: false };
    if (method === 'sendSticker') {
      sends.push(payload);
      if (options.uncertain) throw new AppError(502, 'timeout', 'telegram_unavailable');
      if (options.rejected) throw new AppError(400, 'rejected', 'telegram_rejected');
      return { message_id: 99, sticker: { ...regular, ...(options.dropPremium ? { premium_animation: undefined } : {}) },
        ...(payload.reply_parameters && !options.dropReply ? { reply_to_message: { message_id: payload.reply_parameters.message_id } } : {}) };
    }
    throw new Error(`Unexpected Telegram call: ${method}`);
  } };
  const catalog = new Catalog(store, telegram, '/tmp'); const pack = await catalog.add(10, 'TestStickers', 'sticker');
  const app = createApp({ config: { token, publicUrl: '' }, store, telegram, catalog, bot: { id: 123456 } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => { app.closeAllConnections(); app.close(); store.db.close(); });
  const base = `http://127.0.0.1:${app.address().port}`;
  const requestId = '11111111-1111-1111-1111-111111111111';
  const request = (extra = {}, user = 10) => fetch(`${base}/api/send`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: auth(user) }, body: JSON.stringify({ requestId, recipient: 'connection-A:30', stickerId: pack.stickers[0].id, ...extra }) });
  return { request, requestId, base, store, sends, pack };
}

test('Sticker delivery uses the saved Telegram file, preserves replies and history, and deduplicates requests', async t => {
  const f = await fixture(t);
  f.store.recordMessage(10, 'connection-A', { message_id: 50, chat: { id: 30, type: 'private' }, from: { id: 30 }, text: 'Hello' });
  const response = await f.request({ replyTo: 50 }); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.sent, true);
  assert.deepEqual(f.sends[0], { business_connection_id: 'connection-A', chat_id: 30, sticker: 'private-file-id', reply_parameters: { message_id: 50 } });
  assert.deepEqual(result.stickerDelivery, { kind: 'sticker', preserved: true, premiumExpected: true, premiumPreserved: true, replyPreserved: true });
  assert.deepEqual(await (await f.request({ replyTo: 50 })).json(), result); assert.equal(f.sends.length, 1);
  assert.equal((await f.request({ stickerId: f.pack.stickers[1].id })).status, 409);
  const stored = f.store.history(10, 'connection-A', 30).find(m => m.id === 99);
  assert.equal(stored.media.kind, 'sticker'); assert.equal(stored.replyTo, 50); assert.equal(stored.outgoing, true);
});

test('Sticker send rejects foreign recipients, foreign stickers, arbitrary file IDs and mixed text/media', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({}, 11)).status, 403);
  assert.equal((await f.request({ stickerId: 'f'.repeat(64) })).status, 403);
  assert.equal((await f.request({ stickerId: regular.file_id })).status, 400);
  assert.equal((await f.request({ document: { type: 'doc', content: [] } })).status, 400);
  assert.equal((await f.request({ attachmentKind: 'photo' })).status, 400);
  assert.equal((await f.request({ replyTo: 999 })).status, 409);
  assert.equal(f.sends.length, 0);
  const shared = await (await fetch(`${f.base}/api/catalog`)).json(); assert.deepEqual(shared.stickerPacks, []);
  const own = await (await fetch(`${f.base}/api/bootstrap`, { headers: { authorization: auth() } })).json();
  assert.equal(own.stickerPacks.length, 1); assert.doesNotMatch(JSON.stringify(own), /private-file-id|private-thumb-id/);
});

test('Uncertain sticker sends stay locked and rejected or revoked sends do not fall back to bot messages', async t => {
  for (const options of [{ uncertain: true }, { rejected: true }, { revoked: true }]) {
    const f = await fixture(t, options);
    const r = await f.request(); assert.equal(r.status, options.uncertain ? 502 : options.revoked ? 403 : 400);
    if (!options.revoked) {
      assert.equal((await r.json()).code, options.uncertain ? 'delivery_unknown' : 'telegram_rejected');
      assert.equal((await f.request()).status, 409); assert.equal(f.sends.length, 1);
    } else assert.equal(f.sends.length, 0);
  }
});

test('Lost premium effects or replies are reported on accepted sends without resending', async t => {
  const f = await fixture(t, { dropPremium: true, dropReply: true });
  f.store.recordMessage(10, 'connection-A', { message_id: 50, chat: { id: 30, type: 'private' }, text: 'Hello' });
  const result = await (await f.request({ replyTo: 50 })).json();
  assert.equal(result.sent, true); assert.equal(result.stickerDelivery.premiumPreserved, false); assert.equal(result.stickerDelivery.replyPreserved, false);
  assert.deepEqual(await (await f.request({ replyTo: 50 })).json(), result); assert.equal(f.sends.length, 1);
});

test('Sticker sends to a verified group preserve the configured bot route', async t => {
  const f = await fixture(t);
  assert.equal((await f.request({ recipient: 'bot:-40' })).status, 200);
  assert.deepEqual(f.sends[0], { chat_id: -40, sticker: 'private-file-id' });
});
