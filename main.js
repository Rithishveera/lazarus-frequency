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

// --- Palette ---------------------------------------------------------------

const PALETTE = {
  NORMAL: {
    sky: '#87CEEB',
    skyHorizon: '#C9E8F5',
    ground: '#8B8B83',
    building: '#A0937D',
    buildingDark: '#7A6F5F',
    interior: '#F5E6C8',
    skin: '#D4A574',
    skinDark: '#B8895A',
    hair: '#2C1810',
    text: '#1A1A1A',
    white: '#FFFFFF'
  },
  WORLDB: {
    sky: '#4A0E6B',
    skyHorizon: '#2D0845',
    ground: '#0F0800',
    building: '#3D1F00',
    buildingDark: '#1A0A00',
    interior: '#080400',
    skin: '#8B6F5E',
    skinDark: '#5C4A3E',
    hair: '#1A0A00',
    text: '#D4A843',
    white: '#0F0800',
    amber: '#B5451B',
    amberLight: '#D4A843'
  }
};

// --- Colour helpers ---------------------------------------------------------

function hexToRgb(hex) {
  const clean = hex.replace(/^#/, '');
  const num = parseInt(clean, 16);
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255
  };
}

function rgbToHex(r, g, blue) {
  const toHex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(blue)}`;
}

function lerpColour(hexA, hexB, t) {
  const cA = hexToRgb(hexA);
  const cB = hexToRgb(hexB);
  const r = Math.round(cA.r + (cB.r - cA.r) * t);
  const g = Math.round(cA.g + (cB.g - cA.g) * t);
  const blue = Math.round(cA.b + (cB.b - cA.b) * t);
  return rgbToHex(r, g, blue);
}

function getWorldPalette(t) {
  const allKeys = new Set([...Object.keys(PALETTE.NORMAL), ...Object.keys(PALETTE.WORLDB)]);
  const result = {};
  allKeys.forEach((key) => {
    const a = PALETTE.NORMAL[key] ?? PALETTE.WORLDB[key];
    const b = PALETTE.WORLDB[key] ?? PALETTE.NORMAL[key];
    result[key] = lerpColour(a, b, t);
  });
  return result;
}

// --- Game states ------------------------------------------------------------

const GameState = {
  LOADING: 'LOADING',
  CANTEEN_FREE: 'CANTEEN_FREE',
  CANTEEN_FREEZE: 'CANTEEN_FREEZE',
  CRACK_SEQUENCE: 'CRACK_SEQUENCE',
  FORCED_RUN: 'FORCED_RUN',
  RUN_PLAYER: 'RUN_PLAYER',
  KITCHEN_SILENCE: 'KITCHEN_SILENCE',
  KITCHEN_GRIP: 'KITCHEN_GRIP',
  KITCHEN_RELEASED: 'KITCHEN_RELEASED',
  END_BLACK: 'END_BLACK',
  END_THREAD: 'END_THREAD',
  END_TEXT: 'END_TEXT',
  END_COMPLETE: 'END_COMPLETE'
};

// --- State machine ----------------------------------------------------------

let currentState = GameState.LOADING;
let stateTime = 0;
const stateHistory = [];
const states = {};

function transition(newState) {
  stateHistory.push({ state: newState, timestamp: performance.now() });
  currentState = newState;
  stateTime = 0;
  if (states[newState] && typeof states[newState].init === 'function') {
    states[newState].init();
  }
}
