import { Editor, Node, Mark, Extension, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { createIcons, ArrowUpRight, Bold, CheckCheck, ChevronDown, ChevronRight, Clock3, ContactRound, Scissors, Copy, ClipboardPaste, Image, Video, Paperclip, Grid2x2, Italic, LockKeyhole, Plus, RefreshCw, Search, Send, Smile, Sticker, Sparkles, Star, Underline, Undo2, Redo2, UserRound, X } from 'lucide';
import './style.css';
import './stickers.css';
import { setupConversation, messageSummary } from './conversation.js';
import { attachClipboard } from './clipboard.js';
import { setupAttachment } from './attachment.js';
import { attachEditorScrollbar } from './editor-ui.js';
import { mountEmoji } from './emoji-player.js';
import { attachEmojiScrollbar, attachConversationScrollbar } from './emoji-scrollbar.js';

const $ = selector => document.querySelector(selector);
const icons = { ArrowUpRight, Bold, CheckCheck, ChevronDown, ChevronRight, Clock3, ContactRound, Scissors, Copy, ClipboardPaste, Image, Video, Paperclip, Grid2x2, Italic, LockKeyhole, Plus, RefreshCw, Search, Send, Smile, Sticker, Sparkles, Star, Underline, Undo2, Redo2, UserRound, X };
createIcons({ icons });
const tg = window.Telegram?.WebApp;
const initData = tg?.initData || '';
const previewMode = !initData;
const storageKey = `emoji-studio:v1:${tg?.initDataUnsafe?.user?.id || 'preview'}`;
const emptyDoc = () => ({ type: 'doc', content: [{ type: 'paragraph' }] });
const saved = readStorage();
const state = { packs: [], emojis: new Map(), selectedPack: 'all', tab: 'all', query: '', visible: 112,
  kind: saved.selectedSticker || saved.catalogKind === 'sticker' ? 'sticker' : 'emoji', stickerPacks: [], stickers: new Map(),
  stickerFavorites: new Set(saved.stickerFavorites || []), stickerRecent: saved.stickerRecent || [], selectedSticker: saved.selectedSticker || null, premiumOnly: false,
  favorites: new Set(saved.favorites || []), recent: saved.recent || [], recipients: [], recipient: saved.selectedRecipient || (saved.selectedRecipients?.length === 1 ? saved.selectedRecipients[0] : null), replyTo: saved.replyTo || null, replyInvalid: false, chatCanReply: false,
  connected: false, canReply: false, username: null, sending: false, requestId: null, deliveryUnknown: false,
  doc: saved.document || emptyDoc() };
let editor, toastTimer, draftTimer;

if (initData) {
  const theme = getComputedStyle(document.documentElement);
  const background = theme.getPropertyValue('--chat-bg').trim();
  tg.ready(); tg.expand(); tg.setHeaderColor?.(background); tg.setBackgroundColor?.(background);
  tg.setBottomBarColor?.(theme.getPropertyValue('--chat-panel').trim()); tg.disableClosingConfirmation?.();
  tg.BackButton?.onClick(() => { const open = $('dialog[open]'); if (open) closeDialog(open); });
}

function readStorage() { try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch { return {}; } }
function draftStatus(status, text) {
  const el = $('#draft-status');
  el.dataset.state = status;
  el.replaceChildren(document.createElement('span'), document.createTextNode(text));
}
function scheduleDraftSave() {
  draftStatus('saving', 'Сохраняем…');
  if (draftTimer == null) draftTimer = setTimeout(persist, 5000);
}
function persist() {
  clearTimeout(draftTimer); draftTimer = null;
  draftStatus('saving', 'Сохраняем…');
  try {
    localStorage.setItem(storageKey, JSON.stringify({ document: state.doc, favorites: [...state.favorites], recent: state.recent, stickerFavorites: [...state.stickerFavorites], stickerRecent: state.stickerRecent, selectedSticker: state.selectedSticker, catalogKind: state.kind, requestId: state.requestId, deliveryUnknown: state.deliveryUnknown || state.sending, attachmentInfo: attachments.metadata(), selectedRecipient: state.recipient, replyTo: state.replyTo }));
    draftStatus('saved', 'Черновик сохранён'); return true;
  } catch { draftStatus('error', 'Черновик не сохранён'); return false; }
}
state.requestId = saved.requestId || null; state.deliveryUnknown = !!saved.deliveryUnknown || (saved.batch || []).some(x => ['unknown', 'sending'].includes(x.status));
let recipientKind = 'private';
const senderLabel = r => r.kind === 'group' ? 'Группа · от бота' : r.kind === 'channel' ? 'Канал · от имени канала' : 'Личный чат · от твоего имени';
function toast(message, error = false) {
  clearTimeout(toastTimer); const el = $('#toast'); el.textContent = message; el.classList.toggle('error', error); el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 7000 : 3300);
}
async function api(path, data) {
  let r;
  try { r = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { Authorization: `tma ${initData}`, ...(data === undefined || data instanceof FormData ? {} : { 'content-type': 'application/json' }) }, body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data), signal: AbortSignal.timeout(data instanceof FormData ? 120000 : 25000) }); }
  catch { const e = new Error('Нет связи с сервером. Черновик остался на устройстве.'); e.code = 'network_error'; throw e; }
  let result;
  try { result = await r.json(); } catch { const e = new Error('Не удалось прочитать ответ сервера. Проверь чат перед повторной отправкой.'); e.code = 'network_error'; throw e; }
  if (!r.ok) { const e = new Error(result.error || 'Не удалось выполнить действие.'); e.code = result.code; e.status = r.status; throw e; }
  return result;
}
function openDialog(el) { el.showModal(); tg?.BackButton?.show(); }
function closeDialog(el) { el.close(); tg?.BackButton?.hide(); }
$('#conversation-info').onclick = () => openDialog($('#conversation-info-dialog'));
document.querySelectorAll('.close-dialog').forEach(b => b.onclick = () => closeDialog(b.closest('dialog')));
document.querySelectorAll('dialog').forEach(d => {
  d.addEventListener('click', e => { if (e.target === d) { const r = d.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeDialog(d); } });
  d.addEventListener('close', () => { tg?.BackButton?.hide(); });
});

