const container = document.querySelector('#brand-star');
const motion = matchMedia('(prefers-reduced-motion: reduce)');

Promise.all([
  import('lottie-web/build/player/lottie_light.min.js'),
  fetch('/brand/premium-star.json').then(response => {
    if (!response.ok) throw new Error('Star unavailable');
    return response.json();
  }),
]).then(([{ default: lottie }, starData]) => {
  container.replaceChildren();
  const animation = lottie.loadAnimation({ container, renderer: 'svg', loop: true,
    autoplay: false, animationData: starData });
  const sync = () => {
    if (motion.matches) animation.goToAndStop(0, true);
    else if (document.hidden) animation.pause();
    else animation.play();
  };
  animation.addEventListener('DOMLoaded', sync);
  motion.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
}).catch(() => { container.textContent = '⭐'; });
