const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  const targetRatio = 16 / 9;
  let w = window.innerWidth;
  let h = window.innerHeight;
  const ratio = w / h;

  if (ratio > targetRatio) {
    w = h * targetRatio;
  } else {
    h = w / targetRatio;
  }

  canvas.width = w;
  canvas.height = h;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
}

window.addEventListener('resize', resize);
window.addEventListener('load', resize);