const CustomEmoji = Node.create({
  name: 'customEmoji', inline: true, group: 'inline', atom: true,
  addAttributes() { return { id: { default: '' }, alt: { default: '✨' } }; },
  parseHTML() { return [{ tag: 'span[data-emoji-id]', getAttrs: el => ({ id: el.dataset.emojiId, alt: el.dataset.alt || '✨' }) }]; },
  renderHTML({ node, HTMLAttributes }) { return ['span', mergeAttributes(HTMLAttributes, { 'data-emoji-id': node.attrs.id, 'data-alt': node.attrs.alt, class: 'custom-emoji' }), node.attrs.alt]; },
  renderText({ node }) { return node.attrs.alt; },
  addNodeView() { return ({ node }) => { const dom = document.createElement('span'); dom.contentEditable = 'false'; dom.className = 'custom-emoji'; dom.dataset.emojiId = node.attrs.id; dom.dataset.alt = node.attrs.alt; const player = mountEmoji(dom, state.emojis.get(node.attrs.id) || node.attrs); return { dom, destroy: () => player.destroy() }; }; },
});

const Spoiler = Mark.create({
  name: 'spoiler', excludes: 'code',
  parseHTML() { return [{ tag: 'span[data-spoiler]' }]; },
  renderHTML() { return ['span', { 'data-spoiler': '', class: 'spoiler' }, 0]; },
});
const QuoteStyle = Extension.create({
  name: 'quoteStyle',
  addGlobalAttributes() { return [{ types: ['paragraph'], attributes: { quote: {
    default: null, parseHTML: el => el.dataset.quote || null,
    renderHTML: attrs => attrs.quote ? { 'data-quote': attrs.quote } : {},
  } } }]; },
});
function bootEditor() {
  const options = { element: $('#editor'), extensions: [StarterKit.configure({ heading: false, blockquote: false, bulletList: false, orderedList: false, listItem: false, codeBlock: { exitOnTripleEnter: true }, horizontalRule: false, link: { openOnClick: false, autolink: false } }), CustomEmoji, Spoiler, QuoteStyle],
    content: state.doc, editorProps: { attributes: { 'aria-label': 'Текст сообщения', role: 'textbox', 'aria-multiline': 'true', spellcheck: 'false', autocorrect: 'off' } },
    onUpdate: ({ editor: changed }) => { state.doc = changed.getJSON(); if (!state.deliveryUnknown) state.requestId = null; scheduleDraftSave(); renderStats(); },
    onSelectionUpdate: renderToolbar, onTransaction: renderToolbar };
  try { editor = new Editor(options); } catch { state.doc = emptyDoc(); editor = new Editor({ ...options, content: state.doc }); toast('Старый черновик не удалось открыть.', true); }
  attachEditorScrollbar(editor, $('#editor-panel'));
  renderStats();
}

