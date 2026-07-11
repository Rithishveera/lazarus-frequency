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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

// --- Audio Engine -----------------------------------------------------------

let audioCtx = null;
let masterGain = null;
let threadOsc = null;
let threadGain = null;
let canteenNodes = [];
let canteenNoise = null;
let sprintNodes = [];
let sprintIntervalId = null;
let celloOsc = null;
let celloGain = null;
let celloFilter = null;

function initAudio() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  masterGain = audioCtx.createGain();
  masterGain.gain.value = 0.7;
  const compressor = audioCtx.createDynamicsCompressor();
  masterGain.connect(compressor);
  compressor.connect(audioCtx.destination);
  threadOsc = audioCtx.createOscillator();
  threadOsc.type = 'sine';
  threadOsc.frequency.value = 261.63;
  threadGain = audioCtx.createGain();
  threadGain.gain.value = 0;
  threadOsc.connect(threadGain);
  threadGain.connect(masterGain);
  threadOsc.start();
}

function resumeAudio() {
  if (!audioCtx) initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function fadeTo(gainNode, targetVolume, seconds) {
  if (!audioCtx || !gainNode) return;
  const now = audioCtx.currentTime;
  gainNode.gain.cancelScheduledValues(now);
  gainNode.gain.setValueAtTime(gainNode.gain.value, now);
  gainNode.gain.linearRampToValueAtTime(targetVolume, now + seconds);
}

function setThreadVolume(volume, rampSeconds) {
  resumeAudio();
  if (!threadGain) return;
  fadeTo(threadGain, volume, rampSeconds);
}

function playCanteenAmbient() {
  resumeAudio();
  stopCanteenAmbient();
  const now = audioCtx.currentTime;
  [
    { type: 'sine', freq: 110, gain: 0.03 },
    { type: 'triangle', freq: 112, gain: 0.02 },
    { type: 'sine', freq: 115, gain: 0.02 }
  ].forEach(layer => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = layer.type;
    osc.frequency.value = layer.freq;
    gain.gain.value = layer.gain;
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(now);
    canteenNodes.push({ osc, gain });
  });
  const bufferSize = audioCtx.sampleRate * 2;
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 800;
  canteenNoise = noise;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.value = 0.01;
  noise.connect(filter);
  filter.connect(noiseGain);
  noiseGain.connect(masterGain);
  noise.start(now);
}

function stopCanteenAmbient() {
  canteenNodes.forEach(node => {
    try { fadeTo(node.gain, 0, 0.5); } catch (e) {}
    setTimeout(() => { try { node.osc.stop(); } catch (e) {} }, 600);
  });
  canteenNodes = [];
  if (canteenNoise) {
    try { canteenNoise.stop(); } catch (e) {}
    canteenNoise = null;
  }
}

function playSprintTexture() {
  resumeAudio();
  stopSprintTexture();
  const now = audioCtx.currentTime;
  const drone = audioCtx.createOscillator();
  drone.type = 'sawtooth';
  drone.frequency.value = 73;
  const droneFilter = audioCtx.createBiquadFilter();
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 200;
  const droneGain = audioCtx.createGain();
  droneGain.gain.value = 0.08;
  drone.connect(droneFilter);
  droneFilter.connect(droneGain);
  droneGain.connect(masterGain);
  drone.start(now);
  const pulseGain = audioCtx.createGain();
  pulseGain.gain.value = 0;
  pulseGain.connect(masterGain);
  sprintNodes = [{ osc: drone, gain: droneGain, filter: droneFilter, pulseGain }];
  const interval = 60000 / 130;
  sprintIntervalId = setInterval(() => {
    if (!sprintNodes.length) return;
    const pg = sprintNodes[0].pulseGain;
    const t = audioCtx.currentTime;
    pg.gain.cancelScheduledValues(t);
    pg.gain.setValueAtTime(0.15, t);
    pg.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
  }, interval);
}

function stopSprintTexture() {
  if (sprintIntervalId) {
    clearInterval(sprintIntervalId);
    sprintIntervalId = null;
  }
  sprintNodes.forEach(node => {
    try { node.osc.stop(); } catch (e) {}
    try { node.osc.disconnect(); } catch (e) {}
    try { node.gain.disconnect(); } catch (e) {}
    try { node.filter.disconnect(); } catch (e) {}
    try { node.pulseGain.disconnect(); } catch (e) {}
  });
  sprintNodes = [];
}

