import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { AppError } from './auth.mjs';

export function packName(value, kind = 'emoji') {
  if (!['emoji', 'sticker'].includes(kind)) throw new AppError(400, 'Неизвестный тип набора.');
  const link = kind === 'sticker' ? 'addstickers' : 'addemoji';
  if (typeof value !== 'string' || value.length > 200) throw new AppError(400, 'Вставь ссылку на набор.');
  let name = value.trim();
  const prefix = `https://t.me/${link}/`;
  if (name.startsWith(prefix)) name = name.slice(prefix.length).split('?')[0];
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new AppError(400, `Нужна ссылка t.me/${link}/название или название набора.`);
  return name;
}

export class Catalog {
  constructor(store, telegram, dir) { this.store = store; this.telegram = telegram; this.dir = join(dir, 'emoji'); this.inflight = new Map(); this.active = 0; this.waiting = []; }
  async download(file) {
    if (this.active >= 8) await new Promise(resolve => this.waiting.push(resolve));
    else this.active++;
    try { return await this.telegram.file(file); }
    finally { const next = this.waiting.shift(); if (next) next(); else this.active--; }
  }
  async add(owner, name, kind = 'emoji') {
    name = packName(name, kind);
    if (owner && !this.store.packs(owner).some(p => p.name.toLowerCase() === name.toLowerCase()) && this.store.personalPackCount(owner) >= 24) throw new AppError(400, 'Можно добавить до 24 наборов.');
    const set = await this.telegram.call('getStickerSet', { name });
    if (set.sticker_type !== (kind === 'sticker' ? 'regular' : 'custom_emoji')) throw new AppError(400, kind === 'sticker'
      ? 'Нужен набор стикеров со ссылкой addstickers. Эмодзи добавляй в соседней вкладке; маски не поддерживаются.'
      : 'Это набор стикеров. Добавь его во вкладке «Стикеры», а здесь используй ссылку addemoji.');
    // Keep the previous release able to read these records during a rollback.
    const pack = { name: set.name, title: set.title, kind, ...(kind === 'sticker' ? { emojis: [] } : {}), [kind === 'sticker' ? 'stickers' : 'emojis']: set.stickers
      .filter(s => kind === 'sticker' ? s.file_unique_id && s.file_id : s.custom_emoji_id && s.emoji)
      .map(s => ({
        id: kind === 'sticker' ? createHash('sha256').update(s.file_unique_id).digest('hex') : s.custom_emoji_id,
        alt: s.emoji || '✨', format: s.is_animated ? 'tgs' : s.is_video ? 'webm' : 'webp',
        file: s.file_id, thumb: s.thumbnail?.file_id || null,
        ...(kind === 'sticker' ? { unique: s.file_unique_id, premium: !!s.premium_animation } : {}),
      })) };
    this.store.pack(owner, pack); return this.publicPack(pack);
  }
  publicPack(pack) {
    const kind = pack.kind || 'emoji', field = kind === 'sticker' ? 'stickers' : 'emojis';
    return { name: pack.name, title: pack.title, kind, [field]: pack[field].map(({ file, thumb, unique, ...e }) => ({
      ...e, pack: pack.name, src: `/api/${kind}/${e.id}`, thumbnail: thumb ? `/api/${kind}/${e.id}?thumb=1` : null,
    })) };
  }
  list(owner = 0, kind = 'emoji') { return this.store.packs(owner).filter(p => (p.kind || 'emoji') === kind).map(p => this.publicPack(p)); }
  lookup(id, owner, kind = 'emoji') { return this.store.packs(owner).flatMap(p => p[kind === 'sticker' ? 'stickers' : 'emojis'] || []).find(e => e.id === id); }
  async asset(id, thumbnail, kind = 'emoji') {
    if (!(kind === 'sticker' ? /^[a-f0-9]{64}$/ : /^\d{1,30}$/).test(id)) throw new AppError(404, 'Изображение не найдено.');
    const emoji = this.store.allPacks().flatMap(p => p[kind === 'sticker' ? 'stickers' : 'emojis'] || []).find(e => e.id === id);
    if (!emoji) throw new AppError(404, 'Изображение не найдено.');
    const useThumb = thumbnail && !!emoji.thumb;
    const key = `${kind === 'sticker' ? 'sticker-' : ''}${id}${useThumb ? '-thumb' : ''}`;
    const content = bytes => ({ bytes, type: useThumb
      ? (bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg' : 'image/webp')
      : { tgs: 'application/json', webm: 'video/webm', webp: 'image/webp' }[emoji.format] });
    const filename = join(this.dir, key);
    try { return content(await readFile(filename)); } catch {}
    if (this.inflight.has(key)) return this.inflight.get(key);
    if (this.inflight.size >= 256) throw new AppError(429, 'Изображения загружаются.');
    const pending = (async () => {
      let bytes = await this.download(useThumb ? emoji.thumb : emoji.file);
      if (!useThumb && emoji.format === 'tgs') {
        bytes = gunzipSync(bytes, { maxOutputLength: 4_000_000 }); JSON.parse(bytes);
      }
      await mkdir(this.dir, { recursive: true, mode: 0o700 }); await writeFile(filename, bytes);
      return content(bytes);
    })();
    this.inflight.set(key, pending);
    try { return await pending; } finally { this.inflight.delete(key); }
  }
}
