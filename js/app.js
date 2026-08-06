/**
 * Sprint Timer Pro — dual-phone precision sprint timing
 */

/* ===================== Config ===================== */
const CONFIG = {
  requiredFrames: 3,          // consecutive frames above threshold
  pixelThreshold: 16,         // luminance delta per pixel
  requiredPixels: 90,         // changed pixels in band to count as motion
  warmupFrames: 30,           // ignore after arm (~0.5–1s)
  bandRatio: 0.035,           // half-width of detection band vs frame width
  sampleStep: 2,              // skip pixels for speed
  cooldownMs: 800,            // ignore new triggers briefly after an event
  peerDebug: 1
};

/* ===================== State ===================== */
const state = {
  role: null,                 // 'start' | 'finish'
  peer: null,
  conn: null,
  cameraReady: false,
  running: false,
  calibrating: false,
  startTime: null,            // performance.now() local
  confidence: 0,
  sensitivity: 14,
  lastFrame: null,
  framesToSkip: 0,
  clockOffset: 0,
  lineXRatio: 0.5,            // 0–1 horizontal position of detection line
  lastTriggerAt: 0,
  history: [],
  distanceM: null,
  wakeLock: null
};

/* ===================== DOM ===================== */
const $ = (id) => document.getElementById(id);
const video = $('cam');
const canvas = $('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });
const statusBar = $('statusBar');
const detectLine = $('detectLine');
const flashEl = $('flash');

/* ===================== UI helpers ===================== */
function setStatus(text, cls) {
  statusBar.textContent = text;
  statusBar.className = 'status ' + cls;
}

function setConnBadge(online, latencyMs) {
  const el = $('connBadge');
  if (online) {
    el.className = 'conn-badge online';
    el.textContent = latencyMs != null ? `Linked · ${Math.round(latencyMs)} ms` : 'Linked';
  } else {
    el.className = 'conn-badge offline';
    el.textContent = 'Offline';
  }
}

function flash() {
  flashEl.classList.add('on');
  setTimeout(() => flashEl.classList.remove('on'), 120);
  detectLine.classList.add('active');
  setTimeout(() => detectLine.classList.remove('active'), 350);
}

function beep(freq = 880, ms = 120) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.value = freq;
    o.type = 'sine';
    g.gain.value = 0.15;
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + ms / 1000);
    o.stop(ac.currentTime + ms / 1000);
  } catch (_) {}
}

function vibrate(pattern = [40, 30, 40]) {
  try { navigator.vibrate?.(pattern); } catch (_) {}
}

async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      state.wakeLock = await navigator.wakeLock.request('screen');
    }
  } catch (_) {}
}

/* ===================== Pairing ===================== */
function generateCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

function chooseRole(role) {
  state.role = role;
  $('btnStart').classList.toggle('active', role === 'start');
  $('btnFinish').classList.toggle('active', role === 'finish');
  $('startUI').hidden = role !== 'start';
  $('finishUI').hidden = role !== 'finish';
  if (role === 'start') createStartPeer();
}

function createStartPeer(attempt = 0) {
  if (state.peer) {
    try { state.peer.destroy(); } catch (_) {}
  }
  const code = generateCode();
  state.peer = new Peer(code, { debug: CONFIG.peerDebug });

  state.peer.on('open', (id) => {
    $('roomCodeDisplay').textContent = id;
    setStatus('START — share code', 'waiting');
  });

  state.peer.on('connection', (c) => {
    state.conn = c;
    onConnected();
  });

  state.peer.on('error', (err) => {
    console.error(err);
    if (err.type === 'unavailable-id' && attempt < 6) {
      state.peer.destroy();
      createStartPeer(attempt + 1);
    } else {
      setStatus('Error: ' + (err.type || 'peer'), 'error');
    }
  });
}

function joinAsFinish() {
  const code = $('roomCodeInput').value.trim();
  if (!/^\d{5}$/.test(code)) {
    alert('Enter a valid 5-digit code');
    return;
  }
  if (state.peer) {
    try { state.peer.destroy(); } catch (_) {}
  }
  state.peer = new Peer({ debug: CONFIG.peerDebug });

  state.peer.on('open', () => {
    state.conn = state.peer.connect(code, { reliable: true });
    state.conn.on('open', onConnected);
    state.conn.on('error', () => setStatus('Connection failed', 'error'));
  });

  state.peer.on('error', (err) => {
    console.error(err);
    setStatus('Error: ' + (err.type || 'peer'), 'error');
  });
}

function onConnected() {
  setStatus('Connected', 'connected');
  setConnBadge(true);
  $('pairingPanel').hidden = true;
  $('mainPanel').hidden = false;
  $('roleLabel').textContent =
    state.role === 'start' ? 'This phone = START line' : 'This phone = FINISH line';

  state.conn.on('data', handleRemoteMessage);
  state.conn.on('close', () => {
    setStatus('Connection lost', 'error');
    setConnBadge(false);
    state.running = false;
  });

  // Clock sync from start side
  if (state.role === 'start') {
    setTimeout(() => {
      if (state.conn?.open) {
        state.conn.send({ type: 'sync-ping', t: performance.now() });
      }
    }, 300);
  }
}

