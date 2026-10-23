// Download first, prepare one renderer at a time, then start after the UI settles.
const players = new Map(), assets = new Map(), downloads = [], preparations = [];
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const CACHE_BYTES = 8 * 1024 * 1024, CACHE_ITEMS = 96;
let activeDownloads = 0, cachedBytes = 0, preparing = false, settling = false, settleTimer, lottieModule;
const paint = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
const cancelled = () => new DOMException('Emoji left the viewport', 'AbortError');
const synchronize = () => players.forEach(player => player.sync());

function trimAssets() {
  for (const [key, entry] of assets) {
    if (cachedBytes <= CACHE_BYTES && assets.size <= CACHE_ITEMS) break;
    if (!entry.ready) continue;
    assets.delete(key); cachedBytes -= entry.bytes;
  }
}
function pumpDownloads() {
  while (activeDownloads < 4 && downloads.length) {
    const job = downloads.shift(); activeDownloads++;
    (async () => {
      if (![...players.values()].some(player => player.src === job.src && player.visible)) throw cancelled();
      const response = await fetch(job.src, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error('Emoji unavailable');
      if (job.format === 'tgs') {
        const text = await response.text(); return { data: JSON.parse(text), bytes: text.length * 2 };
      }
      const data = await response.blob(); return { data, bytes: data.size };
    })().then(job.resolve, job.reject).finally(() => { activeDownloads--; pumpDownloads(); });
  }
}
function loadAsset(emoji) {
  const key = `${emoji.format}:${emoji.src}`;
  let entry = assets.get(key);
  if (entry) { assets.delete(key); assets.set(key, entry); return entry.promise; }
  entry = { ready: false, bytes: 0 };
  entry.promise = new Promise((resolve, reject) => {
    downloads.push({ src: emoji.src, format: emoji.format, resolve, reject }); pumpDownloads();
  }).then(({ data, bytes }) => {
    entry.ready = true; entry.bytes = bytes; cachedBytes += bytes; trimAssets(); return data;
  }).catch(error => { if (assets.get(key) === entry) assets.delete(key); throw error; });
  assets.set(key, entry); return entry.promise;
}

async function pumpPreparations() {
  if (preparing) return;
  preparing = true; settling = true; clearTimeout(settleTimer); synchronize();
  while (preparations.length) {
    const job = preparations.shift();
    await paint();
    try { job.resolve(await job.run()); } catch (error) { job.reject(error); }
  }
  preparing = false;
  // A quiet interval avoids playing early icons while their neighbours initialize.
  settleTimer = setTimeout(() => { settling = false; synchronize(); }, 120);
}
function prepare(run) {
  return new Promise((resolve, reject) => { preparations.push({ run, resolve, reject }); void pumpPreparations(); });
}
function waitFor(target, event, signal, errors = ['error']) {
  return new Promise((resolve, reject) => {
    const finish = error => {
      clearTimeout(timer); target.removeEventListener(event, success);
      for (const name of errors) target.removeEventListener(name, failure);
      signal.removeEventListener('abort', abort);
      error ? reject(error) : resolve();
    };
    const success = () => finish(), failure = () => finish(new Error('Emoji could not be prepared'));
    const abort = () => finish(cancelled()), timer = setTimeout(failure, 15000);
    target.addEventListener(event, success);
    for (const name of errors) target.addEventListener(name, failure);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}

const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const player = players.get(entry.target);
    if (!player) continue;
    player.visible = entry.isIntersecting;
    if (player.visible) player.start();
    player.sync();
  }
});
document.addEventListener('visibilitychange', () => {
  synchronize();
  if (!document.hidden) players.forEach(player => { if (player.visible) player.start(); });
});
motion.addEventListener('change', () => {
  synchronize(); players.forEach(player => { if (player.visible) player.start(); });
});