function textOf(doc) { return (doc.content || []).map(p => (p.content || []).map(n => n.type === 'text' ? n.text : n.type === 'customEmoji' ? n.attrs.alt : '\n').join('')).join('\n'); }
function renderStats() {
  const text = textOf(state.doc), maxLength = attachments.metadata() ? 1024 : 4096; $('#char-count').textContent = text.length; $('#char-limit').textContent = ` / ${maxLength}`; $('.char-count').classList.toggle('over', text.length > maxLength);
  attachments.update();
  const emojiCount = (state.doc.content || []).flatMap(p => p.content || []).filter(n => n.type === 'customEmoji').length;
  $('#send').hidden = !state.recipient;
  $('#recipient-label').textContent = state.recipient?.name || 'Выбери, кому отправить';
  $('#recipient-button').disabled = state.sending || state.deliveryUnknown;
  if (!state.sending) $('#send span').textContent = state.selectedSticker ? (state.replyTo ? 'Ответить стикером' : 'Отправить стикер') : state.replyTo ? 'Отправить ответ' : 'Отправить сообщение';
  $('#recipient-senders').textContent = state.recipient ? senderLabel(state.recipient) : '';
  const invalidContent = state.selectedSticker ? !state.stickers.has(state.selectedSticker) : (!text.trim() && !attachments.get()) || attachments.missing() || text.length > maxLength || emojiCount > 100;
  $('#send').disabled = state.sending || state.deliveryUnknown || state.replyInvalid || invalidContent || !state.recipient || !state.chatCanReply || previewMode;
  $('#clear-sticker').disabled = state.sending || state.deliveryUnknown;
  document.querySelectorAll('[data-catalog-kind]').forEach(b => { b.disabled = state.sending || state.deliveryUnknown; });
  renderStickerPreview();
  $('#clear-reply').disabled = state.sending;
  conversation.update();
  $('#resolve-delivery').hidden = !state.deliveryUnknown;
  $('#delivery-note').hidden = !state.deliveryUnknown;
  renderToolbar();
}
function renderToolbar() {
  if (!editor) return;
  for (const mark of ['bold', 'italic', 'underline', 'strike', 'spoiler', 'code']) { $(`#${mark}`).disabled = state.sending; $(`#${mark}`).classList.toggle('active', editor.isActive(mark)); $(`#${mark}`).setAttribute('aria-pressed', String(editor.isActive(mark))); }
  for (const id of ['codeBlock', 'link', 'clear-format', 'blockquote', 'expandable']) { $('#'+id).disabled = state.sending; $('#'+id).classList.toggle('active', id === 'blockquote' || id === 'expandable' ? editor.getAttributes('paragraph').quote === id : editor.isActive(id)); }
  for (const id of ['cut', 'copy']) $('#'+id).disabled = state.sending || editor.state.selection.empty;
  $('#paste').disabled = state.sending;
  $('#undo').disabled = state.sending || !editor.can().undo(); $('#redo').disabled = state.sending || !editor.can().redo();
}
for (const mark of ['bold', 'italic', 'underline', 'strike', 'spoiler', 'code']) $(`#${mark}`).onclick = () => editor.chain().focus().toggleMark(mark).run();
$('#codeBlock').onclick = () => editor.chain().focus().toggleCodeBlock().run();
for (const quote of ['blockquote', 'expandable']) $('#'+quote).onclick = () => editor.chain().focus().setParagraph().updateAttributes('paragraph', { quote: editor.getAttributes('paragraph').quote === quote ? null : quote }).run();
$('#clear-format').onclick = () => editor.chain().focus().unsetAllMarks().clearNodes().resetAttributes('paragraph', 'quote').run();
$('#link').onclick = () => {
  if (editor.state.selection.empty && !editor.isActive('link')) { toast('Выдели текст для ссылки.'); return; }
  $('#link-url').value = editor.getAttributes('link').href || '';
  openDialog($('#link-dialog'));
};
$('#link-form').onsubmit = e => {
  e.preventDefault(); const href = $('#link-url').value.trim();
  if (!/^https?:\/\//i.test(href)) { toast('Вставь ссылку с https:// или http://', true); return; }
  editor.chain().focus().extendMarkRange('link').setLink({ href }).run(); closeDialog($('#link-dialog'));
};
$('#remove-link').onclick = () => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); closeDialog($('#link-dialog')); };
$('#undo').onclick = () => editor.chain().focus().undo().run(); $('#redo').onclick = () => editor.chain().focus().redo().run();
const attachments = setupAttachment({ saved: saved.attachmentInfo, storageKey, restored: () => renderStats(), blocked: () => state.sending || state.deliveryUnknown, changed: () => { state.requestId = null; persist(); renderStats(); }, toast });
attachClipboard({ getEditor: () => editor, blocked: () => state.sending, toast });
attachConversationScrollbar($('#conversation-messages'));
const conversation = setupConversation({ api, initData, blocked: () => state.sending || state.deliveryUnknown || !state.chatCanReply,
  onReply: message => {
    state.replyTo = { recipient: state.recipient.key, id: message.id, text: messageSummary(message).slice(0, 200), outgoing: message.outgoing };
    state.replyInvalid = false; state.requestId = null; renderReply(); persist(); renderStats();

    editor.commands.focus('end'); $('#reply-context').scrollIntoView({ block: 'nearest' });
  },
  onMessages: (messages, canReply) => {
    state.chatCanReply = canReply;
    if (state.replyTo) {
      const target = messages.find(m => m.id === state.replyTo.id && !m.deleted);
      state.replyInvalid = !target;
      if (target) state.replyTo.text = messageSummary(target).slice(0, 200);
      renderReply();
    }
    renderStats();
  },
});
function renderReply() {
  $('#reply-context').hidden = !state.replyTo;
  $('#reply-context').classList.toggle('unavailable', state.replyInvalid);
  $('#reply-title').textContent = state.replyInvalid ? 'Сообщение больше недоступно — выбери другое' : `Ответ на сообщение: ${state.replyTo?.outgoing ? 'ты' : state.recipient?.name || ''}`;
  $('#reply-text').textContent = state.replyTo?.text || '';
  conversation.highlight(state.replyTo?.id || null);
}
function selectRecipient(recipient) {
  if (state.sending) return;
  const changed = state.recipient?.key !== recipient?.key;
  if (changed) { state.replyTo = null; state.replyInvalid = false; state.requestId = null; }
  state.recipient = recipient;
  if (recipient?.kind && recipient.kind !== 'private') state.chatCanReply = true;
  else if (changed || !recipient) state.chatCanReply = false;
  if (state.replyTo?.recipient !== recipient?.key) state.replyTo = null;
  conversation.select(recipient); renderReply(); persist(); renderStats();
}
$('#clear-reply').onclick = () => { if (state.sending) return; state.replyTo = null; state.replyInvalid = false; state.requestId = null; renderReply(); persist(); renderStats(); };
$('#resolve-delivery').onclick = () => { state.deliveryUnknown = false; state.requestId = null; $('#under-note').textContent = ''; persist(); renderStats(); };