/* ===================== Camera ===================== */
async function enableCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      },
      audio: false
    });
    video.srcObject = stream;
    await video.play();
    state.cameraReady = true;

    $('enableCameraBox').hidden = true;
    $('cameraBox').hidden = false;
    $('controlButtons').hidden = false;
    $('settingsBox').hidden = false;
    $('historyPanel').hidden = false;

    await requestWakeLock();
    setStatus('Armed', 'armed');
    armSystem(true);
    setupLineDrag();
  } catch (err) {
    console.error(err);
    alert(
      'Camera error: ' + err.message +
      '\n\nOn iPhone open this page in Safari and allow camera access.'
    );
    setStatus('Camera denied', 'error');
  }
}

/* ===================== Draggable detection line ===================== */
function setupLineDrag() {
  let dragging = false;

  const move = (clientX) => {
    const rect = $('cameraBox').getBoundingClientRect();
    let ratio = (clientX - rect.left) / rect.width;
    ratio = Math.max(0.08, Math.min(0.92, ratio));
    state.lineXRatio = ratio;
    detectLine.style.left = (ratio * 100) + '%';
  };

  detectLine.addEventListener('pointerdown', (e) => {
    dragging = true;
    detectLine.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  detectLine.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    move(e.clientX);
  });
  detectLine.addEventListener('pointerup', () => { dragging = false; });
  detectLine.addEventListener('pointercancel', () => { dragging = false; });
}

/* ===================== Messaging ===================== */
function handleRemoteMessage(msg) {
  if (msg.type === 'sync-ping') {
    state.conn.send({ type: 'sync-pong', t0: msg.t, t1: performance.now() });
  }
  if (msg.type === 'sync-pong') {
    const now = performance.now();
    const rtt = now - msg.t0;
    state.clockOffset = msg.t1 - msg.t0 - rtt / 2;
    setConnBadge(true, rtt);
  }
  if (msg.type === 'start') {
    state.startTime = msg.t - state.clockOffset;
    setStatus('Start detected', 'running');
    startLiveTimer();
    flash();
    beep(660, 90);
    vibrate([30]);
  }
  if (msg.type === 'finish') {
    const elapsed = (msg.t - state.startTime) / 1000;
    finishRace(elapsed);
  }
  if (msg.type === 'reset') {
    armSystem(true);
  }
}

/* ===================== System control ===================== */
function armSystem(silent = false) {
  if (!state.cameraReady) return;

  state.running = true;
  state.calibrating = false;
  state.startTime = null;
  state.confidence = 0;
  state.lastFrame = null;
  state.framesToSkip = CONFIG.warmupFrames;

  $('calibrationPanel').hidden = true;
  $('timer').textContent = '0.000';
  $('speedRow').hidden = true;

  if (state._timerInterval) {
    clearInterval(state._timerInterval);
    state._timerInterval = null;
  }

  if (!silent) setStatus('Armed', 'armed');
  if (state.conn?.open) state.conn.send({ type: 'reset' });

  detect();
}

function toggleCalibration() {
  state.calibrating = !state.calibrating;
  $('calibrationPanel').hidden = !state.calibrating;
  setStatus(
    state.calibrating ? 'Calibration mode' : 'Armed',
    state.calibrating ? 'calibrating' : 'armed'
  );
  if (!state.calibrating) armSystem(true);
  else {
    state.running = false;
    detect();
  }
}

function startLiveTimer() {
  if (state._timerInterval) clearInterval(state._timerInterval);
  state._timerInterval = setInterval(() => {
    if (state.startTime != null) {
      const elapsed = (performance.now() - state.startTime) / 1000;
      $('timer').textContent = elapsed.toFixed(3);
    }
  }, 16);
}

function finishRace(elapsedSec) {
  $('timer').textContent = elapsedSec.toFixed(3);
  setStatus('Finished', 'finished');
  state.running = false;
  if (state._timerInterval) {
    clearInterval(state._timerInterval);
    state._timerInterval = null;
  }
  flash();
  beep(1100, 160);
  vibrate([50, 40, 80]);
  updateSpeed(elapsedSec);
  addHistory(elapsedSec);
}

function updateSpeed(elapsedSec) {
  const dist = parseFloat($('distanceInput').value);
  if (!dist || dist <= 0 || !elapsedSec) {
    $('speedRow').hidden = true;
    return;
  }
  state.distanceM = dist;
  const ms = dist / elapsedSec;
  const unit = $('speedUnit').value;
  let display = ms;
  if (unit === 'kmh') display = ms * 3.6;
  if (unit === 'mph') display = ms * 2.23694;
  $('speedValue').textContent = display.toFixed(2);
  $('speedRow').hidden = false;
}

function addHistory(elapsedSec) {
  const entry = {
    t: elapsedSec,
    at: new Date().toLocaleTimeString(),
    speed: state.distanceM ? state.distanceM / elapsedSec : null
  };
  state.history.unshift(entry);
  if (state.history.length > 30) state.history.pop();
  renderHistory();
}

