import { attachmentStore } from './attachment-store.js';

export function setupAttachment({ saved, storageKey, blocked, changed, restored, toast }) {
  let current = null, metadata = saved || null, url = '', revision = 0;
  let storageStatus = metadata ? 'loading' : 'empty';
  const $ = id => document.getElementById(id);
  function render() {
    $('attachment-preview').hidden = !metadata;
    $('attachment-name').textContent = metadata ? `${metadata.name} · ${(metadata.size / 1_000_000).toFixed(1)} МБ` : '';
    const hints = { loading: 'Восстанавливаем вложение…', saving: 'Сохраняем вложение…', saved: 'Вложение сохранено на этом устройстве.', failed: 'Не удалось сохранить файл. После закрытия его нужно выбрать заново.', missing: 'Вложение не найдено на устройстве. Выбери файл заново.' };
    $('attachment-hint').textContent = hints[storageStatus] || '';
    for (const [id, kind] of [['attachment-image', 'photo'], ['attachment-video', 'video']]) {
      const el = $(id); el.hidden = !url || metadata?.kind !== kind;
      if (!el.hidden) { if (el.getAttribute('src') !== url) el.src = url; }
      else el.removeAttribute('src');
    }
  }
  function releaseUrl() { if (url) URL.revokeObjectURL(url); url = ''; }
  function clear(notify = true) {
    revision++; releaseUrl(); current = null; metadata = null; storageStatus = 'empty';
    attachmentStore.remove(storageKey).catch(() => toast('Не удалось удалить сохранённое вложение с устройства.', true));
    render(); if (notify) changed();
  }
  for (const kind of ['photo', 'video', 'document']) {
    $(`attach-${kind}`).onclick = () => { if (!blocked()) $(`input-${kind}`).click(); };
    $(`input-${kind}`).onchange = event => {
      const file = event.target.files[0]; event.target.value = '';
      if (!file || blocked()) return;
      const max = kind === 'photo' ? 10_000_000 : 50_000_000;
      if (!file.size || file.size > max) { toast(`Выбери непустой файл до ${max / 1_000_000} МБ.`, true); return; }
      if (kind === 'photo' && !['image/jpeg','image/png','image/webp'].includes(file.type)) { toast('Фото: JPEG, PNG или WebP. Другой формат прикрепи как файл.', true); return; }
      if (kind === 'video' && file.type !== 'video/mp4') { toast('Для видео с плеером выбери MP4. Другой формат прикрепи как файл.', true); return; }
      const version = ++revision; releaseUrl();
      current = { file, kind }; metadata = { id: crypto.randomUUID(), name: file.name, size: file.size, kind };
      if (kind === 'photo' || kind === 'video') url = URL.createObjectURL(file);
      storageStatus = 'saving'; render(); changed();
      attachmentStore.put(storageKey, { id: metadata.id, file }).then(() => {
        if (revision !== version) return;
        storageStatus = 'saved'; render();
      }).catch(() => {
        if (revision !== version) return;
        storageStatus = 'failed'; render();
      });
    };
  }
  $('remove-attachment').onclick = () => { if (!blocked()) clear(); };
  render();
  const version = revision;
  if (metadata?.id) {
    attachmentStore.get(storageKey).then(record => {
      if (revision !== version) return;
      if (!record || record.id !== metadata.id || !(record.file instanceof Blob) || record.file.size !== metadata.size) {
        storageStatus = 'missing';
      } else {
        const file = new File([record.file], metadata.name, { type: record.file.type });
        current = { file, kind: metadata.kind };
        if (metadata.kind === 'photo' || metadata.kind === 'video') url = URL.createObjectURL(file);
        storageStatus = 'saved';
      }
      render(); restored();
    }).catch(() => { if (revision === version) { storageStatus = 'missing'; render(); restored(); } });
  } else {
    storageStatus = metadata ? 'missing' : 'empty'; render();
    attachmentStore.remove(storageKey).catch(() => {});
  }
  return { get: () => current, metadata: () => metadata, missing: () => !!metadata && !current, clear,
    update: () => { for (const id of ['attach-photo', 'attach-video', 'attach-document', 'remove-attachment']) $(id).disabled = blocked(); } };
}