const searchGroups = [
  ['😀😃😄😁😆😅😂🤣🙂🙃😉😊☺️🥰😍🤩😘😗😚😙😋😛😜🤪😝', 'улыбка радость смех лицо весело smile happy laugh'],
  ['❤️🧡💛💚💙💜🖤🤍🤎🩷🩵🩶💖💝💘💕💞💓💗💟♥️🫶🥰😍😘', 'сердце любовь люблю романтика heart love'],
  ['🔥❤️‍🔥💥⚡️⚡🌟✨⭐️💫✦', 'огонь круто энергия звезда сияние блеск fire star sparkle'],
  ['👍👎👏🙌🤝💪🙏👌✌️🤞🫰✊🫶👋', 'рука спасибо отлично привет одобрение hand thanks hello'],
  ['🎂🎉🎊🎁🥳🎈🎀🍾🥂', 'праздник поздравление день рождения подарок birthday party gift'],
  ['😎🕶️🤓🧐😏🤨😐😑🤔🤫🤭🫢🫡', 'круто умный думаю cool think'],
  ['😢😭🥺😔😞😥😓😟🙁☹️💔', 'грусть печаль плачу sad cry'],
  ['😡😤🤬👿💢', 'злость гнев angry'],
  ['😴🥱🛌💤🌙🌛', 'сон спать ночь sleep night'],
  ['🌸🌹🌷🌻🌼💐🍀🌿🌱🍃🌳', 'цветок природа цветы роза flower nature'],
  ['🐱🐈😺😸😻🐶🐕🐻🐼🦊🐰🐸🐣🦋', 'кот кошка собака животное милый cat dog animal'],
  ['☀️🌞🌈☁️🌧️❄️☃️🌊🏝️🌴', 'солнце погода лето море sun summer'],
  ['✅☑️✔️❌❎⛔️🔴🟢🟡🔵', 'галочка готово да нет check done'],
  ['☕️🍵🍩🍫🍓🍒🍉🍕🍔🥑', 'еда кофе food coffee'],
];
const normalize = s => s.replace(/\uFE0F/g, '').toLowerCase();
function keywords(emoji) { const alt = normalize(emoji.alt); return searchGroups.filter(([chars]) => normalize(chars).includes(alt)).map(([, words]) => words).join(' '); }
const catalogPacks = () => state.kind === 'sticker' ? state.stickerPacks : state.packs;
const catalogItems = () => state.kind === 'sticker' ? state.stickers : state.emojis;
const catalogFavorites = () => state.kind === 'sticker' ? state.stickerFavorites : state.favorites;
const catalogRecent = () => state.kind === 'sticker' ? state.stickerRecent : state.recent;
const catalogViews = { emoji: { selectedPack: 'all', tab: 'all', query: '', visible: 112 }, sticker: { selectedPack: 'all', tab: 'all', query: '', visible: 112 } };
let stickerPlayer, renderedSticker = null;
function renderCatalogKind() {
  const stickers = state.kind === 'sticker', label = stickers ? 'стикеров' : 'эмодзи';
  document.querySelectorAll('[data-catalog-kind]').forEach(b => {
    const selected = b.dataset.catalogKind === state.kind;
    b.setAttribute('aria-selected', String(selected)); b.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('active', b.dataset.tab === state.tab); b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)); });
  $('#catalog-panel').setAttribute('aria-labelledby', stickers ? 'sticker-tab' : 'emoji-tab');
  $('#emoji-grid').classList.toggle('sticker-grid', stickers);
  $('#emoji-grid').setAttribute('aria-label', stickers ? 'Стикеры' : 'Эмодзи');
  $('.emoji-scrollbar').setAttribute('aria-label', `Прокрутка ${label}`);
  $('#search').value = state.query; $('#search').setAttribute('aria-label', `Поиск ${label}`);
  $('#premium-filter').hidden = !stickers; $('#premium-only').checked = state.premiumOnly;
  $('#sticker-hint').hidden = !stickers;
  $('#packs').setAttribute('aria-label', `Выбрать набор ${label}`);
  $('#pack-select-title').textContent = `Наборы ${label}`;
  $('#pack-search').placeholder = `Поиск набора ${label} по названию`;
  $('#pack-search').setAttribute('aria-label', $('#pack-search').placeholder);
  $('#pack-dialog .dialog-description').textContent = `Скопируй ссылку на набор ${label} в Telegram.`;
  $('#pack-url').placeholder = `https://t.me/${stickers ? 'addstickers' : 'addemoji'}/…`;
  $('#emoji-loading').setAttribute('aria-label', `Загружаем ${stickers ? 'стикеры' : 'эмодзи'}`);
}
function renderStickerPreview() {
  const sticker = state.stickers.get(state.selectedSticker);
  $('#sticker-preview').hidden = !state.selectedSticker;
  const key = sticker ? `${sticker.id}:${sticker.src}` : null;
  if (key !== renderedSticker) {
    stickerPlayer?.destroy(); stickerPlayer = null; $('#selected-sticker').replaceChildren(); renderedSticker = key;
    if (sticker) stickerPlayer = mountEmoji($('#selected-sticker'), sticker);
  }
  $('#sticker-title').textContent = sticker ? `${sticker.premium ? '★ Premium · ' : ''}${sticker.title}` : 'Набор стикера недоступен — добавь его заново';
  document.querySelectorAll('[data-sticker-id]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.stickerId === state.selectedSticker)));
}
function selectSticker(sticker) {
  if (state.sending || state.deliveryUnknown) return;
  state.selectedSticker = sticker.id; state.requestId = null;
  persist(); renderStats(); tg?.HapticFeedback?.selectionChanged();
  $('#sticker-preview').scrollIntoView({ block: 'nearest', behavior: 'instant' });
  if (!state.recipient) toast('Выбери получателя в верхней части экрана.');
}
$('#clear-sticker').onclick = () => {
  if (state.sending || state.deliveryUnknown) return;
  state.selectedSticker = null; state.requestId = null; persist(); renderStats();
};
document.querySelectorAll('[data-catalog-kind]').forEach(b => {
  b.onclick = () => {
    if (state.sending || state.deliveryUnknown || state.kind === b.dataset.catalogKind) return;
    catalogViews[state.kind] = { selectedPack: state.selectedPack, tab: state.tab, query: state.query, visible: state.visible };
    state.kind = b.dataset.catalogKind; Object.assign(state, catalogViews[state.kind]);
    if (state.kind === 'emoji' && state.selectedSticker) { state.selectedSticker = null; state.requestId = null; }
    $('#pack-search').value = ''; $('#pack-url').value = '';
    renderCatalogKind(); renderPacks(); renderGrid(); persist(); renderStats();
  };
  b.onkeydown = e => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const target = e.key === 'Home' ? $('#emoji-tab') : e.key === 'End' ? $('#sticker-tab') : b.id === 'emoji-tab' ? $('#sticker-tab') : $('#emoji-tab');
    target.click(); target.focus();
  };
});
$('#premium-only').onchange = e => { state.premiumOnly = e.target.checked; state.visible = 112; renderGrid(); };
function applyCatalog(packs, stickerPacks = state.stickerPacks) {
  state.packs = packs; state.emojis = new Map(packs.flatMap(p => p.emojis.map(e => [e.id, { ...e, title: p.title }])));
  state.stickerPacks = stickerPacks; state.stickers = new Map(stickerPacks.flatMap(p => p.stickers.map(s => [s.id, { ...s, title: p.title }])));
  renderCatalogKind(); renderPacks(); renderGrid();
}
function renderPacks() {
  if (!catalogPacks().some(p => p.name === state.selectedPack)) state.selectedPack = 'all';
  const selected = catalogPacks().find(p => p.name === state.selectedPack);
  $('#packs').textContent = selected?.title || 'Все наборы';
  $('#packs').title = selected?.title || 'Все наборы';
  renderPackOptions();
}
const packCollator = new Intl.Collator('ru', { sensitivity: 'base', numeric: true, ignorePunctuation: true });
const packSortTitle = pack => pack.title.trim().replace(/^[^\p{L}\p{N}]+/u, '');
function updatePackScrollHint() {
  const list = $('#pack-options');
  $('#pack-scroll').hidden = !$('#pack-select-dialog').open || list.scrollHeight - list.clientHeight - list.scrollTop <= 2;
}
function renderPackOptions() {
  const query = $('#pack-search').value.trim().toLocaleLowerCase('ru');
  const sorted = [...catalogPacks()].sort((a, b) => packCollator.compare(packSortTitle(a), packSortTitle(b)) || packCollator.compare(a.name, b.name));
  const packs = [{ name: 'all', title: 'Все наборы' }, ...sorted].filter(pack => pack.title.toLocaleLowerCase('ru').includes(query));
  const list = $('#pack-options'); list.replaceChildren(); list.scrollTop = 0;
  for (const pack of packs) {
    const button = document.createElement('button'); button.className = 'pack-option';
    button.setAttribute('aria-pressed', String(state.selectedPack === pack.name));
    const dot = document.createElement('span'); dot.className = 'pack-option-dot'; dot.setAttribute('aria-hidden', 'true');
    const title = document.createElement('span'); title.textContent = pack.title; button.append(dot, title);
    button.onclick = () => { state.selectedPack = pack.name; state.visible = 112; renderPacks(); renderGrid(); closeDialog($('#pack-select-dialog')); };
    list.append(button);
  }
  $('#pack-search-empty').hidden = packs.length !== 0;
  requestAnimationFrame(updatePackScrollHint);
}
$('#packs').onclick = () => { $('#pack-search').value = ''; renderPackOptions(); openDialog($('#pack-select-dialog')); $('#pack-search').focus(); };
$('#pack-search').oninput = renderPackOptions;
$('#pack-options').addEventListener('scroll', updatePackScrollHint, { passive: true });
new ResizeObserver(updatePackScrollHint).observe($('#pack-options'));
$('#pack-scroll').onclick = () => $('#pack-options').scrollBy({ top: $('#pack-options').clientHeight * .75, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
attachEmojiScrollbar($('#emoji-grid'));
let gridObserver, gridCleanup = new Map(), gridEmojis = [], gridLoadFrame = 0, gridLoading = false;
const gridEndObserver = new IntersectionObserver(entries => {
  const end = $('#emoji-grid').lastElementChild;
  if (entries.some(entry => entry.isIntersecting && entry.target === end)) loadNextEmojiPage();
}, { root: $('#emoji-grid'), rootMargin: '0px 0px 24px 0px' });
function setGridLoading(loading) {
  gridLoading = loading;
  $('#emoji-loading').hidden = !loading;
  $('#emoji-grid').setAttribute('aria-busy', String(loading));
}
function observeGridEnd() {
  gridEndObserver.disconnect();
  if (state.visible < gridEmojis.length) gridEndObserver.observe($('#emoji-grid').lastElementChild);
}
function loadNextEmojiPage() {
  if (gridLoading || state.visible >= gridEmojis.length) return;
  gridEndObserver.disconnect();
  setGridLoading(true);
  // Let the loading indicator paint before adding the next batch.
  gridLoadFrame = requestAnimationFrame(() => {
    gridLoadFrame = requestAnimationFrame(() => {
      gridLoadFrame = 0;
      const grid = $('#emoji-grid'), from = grid.children.length, scrollTop = grid.scrollTop;
      state.visible = Math.min(from + 112, gridEmojis.length);
      appendGridEmojis(from);
      grid.scrollTop = scrollTop;
      setGridLoading(false);
      observeGridEnd();
    });
  });
}
function renderGrid() {
  cancelAnimationFrame(gridLoadFrame); gridLoadFrame = 0;
  gridEndObserver.disconnect(); setGridLoading(false);
  $('.pack-picker').hidden = state.tab !== 'all' || !!state.query;
  const items = catalogItems(), favorites = catalogFavorites();
  let emojis = [...items.values()];
  if (state.query) {
    const q = normalize(state.query); emojis = emojis.filter(e => normalize(`${e.alt} ${e.title} ${keywords(e)}`).includes(q));
  } else {
    if (state.tab === 'all' && state.selectedPack !== 'all') emojis = emojis.filter(e => e.pack === state.selectedPack);
    if (state.tab === 'favorites') emojis = emojis.filter(e => favorites.has(e.id));
    if (state.tab === 'recent') emojis = catalogRecent().map(id => items.get(id)).filter(Boolean);
  }
  if (state.kind === 'sticker' && state.premiumOnly) emojis = emojis.filter(e => e.premium);
  $('#grid-title').textContent = state.query ? 'ПОИСК ПО ВСЕМ НАБОРАМ' : state.tab === 'favorites' ? 'ТВОИ ЛЮБИМЫЕ' : state.tab === 'recent' ? 'НЕДАВНО ИСПОЛЬЗОВАННЫЕ' : 'ВЫБЕРИ НАСТРОЕНИЕ';
  gridEmojis = emojis;
  gridObserver?.disconnect(); gridCleanup.forEach(player => player.destroy()); gridCleanup.clear();
  const grid = $('#emoji-grid'), nearViewport = new Set(); grid.replaceChildren();
  gridObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const container = entry.target;
      if (entry.isIntersecting) nearViewport.add(container); else nearViewport.delete(container);
      if (entry.isIntersecting && !gridCleanup.has(container)) {
        container.replaceChildren(); gridCleanup.set(container, mountEmoji(container, items.get(container.dataset.id)));
        const tile = container.closest('.emoji-tile');
        if (tile.dataset.new === 'true') { tile.classList.add('emoji-tile-revealed'); delete tile.dataset.new; }
      }
      // Keep nearby renderers paused for a quick return, with a bounded memory cost.
      if (entry.isIntersecting && gridCleanup.has(container)) {
        const player = gridCleanup.get(container); gridCleanup.delete(container); gridCleanup.set(container, player);
      }
    }
    for (const [container, player] of gridCleanup) {
      if (gridCleanup.size <= 96) break;
      if (nearViewport.has(container)) continue;
      player.destroy(); gridCleanup.delete(container);
      container.textContent = items.get(container.dataset.id)?.alt || '✨';
    }
  }, { root: grid, rootMargin: '32px' });
  appendGridEmojis(); grid.scrollTop = 0; observeGridEnd();
  $('#empty-catalog').hidden = emojis.length > 0;
  const label = state.kind === 'sticker' ? 'стикеры' : 'эмодзи';
  if (!items.size) { $('#empty-catalog strong').textContent = 'Добавь первый набор'; $('#empty-catalog p').textContent = `Нажми + и вставь ссылку на набор ${state.kind === 'sticker' ? 'стикеров' : 'эмодзи'} из Telegram.`; }
  else { $('#empty-catalog strong').textContent = state.query || state.premiumOnly ? 'Ничего не нашлось' : state.tab === 'favorites' ? `Здесь будут любимые ${label}` : state.tab === 'recent' ? `Здесь будут недавние ${label}` : 'Ничего не нашлось'; $('#empty-catalog p').textContent = state.kind === 'sticker' && state.premiumOnly ? 'Попробуй другой набор или выключи фильтр Premium.' : state.query ? 'Попробуй другой запрос.' : state.tab === 'favorites' ? 'Нажми звёздочку в углу понравившегося изображения.' : state.kind === 'sticker' ? 'Здесь появятся отправленные стикеры.' : 'Выбери эмодзи или попробуй другой запрос.'; }
}
function appendGridEmojis(from = 0) {
  const grid = $('#emoji-grid'), stickers = state.kind === 'sticker', favorites = catalogFavorites();
  for (const emoji of gridEmojis.slice(from, state.visible)) {
    const tile = document.createElement('div'); tile.className = 'emoji-tile';
    if (from > 0) tile.dataset.new = 'true';
    const b = document.createElement('button'); b.className = 'emoji-insert'; b.title = `${emoji.alt} · ${emoji.title}${emoji.premium ? ' · Premium' : ''}`; b.setAttribute('aria-label', `${stickers ? 'Выбрать стикер' : 'Вставить'} ${emoji.alt}${emoji.premium ? ' · Premium' : ''}`);
    if (stickers) { b.dataset.stickerId = emoji.id; b.setAttribute('aria-pressed', String(state.selectedSticker === emoji.id)); }
    b.onmousedown = e => e.preventDefault(); b.onclick = () => stickers ? selectSticker(emoji) : insertEmoji(emoji);
    const animated = document.createElement('span'); animated.className = 'custom-emoji'; animated.dataset.id = emoji.id;
    animated.textContent = emoji.alt; b.append(animated); gridObserver.observe(animated);
    const star = document.createElement('button'); star.className = `emoji-star${favorites.has(emoji.id) ? ' saved' : ''}`; star.textContent = favorites.has(emoji.id) ? '★' : '☆';
    star.setAttribute('aria-label', `${favorites.has(emoji.id) ? 'Убрать из избранного' : 'Добавить в избранное'} ${emoji.alt}`);
    star.onclick = () => { if (favorites.has(emoji.id)) favorites.delete(emoji.id); else favorites.add(emoji.id); persist(); renderGrid(); };
    if (emoji.premium) { const badge = document.createElement('span'); badge.className = 'sticker-premium'; badge.textContent = '★'; badge.title = 'Premium'; badge.setAttribute('aria-label', 'Premium'); tile.append(badge); }
    tile.append(b, star); grid.append(tile);
  }
  $('#grid-count').textContent = `${Math.min(state.visible, gridEmojis.length)} из ${gridEmojis.length} ${stickers ? 'стикеров' : 'эмодзи'}`;
}
function insertEmoji(emoji) {
  if (editor.isActive("codeBlock") || editor.isActive("code")) { toast("Выйди из режима кода, чтобы вставить премиум-эмодзи."); return; }
  if (state.sending) return;

  // Keep browsing the catalog without focusing the editor or opening the keyboard.
  if (emoji.demo) editor.commands.insertContent(emoji.alt);
  else editor.commands.insertContent({ type: 'customEmoji', attrs: { id: emoji.id, alt: emoji.alt } });
  state.recent = [emoji.id, ...state.recent.filter(id => id !== emoji.id)].slice(0, 64); persist(); tg?.HapticFeedback?.selectionChanged();
  if (state.tab === 'recent') {
    const scrollTop = $('#emoji-grid').scrollTop;
    renderGrid();
    $('#emoji-grid').scrollTop = scrollTop;
  }
}
$('#search').oninput = e => { state.query = e.target.value.trim(); state.visible = 112; renderGrid(); };
document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; state.visible = 112; document.querySelectorAll('[data-tab]').forEach(t => { t.classList.toggle('active', t === b); t.setAttribute('aria-selected', t === b); }); renderGrid(); });
$('#add-pack').onclick = () => { if (previewMode) { toast('Добавление наборов доступно внутри Telegram.'); return; } $('#pack-error').textContent = ''; openDialog($('#pack-dialog')); };
$('#pack-form').onsubmit = async e => {
  e.preventDefault(); $('#import-pack').disabled = true; $('#pack-error').textContent = '';
  const kind = state.kind;
  try {
    const { pack } = await api('/api/packs', { name: $('#pack-url').value, kind });
    const replace = packs => [...packs.filter(p => p.name !== pack.name), pack];
    applyCatalog(kind === 'emoji' ? replace(state.packs) : state.packs, kind === 'sticker' ? replace(state.stickerPacks) : state.stickerPacks);
    state.selectedPack = pack.name; state.query = ''; $('#search').value = ''; state.premiumOnly = false; $('#premium-only').checked = false;
    state.tab = 'all'; document.querySelector('[data-tab="all"]').click(); renderPacks(); renderStats(); closeDialog($('#pack-dialog')); $('#pack-url').value = ''; toast('Набор добавлен');
  }
  catch (e) { $('#pack-error').textContent = e.message; } finally { $('#import-pack').disabled = false; }
};