export function mountEmoji(container, emoji) {
  container.setAttribute('aria-label', emoji.alt || 'эмодзи'); container.title = emoji.alt || '';
  const fallback = document.createElement('span'); fallback.className = 'emoji-fallback'; fallback.textContent = emoji.alt || '✨';
  container.append(fallback);
  const controller = new AbortController();
  let destroyed = false, loading = false, ready = false, animation, media, layer, objectUrl, thumbnail;
  const alive = () => !destroyed && player.visible && !document.hidden;
  function clearRenderer() {
    animation?.destroy(); animation = null;
    if (media?.tagName === 'VIDEO') { media.pause(); media.removeAttribute('src'); media.load(); }
    media = null; layer?.remove(); layer = null;
    if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null;
  }
  function showThumbnail() {
    if (thumbnail || !emoji.thumbnail) return;
    const img = document.createElement('img'); thumbnail = img; img.alt = emoji.alt || ''; img.decoding = 'async'; img.hidden = true;
    img.onload = () => { if (!destroyed && !ready) { img.hidden = false; fallback.hidden = true; } };
    img.src = emoji.thumbnail; container.append(img);
  }
  const player = {
    src: emoji.src, visible: false,
    sync() {
      const play = ready && player.visible && !document.hidden && !motion.matches && !settling;
      if (animation) play ? animation.play() : animation.pause();
      if (media?.tagName === 'VIDEO') {
        if (play && media.paused) void media.play().catch(() => {});
        else if (!play && !media.paused) media.pause();
      }
    },
    async start() {
      if (destroyed || loading || ready || !emoji.src || !alive()) return;
      if (motion.matches && emoji.format !== 'webp') { showThumbnail(); return; }
      loading = true;
      try {
        const data = await loadAsset(emoji);
        if (!alive()) return;
        if (emoji.format === 'tgs') {
          lottieModule ||= import('lottie-web/build/player/lottie_light.min.js').catch(error => { lottieModule = null; throw error; });
          const { default: lottie } = await lottieModule;
          await prepare(async () => {
            if (!alive()) throw cancelled();
            layer = document.createElement('span'); layer.className = 'emoji-animation'; layer.style.visibility = 'hidden'; container.append(layer);
            animation = lottie.loadAnimation({ container: layer, renderer: 'svg', loop: true, autoplay: false,
              rendererSettings: { progressiveLoad: false }, animationData: structuredClone(data) });
            if (!animation.isLoaded) await waitFor(animation, 'DOMLoaded', controller.signal, ['data_failed', 'error']);
            if (!animation.imagePreloader.loadedImages()) await waitFor(animation, 'loaded_images', controller.signal);
            if (destroyed) throw cancelled();
            animation.goToAndStop(0, true);
            await paint();
            if (destroyed) throw cancelled();
            layer.style.visibility = ''; ready = true;
          });
        } else {
          // Blob URLs guarantee that short video emoji are fully downloaded before playback.
          objectUrl = URL.createObjectURL(data);
          const video = emoji.format === 'webm';
          media = document.createElement(video ? 'video' : 'img');
          layer = document.createElement('span'); layer.className = 'emoji-animation'; layer.style.visibility = 'hidden'; layer.append(media); container.append(layer);
          if (video) {
            media.autoplay = false; media.loop = true; media.muted = true; media.playsInline = true; media.preload = 'auto';
            const loaded = waitFor(media, 'canplaythrough', controller.signal); media.src = objectUrl; await loaded;
          } else {
            media.alt = emoji.alt || ''; media.decoding = 'async';
            const loaded = waitFor(media, 'load', controller.signal); media.src = objectUrl; await loaded; await media.decode();
          }
          if (destroyed) throw cancelled();
          layer.style.visibility = ''; ready = true;
        }
        fallback.hidden = true; if (thumbnail) thumbnail.hidden = true;
        player.sync();
      } catch (error) {
        if (!destroyed) { clearRenderer(); fallback.hidden = false; if (error.name !== 'AbortError') showThumbnail(); }
      } finally { loading = false; }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true; controller.abort(); observer.unobserve(container); players.delete(container); clearRenderer();
      if (thumbnail) { thumbnail.onload = null; thumbnail.removeAttribute('src'); thumbnail.remove(); }
      fallback.remove();
    },
  };
  players.set(container, player); observer.observe(container);
  return player;
}