function renderHistory() {
  const list = $('historyList');
  list.innerHTML = '';
  if (!state.history.length) {
    list.innerHTML = '<li class="meta">No times yet</li>';
    return;
  }
  const best = Math.min(...state.history.map((h) => h.t));
  state.history.forEach((h) => {
    const li = document.createElement('li');
    if (h.t === best) li.classList.add('best');
    const speedStr = h.speed != null ? ` · ${h.speed.toFixed(2)} m/s` : '';
    li.innerHTML = `
      <span class="time">${h.t.toFixed(3)} s</span>
      <span class="meta">${h.at}${speedStr}${h.t === best ? ' · best' : ''}</span>
    `;
    list.appendChild(li);
  });
}

/* ===================== Motion detection ===================== */
function detect() {
  if (!state.running && !state.calibrating) return;
  processFrame();
  requestAnimationFrame(detect);
}

function processFrame() {
  if (video.readyState < 2) return;

  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;

  canvas.width = w;
  canvas.height = h;
  ctx.drawImage(video, 0, 0, w, h);
  const frame = ctx.getImageData(0, 0, w, h);

  if (state.framesToSkip > 0) {
    state.framesToSkip--;
    state.lastFrame = frame;
    return;
  }

  if (state.lastFrame) {
    const motion = motionAtLine(frame, state.lastFrame, w, h);

    if (state.calibrating) {
      const bar = $('motionBar');
      if (bar) bar.style.width = Math.min(100, motion) + '%';
    }

    if (state.running) {
      const now = performance.now();
      if (now - state.lastTriggerAt < CONFIG.cooldownMs) {
        state.confidence = 0;
      } else if (motion > state.sensitivity) {
        state.confidence++;
      } else {
        state.confidence = Math.max(0, state.confidence - 1);
      }

      if (state.confidence >= CONFIG.requiredFrames) {
        state.confidence = 0;
        state.lastTriggerAt = now;
        onMotionTriggered();
      }
    }
  }

  state.lastFrame = frame;
}

/**
 * Improved line-crossing motion:
 * - Samples a vertical band around the detection line
 * - Uses luminance difference
 * - Early exit when enough changed pixels found
 * - Returns 0–100 strength score
 */
function motionAtLine(cur, prev, w, h) {
  const lineX = Math.floor(w * state.lineXRatio);
  const band = Math.max(3, Math.floor(w * CONFIG.bandRatio));
  const step = CONFIG.sampleStep;
  let changed = 0;
  const need = CONFIG.requiredPixels;

  const x0 = Math.max(0, lineX - band);
  const x1 = Math.min(w - 1, lineX + band);

  for (let y = 0; y < h; y += step) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * w + x) * 4;
      const lum1 = cur.data[i] * 0.299 + cur.data[i + 1] * 0.587 + cur.data[i + 2] * 0.114;
      const lum2 = prev.data[i] * 0.299 + prev.data[i + 1] * 0.587 + prev.data[i + 2] * 0.114;
      if (Math.abs(lum1 - lum2) > CONFIG.pixelThreshold) {
        changed++;
        if (changed >= need) {
          return 100;
        }
      }
    }
  }
  return Math.min(100, Math.round((changed / need) * 100));
}

function onMotionTriggered() {
  if (state.role === 'start' && state.startTime == null) {
    state.startTime = performance.now();
    setStatus('Start detected', 'running');
    startLiveTimer();
    flash();
    beep(660, 90);
    vibrate([30]);
    if (state.conn?.open) {
      state.conn.send({ type: 'start', t: state.startTime + state.clockOffset });
    }
  } else if (state.role === 'finish' && state.startTime != null) {
    const now = performance.now();
    const elapsed = (now - state.startTime) / 1000;
    finishRace(elapsed);
    if (state.conn?.open) {
      state.conn.send({ type: 'finish', t: now + state.clockOffset });
    }
  }
}

/* ===================== Bind UI ===================== */
$('btnStart').addEventListener('click', () => chooseRole('start'));
$('btnFinish').addEventListener('click', () => chooseRole('finish'));
$('btnJoin').addEventListener('click', joinAsFinish);
$('roomCodeInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinAsFinish();
});
$('btnEnableCam').addEventListener('click', enableCamera);
$('btnArm').addEventListener('click', () => armSystem(false));
$('btnCalibrate').addEventListener('click', toggleCalibration);

$('sensitivitySlider').addEventListener('input', (e) => {
  state.sensitivity = Number(e.target.value);
  $('sensitivityValue').textContent = state.sensitivity;
});

$('distanceInput').addEventListener('change', () => {
  const t = parseFloat($('timer').textContent);
  if (t > 0 && state.history.length) updateSpeed(t);
});

$('speedUnit').addEventListener('change', () => {
  const t = parseFloat($('timer').textContent);
  if (t > 0) updateSpeed(t);
});

$('btnClearHistory').addEventListener('click', () => {
  state.history = [];
  renderHistory();
});

// Boot
$('pairingPanel').hidden = false;
setConnBadge(false);