function renderRecipients() {
  const target = $('#recipient-list'); target.replaceChildren(); const query = $('#recipient-search').value.trim().toLowerCase();
  const recipients = state.recipients.filter(r => (r.kind || 'private') === recipientKind).filter(r => `${r.name} ${r.username || ''}`.toLowerCase().includes(query));
  for (const r of recipients) {
    const button = document.createElement('button'); button.className = 'recipient-row'; const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = r.name.slice(0, 1).toUpperCase();
    const text = document.createElement('span'); const name = document.createElement('strong'); name.textContent = r.name; const sub = document.createElement('small'); sub.textContent = senderLabel(r); text.append(name, sub); button.append(avatar, text);
    button.setAttribute('aria-pressed', String(state.recipient?.key === r.key));
    button.onclick = () => { selectRecipient(r); closeDialog($('#recipient-dialog')); }; target.append(button);
  }
  if (!recipients.length) { const p = document.createElement('p'); p.className = 'recipient-empty'; p.textContent = recipientKind !== 'private' ? 'Подключи чат через кнопку «Выбрать в Telegram».' : state.connected ? 'Выбери контакт в Telegram. Здесь также появятся доступные секретарю диалоги после новых сообщений.' : 'Подключи секретаря к своему Telegram-аккаунту, чтобы выбрать получателя.'; target.append(p); }
  $('#native-recipient').disabled = (recipientKind === 'private' && !state.canReply) || previewMode;
  $('.recipient-help').hidden = recipientKind !== 'private';
  $('#recipients-description').textContent = recipientKind === 'private' ? 'Личные чаты, доступные твоему секретарю. Отправка от твоего имени.' : `Добавь @${state.username || 'premium_emoji_app'} администратором ${recipientKind === 'channel' ? 'канала с правом публикации' : 'группы без анонимности'}. Ты тоже должен быть владельцем или администратором${recipientKind === 'channel' ? ' с правом публикации' : ''}. ${recipientKind === 'channel' ? 'Публикация от имени канала.' : 'Сообщения от имени бота.'} Ограничения 24 часов нет.`;
  document.querySelectorAll('[data-recipient-kind]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.recipientKind === recipientKind)));
}
document.querySelectorAll('[data-recipient-kind]').forEach(b => b.onclick = () => { recipientKind = b.dataset.recipientKind; renderRecipients(); });
$('#recipient-search').oninput = renderRecipients;
$('#recipient-button').onclick = () => { if (state.sending || state.deliveryUnknown) return; if (previewMode) return showConnection(); $('#recipient-search').value = ''; recipientKind = state.recipient?.kind || 'private'; renderRecipients(); openDialog($('#recipient-dialog')); };
$('#native-recipient').onclick = async () => {
  if (!tg?.isVersionAtLeast?.('9.6') || !tg.requestChat) { toast('Для выбора контакта обнови Telegram. Уже доступные чаты можно выбрать из списка.', true); return; }
  $('#native-recipient').disabled = true;
  try {
    const { id, requestId } = await api('/api/select-recipient', { kind: recipientKind });
    const success = await new Promise(resolve => tg.requestChat(id, resolve));
    if (!success) return;
    let found = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(r => setTimeout(r, 900)); await refresh();
      const selection = await api(`/api/selection?id=${requestId}`);
      if (selection.error) throw new Error(selection.error);
      const selected = state.recipients.find(r => r.key === selection.recipient);
      if (selected) { selectRecipient(selected); closeDialog($('#recipient-dialog')); found = true; break; }
    }
    if (!found) toast('Контакт пока не получен. Попробуй выбрать его ещё раз.', true);
    renderRecipients();
  } catch (e) { toast(e.message, true); } finally { $('#native-recipient').disabled = false; }
};