function playCelloNote() {
  resumeAudio();
  stopCelloNoteAbrupt();
  const now = audioCtx.currentTime;
  celloOsc = audioCtx.createOscillator();
  celloOsc.type = 'sine';
  celloOsc.frequency.value = 146.83;
  celloFilter = audioCtx.createBiquadFilter();
  celloFilter.type = 'lowpass';
  celloFilter.frequency.value = 400;
  celloGain = audioCtx.createGain();
  celloGain.gain.setValueAtTime(0, now);
  celloGain.gain.linearRampToValueAtTime(0.12, now + 1.5);
  celloOsc.connect(celloFilter);
  celloFilter.connect(celloGain);
  celloGain.connect(masterGain);
  celloOsc.start(now);
}

function stopCelloNoteAbrupt() {
  if (!celloOsc) return;
  const now = audioCtx.currentTime;
  try { celloGain.gain.setValueAtTime(0, now); } catch (e) {}
  try { celloOsc.stop(now + 0.01); } catch (e) {}
  celloOsc = null;
  celloGain = null;
  celloFilter = null;
}

function killAllAudio() {
  stopCanteenAmbient();
  stopSprintTexture();
  stopCelloNoteAbrupt();
  if (threadGain) fadeTo(threadGain, 0, 0.1);
}

function setupAudioResume() {
  const resume = () => {
    resumeAudio();
    document.removeEventListener('click', resume);
    document.removeEventListener('keydown', resume);
  };
  document.addEventListener('click', resume);
  document.addEventListener('keydown', resume);
}

setupAudioResume();

// --- Input -------------------------------------------------------------------

const keys = {};

function onKeyDown(e) {
  keys[e.code] = true;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
    e.preventDefault();
  }
}

function onKeyUp(e) {
  keys[e.code] = false;
  if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
    e.preventDefault();
  }
}

function isSprinting() { return !!keys['ShiftLeft'] || !!keys['ShiftRight']; }
function isMovingLeft() { return !!keys['ArrowLeft'] || !!keys['KeyA']; }
function isMovingRight() { return !!keys['ArrowRight'] || !!keys['KeyD']; }
function isGripping() { return !!keys['Space']; }

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

// --- Camera ------------------------------------------------------------------

const camera = { x: 0, targetX: 0, smoothing: 0.1 };

function updateCamera(targetX) {
  camera.targetX = targetX;
  const dest = targetX - canvas.width * 0.3;
  camera.x += (dest - camera.x) * camera.smoothing;
}

function resetCamera(x) {
  camera.x = x;
  camera.targetX = x;
}

// --- Draw functions ----------------------------------------------------------

function drawSky(palette) {
  const halfH = canvas.height * 0.6;
  const grad = ctx.createLinearGradient(0, 0, 0, halfH);
  grad.addColorStop(0, palette.sky);
  grad.addColorStop(1, palette.skyHorizon);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, halfH);
}

function drawGround(palette) {
  const y = canvas.height * 0.6;
  ctx.fillStyle = palette.ground;
  ctx.fillRect(0, y, canvas.width, canvas.height - y);
}

function drawBuilding(x, width, height, palette) {
  const groundY = canvas.height * 0.6;
  const y = groundY - height;
  ctx.fillStyle = palette.building;
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = palette.buildingDark;
  ctx.fillRect(x + width * 0.7, y, width * 0.3, height);
  const winCols = Math.floor(width / 20);
  const winRows = Math.floor(height / 30);
  const winW = 10;
  const winH = 16;
  ctx.fillStyle = palette.interior;
  for (let r = 0; r < winRows; r++) {
    for (let c = 0; c < winCols; c++) {
      if ((r + c) % 2 === 0) {
        const wx = x + 8 + c * 20;
        const wy = y + 10 + r * 30;
        if (wx + winW < x + width * 0.7) {
          ctx.fillRect(wx, wy, winW, winH);
        }
      }
    }
  }
}

function drawCharacter(x, y, palette, scale, facingRight) {
  const headR = 12 * scale;
  const bodyLen = 40 * scale;
  const upperLen = 20 * scale;
  const lowerLen = 20 * scale;
  ctx.save();
  if (!facingRight) {
    ctx.translate(x * 2, 0);
    ctx.scale(-1, 1);
  }
  ctx.strokeStyle = palette.skin;
  ctx.lineWidth = 4 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y - headR - bodyLen, headR, 0, Math.PI * 2);
  ctx.fillStyle = palette.skin;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y - headR - bodyLen, headR + 4 * scale, Math.PI, 0);
  ctx.strokeStyle = palette.hair;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - headR - bodyLen + headR);
  ctx.lineTo(x, y);
  ctx.strokeStyle = palette.skin;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y - headR - bodyLen + headR * 1.5);
  ctx.lineTo(x - upperLen, y - headR - bodyLen + headR * 1.5 + upperLen);
  ctx.lineTo(x - upperLen - lowerLen * 0.5, y - headR - bodyLen + headR * 1.5 + upperLen + lowerLen);
  ctx.moveTo(x, y - headR - bodyLen + headR * 1.5);
  ctx.lineTo(x + upperLen, y - headR - bodyLen + headR * 1.5 + upperLen);
  ctx.lineTo(x + upperLen + lowerLen * 0.5, y - headR - bodyLen + headR * 1.5 + upperLen + lowerLen);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - upperLen * 0.8, y + upperLen);
  ctx.lineTo(x - upperLen * 1.2, y + upperLen + lowerLen);
  ctx.moveTo(x, y);
  ctx.lineTo(x + upperLen * 0.8, y + upperLen);
  ctx.lineTo(x + upperLen * 1.2, y + upperLen + lowerLen);
  ctx.stroke();
  ctx.restore();
}

