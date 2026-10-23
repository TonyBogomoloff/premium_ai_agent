import './emoji-scrollbar.css';

function attachScrollbar(panel, { kind, label, observeChildren = false }) {
  const frame = document.createElement('div'); frame.className = `custom-scroll-frame ${kind}-scroll-frame`;
  const bar = document.createElement('div'); bar.className = `custom-scrollbar ${kind}-scrollbar`; bar.hidden = true; bar.tabIndex = 0;
  for (const [name, value] of Object.entries({ role: 'scrollbar', 'aria-label': label, 'aria-controls': panel.id,
    'aria-orientation': 'vertical', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' })) bar.setAttribute(name, value);
  const thumb = document.createElement('span'); bar.append(thumb);
  panel.classList.add('custom-scroll-content');
  panel.before(frame); frame.append(panel, bar);
  let frameId = 0, drag = null;
  function metrics() {
    const range = Math.max(0, panel.scrollHeight - panel.clientHeight), track = bar.clientHeight;
    const size = Math.min(track, Math.max(24, track * panel.clientHeight / Math.max(1, panel.scrollHeight)));
    return { range, size, travel: track - size };
  }
  function update() {
    frameId = 0;
    bar.hidden = panel.scrollHeight <= panel.clientHeight + 1;
    if (bar.hidden) { bar.setAttribute('aria-valuenow', '0'); return; }
    const { range, size, travel } = metrics(), fraction = Math.max(0, Math.min(1, panel.scrollTop / range));
    thumb.style.height = `${size}px`; thumb.style.transform = `translateY(${travel * fraction}px)`;
    bar.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  }
  function schedule() { if (!frameId) frameId = requestAnimationFrame(update); }
  function pointerScale() { return bar.clientHeight / (bar.getBoundingClientRect().height || 1); }
  function stop(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null; bar.classList.remove('dragging');
    if (bar.hasPointerCapture(event.pointerId)) bar.releasePointerCapture(event.pointerId);
  }
  bar.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    const { size, range, travel } = metrics();
    if (event.target !== thumb && travel > 0) panel.scrollTop = ((event.clientY - bar.getBoundingClientRect().top) * pointerScale() - size / 2) / travel * range;
    drag = { id: event.pointerId, y: event.clientY };
    bar.setPointerCapture(event.pointerId); bar.classList.add('dragging'); schedule();
  });
  bar.addEventListener('pointermove', event => {
    if (drag?.id !== event.pointerId) return;
    const { range, travel } = metrics();
    const delta = event.clientY - drag.y; drag.y = event.clientY;
    if (travel > 0) panel.scrollTop += delta * pointerScale() / travel * range;
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) bar.addEventListener(name, stop);
  bar.addEventListener('keydown', event => {
    const positions = { ArrowUp: panel.scrollTop - 40, ArrowDown: panel.scrollTop + 40,
      PageUp: panel.scrollTop - panel.clientHeight, PageDown: panel.scrollTop + panel.clientHeight, Home: 0, End: panel.scrollHeight };
    if (!(event.key in positions)) return;
    event.preventDefault(); panel.scrollTop = positions[event.key];
  });
  panel.addEventListener('scroll', schedule, { passive: true });
  const resize = new ResizeObserver(schedule); resize.observe(panel); resize.observe(bar);
  // Message previews can resize a row after it has already been rendered.
  if (observeChildren) for (const child of panel.children) resize.observe(child);
  new MutationObserver(records => {
    if (observeChildren) for (const record of records) {
      for (const child of record.removedNodes) if (child.nodeType === 1) resize.unobserve(child);
      for (const child of record.addedNodes) if (child.nodeType === 1 && child.parentNode === panel) resize.observe(child);
    }
    schedule();
  }).observe(panel, { childList: true });
  schedule();
}

export function attachEmojiScrollbar(panel) {
  attachScrollbar(panel, { kind: 'emoji', label: 'Прокрутка эмодзи' });
}

export function attachConversationScrollbar(panel) {
  attachScrollbar(panel, { kind: 'conversation', label: 'Прокрутка переписки', observeChildren: true });
}