function showConnection() {
  $('#connection-description').textContent = previewMode
    ? 'Это предпросмотр редактора. Открой мини-эп из Telegram, чтобы подключить секретаря и отправлять сообщения от своего имени.'
    : state.canReply ? 'Секретарь подключён и может отправлять от твоего имени в разрешённые личные чаты.'
    : 'Открой настройки Telegram → «Автоматизация чатов» / «Telegram Business» → «Чат-боты». Подключи нашего бота и разреши отправку сообщений. Затем нажми «Проверить подключение».';
  $('#open-bot').disabled = !state.username; $('#refresh-connection').hidden = previewMode; openDialog($('#connection-dialog'));
}
$('#connection').onclick = () => { if (!state.canReply) showConnection(); };
$('#open-bot').onclick = () => { if (state.username) { const url = `https://t.me/${state.username}?start=connect`; if (initData) tg.openTelegramLink(url); else window.open(url, '_blank', 'noopener,noreferrer'); } };
$('#refresh-connection').onclick = async () => { try { await refresh(); if (state.canReply) { closeDialog($('#connection-dialog')); toast('Секретарь подключён'); } else toast('Подключение пока не найдено.'); } catch (e) { toast(e.message, true); } };

$('#send').onclick = async () => {
  if ($('#send').disabled || state.sending) return;
  const stickerId = state.selectedSticker;
  $('#delivery-warning').hidden = true;
  state.sending = true; state.requestId ||= crypto.randomUUID();
  if (!persist()) { state.sending = false; renderStats(); toast('Не удалось сохранить ход отправки. Освободи место на устройстве.', true); return; }
  renderStats(); $('#send span').textContent = 'Отправляем…'; editor.setEditable(false, false);
  let sent = false;
  try {
    const attachment = stickerId ? null : attachments.get();
    const payload = { ...(stickerId ? { stickerId } : { document: state.doc }), recipient: state.recipient.key, requestId: state.requestId,
      ...(state.replyTo ? { replyTo: state.replyTo.id } : {}), ...(attachment ? { attachmentKind: attachment.kind } : {}) };
    let body = payload;
    if (attachment) { body = new FormData(); body.set('payload', JSON.stringify(payload)); body.set('attachment', attachment.file); }
    const result = await api('/api/send', body);
    if (!result.sent) throw Object.assign(new Error('Отправка не подтверждена. Проверь чат.'), { code: 'delivery_unknown' });
    sent = true;
    if (stickerId) {
      state.stickerRecent = [stickerId, ...state.stickerRecent.filter(id => id !== stickerId)].slice(0, 64); state.selectedSticker = null;
      if (state.kind === 'sticker') renderGrid();
    } else { attachments.clear(false); editor.commands.clearContent(); }
    state.replyTo = null; state.replyInvalid = false; state.requestId = null; renderReply();
    const warnings = [];
    if (result.emojiDelivery?.preserved === false) warnings.push('Telegram не сохранил часть премиум-эмодзи.');
    if (result.stickerDelivery?.preserved === false) warnings.push('Telegram не подтвердил выбранный стикер. Проверь чат.');
    if (result.stickerDelivery?.premiumPreserved === false) warnings.push('Telegram не подтвердил Premium-эффект стикера.');
    if ((result.stickerDelivery || result.emojiDelivery)?.replyPreserved === false) warnings.push('Telegram отправил сообщение без привязки к ответу: исходное сообщение могло быть удалено.');
    if (warnings.length) { $('#delivery-warning').textContent = `Сообщение отправлено. ${warnings.join(' ')}`; $('#delivery-warning').hidden = false; }
    toast(stickerId ? 'Стикер отправлен' : 'Сообщение отправлено'); tg?.HapticFeedback?.notificationOccurred(warnings.length ? 'warning' : 'success');
  } catch (error) {
    if (['delivery_unknown', 'network_error'].includes(error.code)) { state.deliveryUnknown = true; $('#under-note').textContent = 'Проверь чат: результат отправки не подтверждён'; }
    if (error.code === 'telegram_rejected') state.requestId = null;
    if (error.code === 'reply_unavailable') { state.replyInvalid = true; renderReply(); }
    toast(error.message, true);
  } finally { state.sending = false; editor.setEditable(true, false); persist(); renderStats(); if (sent) void conversation.refresh({ bottom: true }); }
};