function drawAmberLight(x, y, radius, opacity) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const grad = ctx.createRadialGradient(x, y, radius * 0.1, x, y, radius);
  grad.addColorStop(0, `rgba(212,168,67,${opacity})`);
  grad.addColorStop(0.5, `rgba(181,69,27,${opacity * 0.2})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function drawTimer(seconds) {
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  ctx.font = '24px "Share Tech Mono"';
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'right';
  ctx.fillText(`${m}:${s}`, canvas.width - 20, canvas.height - 20);
}

function drawWorldLabel(text, colour) {
  ctx.font = '12px "Share Tech Mono"';
  ctx.fillStyle = colour;
  ctx.textAlign = 'left';
  ctx.fillText(text, 20, canvas.height - 20);
}

function drawFlash(colour) {
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

// --- Player ------------------------------------------------------------------

const player = {
  x: 0,
  y: 0,
  scale: 1.2,
  facingRight: true,
  speed: 3,
  stamina: 100,
  vx: 0
};

// --- State implementations ---------------------------------------------------

states[GameState.CANTEEN_FREE] = {
  init() {
    player.x = canvas.width * 0.3;
    player.y = canvas.height * 0.6;
    player.facingRight = true;
    resetCamera(player.x);
    playCanteenAmbient();
  },
  update() {
    let dx = 0;
    if (isMovingLeft()) dx -= player.speed;
    if (isMovingRight()) dx += player.speed;
    player.x += dx;
    updateCamera(player.x);
    if (stateTime >= 15000) {
      transition(GameState.CANTEEN_FREEZE);
    }
  },
  render() {
    const palette = PALETTE.NORMAL;
    drawSky(palette);
    drawGround(palette);
    drawBuilding(canvas.width * 0.2, canvas.width * 0.25, canvas.height * 0.35, palette);
    drawCharacter(player.x - camera.x, player.y, palette, player.scale, player.facingRight);
    drawTimer(stateTime / 1000);
    drawWorldLabel('CANTEEN // FREE', palette.text);
  }
};

states[GameState.CANTEEN_FREEZE] = {
  init() {
    stopCanteenAmbient();
  },
  update() {
    if (stateTime >= 2000) {
      transition(GameState.CRACK_SEQUENCE);
    }
  },
  render() {
    const palette = PALETTE.NORMAL;
    drawSky(palette);
    drawGround(palette);
    drawBuilding(canvas.width * 0.2, canvas.width * 0.25, canvas.height * 0.35, palette);
    drawCharacter(player.x - camera.x, player.y, palette, player.scale, player.facingRight);
  }
};

states[GameState.CRACK_SEQUENCE] = {
  init() {
    stopCanteenAmbient();
    this.flashDone = false;
    this.figureFacing = true;
    this.turned = false;
  },
  update() {
    if (stateTime >= 5000) {
      transition(GameState.FORCED_RUN);
    }
  },
  render() {
    const palette = PALETTE.WORLDB;
    
    if (!this.flashDone && stateTime >= 500) {
      this.flashDone = true;
      drawFlash(palette.ground);
      return;
    }
    
    drawSky(palette);
    drawGround(palette);
    
    if (stateTime >= 500 && stateTime < 3000) {
      drawCharacter(player.x - camera.x, player.y, palette, player.scale, this.figureFacing);
    }
    
    if (stateTime >= 3000 && !this.turned) {
      this.turned = true;
      this.figureFacing = false;
    }
    
    if (stateTime >= 3000 && stateTime < 4000) {
      drawCharacter(player.x - camera.x, player.y, palette, player.scale, this.figureFacing);
    }
  }
};

const runBuildings = [
  { worldX: 300, width: 200, height: 280 },
  { worldX: 700, width: 180, height: 220 },
  { worldX: 1200, width: 240, height: 300 },
  { worldX: 1800, width: 160, height: 200 },
  { worldX: 2400, width: 220, height: 260 },
  { worldX: 3200, width: 200, height: 240 },
  { worldX: 3800, width: 180, height: 280 }
];

states[GameState.FORCED_RUN] = {
  init() {
    player.stamina = 100;
    player.x += 200;
    player.facingRight = true;
    playSprintTexture();
  },
  update() {
    player.x += 400 * (frameDt / 1000);
    updateCamera(player.x);
    if (stateTime >= 2000) {
      stopSprintTexture();
      transition(GameState.RUN_PLAYER);
    }
  },
  render() {
    const progress = clamp(player.x / 4000, 0, 1);
    const palette = getWorldPalette(progress);
    drawSky(palette);
    drawGround(palette);
    drawCharacter(player.x - camera.x, player.y, palette, player.scale, true);
    drawTimer(stateTime / 1000);
    runBuildings.forEach(b => {
      const sx = b.worldX - camera.x;
      if (sx + b.width > 0 && sx < canvas.width) {
        drawBuilding(sx, b.width, b.height, palette);
      }
    });
    drawWorldLabel('RUNNING', palette.text);
  }
};

states[GameState.RUN_PLAYER] = {
  init() {
    this.stillTime = 0;
    this.progress = 0;
  },
  update() {
    const walkSpeed = 120;
    const sprintSpeed = 320;
    const backSpeed = 60;
    const staminaDrain = 25;
    const staminaRegen = 15;
    const dtSec = frameDt / 1000;

    let currentSpeed = 0;

    if (isMovingRight()) {
      player.facingRight = true;
      if (isSprinting() && player.stamina > 0) {
        currentSpeed = sprintSpeed;
        player.stamina = Math.max(0, player.stamina - staminaDrain * dtSec);
      } else {
        currentSpeed = walkSpeed;
        player.stamina = Math.min(100, player.stamina + staminaRegen * dtSec);
      }
    } else if (isMovingLeft()) {
      currentSpeed = -backSpeed;
      player.facingRight = false;
      player.stamina = Math.min(100, player.stamina + staminaRegen * dtSec);
    } else {
      player.stamina = Math.min(100, player.stamina + staminaRegen * dtSec);
    }

    if (currentSpeed === 0) {
      this.stillTime += frameDt;
      if (this.stillTime >= 2000) {
        transition(GameState.RUN_DEAD);
        return;
      }
    } else {
      this.stillTime = 0;
    }

    player.vx = currentSpeed;
    player.x += currentSpeed * dtSec;
    updateCamera(player.x);

    this.progress = clamp(player.x / 4000, 0, 1);

    if (player.x >= 4000) {
      transition(GameState.KITCHEN_SILENCE);
    }
  },
  render() {
    const progress = this.progress || 0;
    const palette = getWorldPalette(progress);
    drawSky(palette);
    drawGround(palette);
    drawCharacter(player.x - camera.x, player.y, palette, player.scale, player.facingRight);
    runBuildings.forEach(b => {
      const sx = b.worldX - camera.x;
      if (sx + b.width > 0 && sx < canvas.width) {
        drawBuilding(sx, b.width, b.height, palette);
      }
    });
    drawWorldLabel('RUNNING // CONTROLLED', palette.text);
  }
};

states[GameState.RUN_DEAD] = {
  init() {
    player.x -= 150;
    player.vx = 0;
  },
  update() {
    if (stateTime >= 1000) {
      transition(GameState.RUN_PLAYER);
    }
  },
  render() {
    const progress = clamp(player.x / 4000, 0, 1);
    const palette = getWorldPalette(progress);
    drawSky(palette);
    drawGround(palette);
    runBuildings.forEach(b => {
      const sx = b.worldX - camera.x;
      if (sx + b.width > 0 && sx < canvas.width) {
        drawBuilding(sx, b.width, b.height, palette);
      }
    });
    drawCharacter(player.x - camera.x, player.y, palette, player.scale, player.facingRight);
    drawWorldLabel('DEAD // RESET', palette.text);
  }
};

// --- Main loop ----------------------------------------------------------------

let lastTime = performance.now();
let frameDt = 0;

function loop() {
  const now = performance.now();
  frameDt = Math.min(now - lastTime, 100);
  lastTime = now;
  
  stateTime += frameDt;
  
  const current = states[currentState];
  if (current) {
    if (typeof current.update === 'function') current.update();
    if (typeof current.render === 'function') current.render();
  }
  
  requestAnimationFrame(loop);
}

window.addEventListener('resize', resize);
window.addEventListener('load', () => {
  resize();
  transition(GameState.CANTEEN_FREE);
  requestAnimationFrame(loop);
});
