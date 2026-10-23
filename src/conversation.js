export function messageSummary(message) {
  return message.deleted ? 'Сообщение удалено' : message.text || [message.media?.label, message.media?.name].filter(Boolean).join(' · ') || 'Сообщение';
}

const dayKey = timestamp => new Date(timestamp * 1000).toLocaleDateString('sv');
function dayLabel(timestamp) {
  const date = new Date(timestamp * 1000), today = new Date(), yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Сегодня';
  if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
  return date.toLocaleDateString('ru', { day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
}
const grouped = (a, b) => a && b && !a.deleted && !b.deleted && a.outgoing === b.outgoing && dayKey(a.date) === dayKey(b.date) && Math.abs(b.date - a.date) < 300;

export function setupConversation({ api, initData, onReply, onMessages, blocked }) {
  const $ = id => document.getElementById(id);
  const list = $('conversation-messages'), status = $('conversation-status');
  let recipient = null, messages = [], version = 0, timer, inflight = -1, fingerprint = '', selected = null, first = true, observer;
  const urls = new Map();
  let mediaController = new AbortController();
  const atBottom = () => list.scrollHeight - list.clientHeight - list.scrollTop < 60;
  function clearMedia() { mediaController.abort(); mediaController = new AbortController(); observer?.disconnect(); urls.forEach(url => URL.revokeObjectURL(url)); urls.clear(); }
  function toBottom() { list.scrollTop = list.scrollHeight; $('conversation-new').hidden = true; }
  $('conversation-new').onclick = toBottom;
  list.addEventListener('scroll', () => { if (atBottom()) $('conversation-new').hidden = true; }, { passive: true });

  function render(scrollBottom) {
    const oldTop = list.scrollTop, rect = list.getBoundingClientRect();
    const anchor = [...list.querySelectorAll('.history-message')].find(e => e.getBoundingClientRect().bottom > rect.top);
    const anchorId = anchor?.dataset.messageId, anchorOffset = anchor ? anchor.getBoundingClientRect().top - rect.top : 0;
    observer?.disconnect(); mediaController.abort(); mediaController = new AbortController(); list.replaceChildren();
    const byId = new Map(messages.map(m => [m.id, m]));
    const validMedia = new Set(messages.filter(m => m.media?.preview && !m.deleted).map(m => `${m.id}:${m.edited}`));
    for (const [key, url] of urls) if (!validMedia.has(key)) { URL.revokeObjectURL(url); urls.delete(key); }
    const currentVersion = version, currentRecipient = recipient, mediaSignal = mediaController.signal;
    const queue = []; let active = 0;
    async function loadPreview(img) {
      active++;
      try {
        const response = await fetch(`/api/history/media?recipient=${encodeURIComponent(currentRecipient.key)}&id=${img.dataset.id}`, { headers: { Authorization: `tma ${initData}` }, signal: mediaSignal });
        if (!response.ok) throw Error();
        const blob = await response.blob();
        if (version !== currentVersion || !img.isConnected) return;
        const stick = atBottom(), top = list.scrollTop;
        const url = URL.createObjectURL(blob); urls.set(img.dataset.cacheKey, url);
        img.onload = () => { if (stick && Math.abs(list.scrollTop - top) < 2) toBottom(); };
        img.src = url; img.hidden = false;
      } catch { /* The media label remains available when a thumbnail cannot be loaded. */ }
      finally { active--; if (queue.length && version === currentVersion && !mediaSignal.aborted) void loadPreview(queue.shift()); }
    }
    observer = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) {
        observer.unobserve(e.target); const img = e.target.querySelector('img[data-id]');
        if (active < 2) void loadPreview(img); else queue.push(img);
      }
    }, { root: list, rootMargin: '80px' });
    for (const [index, message] of messages.entries()) {
      if (!index || dayKey(messages[index - 1].date) !== dayKey(message.date)) {
        const divider = document.createElement('div'); divider.className = 'history-date';
        const label = document.createElement('span'); label.textContent = dayLabel(message.date); divider.append(label); list.append(divider);
      }
      const row = document.createElement('article'); row.className = `history-message ${message.outgoing ? 'outgoing' : 'incoming'}`;
      row.dataset.messageId = message.id; row.classList.toggle('selected', message.id === selected);
      row.classList.toggle('grouped-before', !!grouped(messages[index - 1], message));
      row.classList.toggle('grouped-after', !!grouped(message, messages[index + 1]));
      const timestamp = new Date(message.date * 1000), fullDate = timestamp.toLocaleString('ru');
      row.setAttribute('aria-label', `${message.outgoing ? 'Ты' : recipient.name}, ${fullDate}`);
      if (message.replyTo) {
        const quote = document.createElement('div'); quote.className = 'history-quote';
        const original = byId.get(message.replyTo), author = document.createElement('strong'), excerpt = document.createElement('span');
        author.textContent = original ? (original.outgoing ? 'Ты' : recipient.name) : 'Ответ на сообщение';
        excerpt.textContent = original ? messageSummary(original).slice(0, 140) : 'Более раннее сообщение';
        quote.append(author, excerpt); row.append(quote);
      }
      if (message.media && !message.deleted) {
        const media = document.createElement('div'); media.className = 'history-media';
        const label = document.createElement('span'); label.textContent = [message.media.label, message.media.name, message.media.size ? `${(message.media.size / 1_000_000).toFixed(1)} МБ` : ''].filter(Boolean).join(' · '); media.append(label);
        if (message.media.preview) {
          const img = document.createElement('img'); img.alt = message.media.label; img.hidden = true;
          const key = `${message.id}:${message.edited}`; img.dataset.id = message.id; img.dataset.cacheKey = key;
          if (urls.has(key)) { img.src = urls.get(key); img.hidden = false; }
          else observer.observe(media);
          media.append(img);
        }
        row.append(media);
      }
      const text = document.createElement('div'); text.className = 'history-text';
      if (message.deleted) { text.textContent = 'Сообщение удалено'; row.classList.add('deleted'); }
      else renderText(text, message.text, message.entities);
      row.append(text);
      const footer = document.createElement('div'); footer.className = 'history-meta';
      if (!message.deleted) {
        const reply = document.createElement('button'); reply.type = 'button'; reply.className = 'history-reply'; reply.disabled = blocked();
        const arrow = document.createElement('span'); arrow.textContent = '↩'; arrow.setAttribute('aria-hidden', 'true'); reply.append(arrow, 'Ответить');
        reply.onclick = () => { if (!blocked()) onReply(message); }; footer.append(reply);
      }
      const date = document.createElement('time'); date.dateTime = timestamp.toISOString(); date.title = fullDate;
      date.textContent = (message.edited ? 'изм. ' : '') + timestamp.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
      footer.append(date); row.append(footer);
      list.append(row);
    }
    if (!messages.length) { const empty = document.createElement('p'); empty.className = 'history-empty'; empty.textContent = 'Пока нет сообщений. Здесь появятся новые входящие и исходящие сообщения, доступные боту.'; list.append(empty); }
    if (scrollBottom) toBottom();
    else {
      const replacement = [...list.querySelectorAll('.history-message')].find(e => e.dataset.messageId === anchorId);
      list.scrollTop = replacement ? replacement.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop - anchorOffset : oldTop;
      $('conversation-new').hidden = atBottom();
    }
  }

  async function refresh({ bottom = false } = {}) {
    clearTimeout(timer);
    if (!recipient || recipient.kind && recipient.kind !== 'private' || document.hidden || inflight === version) return;
    const ownVersion = version; inflight = ownVersion;
    try {
      const data = await api(`/api/history?recipient=${encodeURIComponent(recipient.key)}`);
      if (version !== ownVersion) return;
      const next = JSON.stringify(data.messages);
      if (next !== fingerprint) {
        const scrollBottom = bottom || first || atBottom(); messages = data.messages; fingerprint = next;
        render(scrollBottom); first = false;
      } else if (bottom) toBottom();
      status.textContent = `${messages.length} из последних 100 сообщений`;
      onMessages(messages, data.canReply);
    } catch (error) {
      if (version !== ownVersion) return;
      status.textContent = error.message;
      if ([401, 403].includes(error.status)) { messages = []; fingerprint = ''; list.replaceChildren(); clearMedia(); onMessages([], false); }
    } finally {
      if (version === ownVersion) { inflight = -1; timer = setTimeout(refresh, 6000); }
    }
  }
  function select(next) {
    if (recipient?.key === next?.key) { recipient = next; return; }
    version++; clearTimeout(timer); clearMedia(); recipient = next; messages = []; fingerprint = ''; selected = null; first = true;
    list.replaceChildren(); $('conversation-new').hidden = true;
    list.hidden = !next;
    $('conversation-info').hidden = !next;
    if (!next) { status.textContent = ''; return; }
    $('conversation-info').hidden = !!next.kind && next.kind !== 'private';
    status.textContent = next.kind && next.kind !== 'private' ? 'История здесь доступна для личных диалогов секретаря.' : 'Загружаем переписку…';
    void refresh();
  }
  return { select, refresh, highlight(id) { selected = id; for (const row of list.children) row.classList.toggle('selected', Number(row.dataset.messageId) === id); },
    update() { for (const button of list.querySelectorAll('.history-reply')) button.disabled = blocked(); } };
}

function renderText(target, text, entities = []) {
  const marks = { bold: 'history-bold', italic: 'history-italic', underline: 'history-underline', strikethrough: 'history-strike', code: 'history-code', pre: 'history-code', spoiler: 'history-spoiler' };
  const relevant = entities.filter(e => marks[e.type] || e.type === 'text_link');
  const points = [...new Set([0, text.length, ...relevant.flatMap(e => [e.offset, e.offset + e.length])])].sort((a, b) => a - b);
  for (let i = 1; i < points.length; i++) {
    const active = relevant.filter(e => e.offset <= points[i-1] && e.offset + e.length >= points[i]);
    const link = active.find(e => e.type === 'text_link' && /^https?:\/\//i.test(e.url));
    const span = document.createElement(link ? 'a' : 'span'); span.textContent = text.slice(points[i-1], points[i]);
    span.className = active.map(e => marks[e.type]).filter(Boolean).join(' ');
    if (link) { span.href = link.url; span.target = '_blank'; span.rel = 'noopener noreferrer'; }
    if (active.some(e => e.type === 'spoiler')) span.onclick = event => { event.preventDefault(); span.classList.toggle('revealed'); };
    target.append(span);
  }
}