async function refresh() {
  if (previewMode) return;
  const data = await api('/api/bootstrap'); state.connected = data.connected; state.canReply = data.canReply; state.recipients = data.recipients; state.username = data.username;
  $('#connection-label').textContent = data.canReply ? 'Секретарь подключён' : 'Подключить секретаря'; $('#connection').classList.toggle('connected', data.canReply);
  $('#connection').disabled = Boolean(data.canReply);
  if (!state.sending && state.recipient) {
    const selected = state.recipients.find(r => r.key === state.recipient.key);
    if (!selected) selectRecipient(null); else { state.recipient = selected; conversation.select(selected); }
  }
  if (JSON.stringify([data.packs, data.stickerPacks || []]) !== JSON.stringify([state.packs, state.stickerPacks])) applyCatalog(data.packs, data.stickerPacks || []);
  renderStats(); return data;
}
async function initialize() {
  try {
    const data = await api('/api/catalog'); state.username = data.username; applyCatalog(data.packs, data.stickerPacks || []);
    if (previewMode) {
      $('#notice').hidden = false; $('#notice').textContent = 'Предпросмотр редактора. Отправка доступна при открытии из Telegram.';
      if (!data.packs.length) {
        const chars = ['😀','😄','🥰','😍','🤩','😎','🥹','😉','❤️','🧡','💛','💚','💙','💜','🩷','🤍','🔥','✨','🌟','⚡️','💫','🎉','🎁','🎂','👍','👏','🙌','🙏','👋','🫶','💪','👌','🌸','🌹','🍀','🌿','☀️','🌈','🌙','☕️','🥳','😘','🤗','🫠','🤔','😴','🐱','🦋','💖','💝','💕','💓','🎈','🎀','🥂','🍓'];
        applyCatalog([{ name: 'sample', title: 'Обычные эмодзи · пример', emojis: chars.map((alt, i) => ({ id: `sample-${i}`, alt, demo: true, pack: 'sample' })) }]);
      }
    } else await refresh();
  } catch (e) { toast(e.message, true); }
  bootEditor();
  if (!previewMode && state.recipient) selectRecipient(state.recipient); else renderReply();
  if (state.deliveryUnknown) $('#under-note').textContent = 'Проверь предыдущие отправки в Telegram: результат не подтверждён';
}
document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); else if (!previewMode) { refresh().catch(e => toast(e.message, true)); void conversation.refresh(); } });
window.addEventListener('pagehide', persist);
await initialize();
