import { createHash } from 'node:crypto';
import { AppError } from './auth.mjs';

export async function readAttachmentRequest(req) {
  const max = 50_000_000 + 131072;
  if (Number(req.headers['content-length']) > max) throw new AppError(413, 'Файл должен быть не больше 50 МБ.');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new AppError(413, 'Файл должен быть не больше 50 МБ.');
    chunks.push(chunk);
  }
  let form, body;
  try {
    form = await new Response(Buffer.concat(chunks), { headers: { 'content-type': req.headers['content-type'] } }).formData();
    const payload = form.get('payload');
    if (typeof payload !== 'string' || Buffer.byteLength(payload) > 131072 || form.getAll('payload').length !== 1) throw Error();
    body = JSON.parse(payload);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw Error();
  } catch { throw new AppError(400, 'Не удалось прочитать вложение. Выбери файл заново.'); }
  const file = form.get('attachment');
  if (!(file instanceof File) || form.getAll('attachment').length !== 1 || [...form.keys()].some(k => !['payload', 'attachment'].includes(k))) throw new AppError(400, 'Прикрепи один файл или фото.');
  if (!['photo', 'video', 'document'].includes(body.attachmentKind)) throw new AppError(400, 'Некорректный тип вложения.');
  const limit = body.attachmentKind === 'photo' ? 10_000_000 : 50_000_000;
  if (!file.size || file.size > limit) throw new AppError(413, `Максимальный размер: ${limit / 1_000_000} МБ. Пустой файл отправить нельзя.`);
  const bytes = Buffer.from(await file.arrayBuffer());
  if (body.attachmentKind === 'photo') {
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const webp = bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
    if (!jpeg && !png && !webp) throw new AppError(400, 'Для фото выбери JPEG, PNG или WebP. Другой формат можно прикрепить как файл.');
  }
  if (body.attachmentKind === 'video' && (bytes.length < 12 || bytes.toString('ascii', 4, 8) !== 'ftyp')) throw new AppError(400, 'Для видео с плеером выбери MP4. Другой формат прикрепи как файл.');
  const name = file.name.replace(/[\\/\x00-\x1f\x7f]/g, '_').slice(0, 180) || 'attachment';
  return { body, attachment: { bytes, name, type: file.type || 'application/octet-stream', kind: body.attachmentKind,
    hash: createHash('sha256').update(bytes).digest('hex') } };
}
