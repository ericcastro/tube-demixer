import * as api from "./api.js";

const STEM_HUES = {
  vocals: 280, drums: 20, bass: 200, other: 150,
  guitar: 45,  piano: 340, no_vocals: 160, instrumental: 160,
};

// ── Project context ────────────────────────────────────────────────
const PROJECT_ID = new URLSearchParams(window.location.search).get("id");

// ── Web Audio state ────────────────────────────────────────────────
let audioCtx     = null;
let stemBuffers  = {};   // stemName → AudioBuffer
let stemGains    = {};   // stemName → GainNode
let activeSources = {};  // stemName → AudioBufferSourceNode (live while playing)
let stemState    = {};   // stemName → { volume: 0..1.5, muted: bool, soloed: bool }

let isPlaying    = false;
let startOffset  = 0;    // audio position (s) captured when play() was called
let startedAt    = 0;    // audioCtx.currentTime when play() was called
let duration     = 0;
let playbackRate = 1;
let tempoMode    = false; // false = Rate (pitch follows), true = Tempo (pitch-preserving)
let stretchedBuffers = {}; // cached OLA-stretched buffers keyed by `name:rate`
let rafId        = null;

// ── DOM refs ───────────────────────────────────────────────────────
const $title      = document.getElementById("mixer-title");
const $modelBadge = document.getElementById("mixer-model");
const $loading    = document.getElementById("loading-state");
const $loadingMsg = document.getElementById("loading-msg");
const $root       = document.getElementById("mixer-root");
const $playBtn    = document.getElementById("play-btn");
const $seekBar    = document.getElementById("seek-bar");
const $timeCur    = document.getElementById("time-current");
const $timeTotal  = document.getElementById("time-total");
const $speedSlider = document.getElementById("speed-slider");
const $speedVal    = document.getElementById("speed-val");
const $modeRate    = document.getElementById("mode-rate");
const $modeTempo   = document.getElementById("mode-tempo");
const $stemsEl    = document.getElementById("stems-container");

// ── Boot ───────────────────────────────────────────────────────────
if (!PROJECT_ID) {
  $loadingMsg.textContent = "No project ID — go back and open a project.";
} else {
  boot();
}

async function boot() {
  try {
    const project = await api.getProject(PROJECT_ID);
    document.title = `${project.name} — Tube DeMixer`;
    $title.textContent = project.name;
    $modelBadge.textContent = project.model_id;

    if (project.status !== "ready") {
      $loadingMsg.textContent = `Project not ready yet (status: ${project.status}).`;
      return;
    }

    if (!project.stems?.length) {
      $loadingMsg.textContent = "No stems found for this project.";
      return;
    }

    await loadAllStems(project.stems);
    buildMixer(project.stems);
    $loading.classList.add("hidden");
    $root.classList.remove("hidden");
    bindTransport();
    bindStemControls();

  } catch (err) {
    $loadingMsg.textContent = `Error: ${err.message}`;
  }
}

// ── Audio loading ──────────────────────────────────────────────────
async function loadAllStems(stems) {
  audioCtx = new AudioContext();
  const total = stems.length;
  let done = 0;

  await Promise.all(stems.map(async (stem) => {
    const res = await fetch(stem.url);
    if (!res.ok) throw new Error(`Could not load ${stem.stem_name} (${res.status})`);
    const buf = await res.arrayBuffer();
    stemBuffers[stem.stem_name] = await audioCtx.decodeAudioData(buf);

    const gain = audioCtx.createGain();
    gain.connect(audioCtx.destination);
    stemGains[stem.stem_name] = gain;
    stemState[stem.stem_name] = { volume: 1, muted: false, soloed: false };

    done++;
    $loadingMsg.textContent = `Loading stems… ${done} / ${total}`;
  }));

  duration = Math.max(...Object.values(stemBuffers).map((b) => b.duration));
}

// ── Build UI ───────────────────────────────────────────────────────
function buildMixer(stems) {
  $seekBar.max = duration;
  $timeTotal.textContent = fmt(duration);

  for (const stem of stems) {
    $stemsEl.appendChild(buildTrack(stem.stem_name));
  }

  // Draw waveforms once layout is settled
  requestAnimationFrame(() => {
    for (const [name, buf] of Object.entries(stemBuffers)) {
      const canvas = $stemsEl.querySelector(`[data-stem="${name}"] .waveform`);
      if (canvas) drawWaveform(canvas, buf, STEM_HUES[name] ?? 220);
    }
  });
}

function buildTrack(name) {
  const hue = STEM_HUES[name] ?? 220;
  const el = document.createElement("div");
  el.className = "stem-track";
  el.dataset.stem = name;
  el.style.setProperty("--stem-hue", hue);
  el.innerHTML = `
    <div class="stem-label">${name}</div>
    <div class="waveform-wrap">
      <canvas class="waveform"></canvas>
      <div class="waveform-playhead"></div>
    </div>
    <div class="stem-controls">
      <button class="btn-mute" data-action="mute"   title="Mute">M</button>
      <button class="btn-solo" data-action="solo"   title="Solo">S</button>
      <input  class="vol-slider" type="range" data-action="volume"
              min="0" max="150" value="100" title="Volume">
      <span class="vol-value">100%</span>
    </div>`;
  return el;
}

// ── Stem controls ──────────────────────────────────────────────────
function bindStemControls() {
  $stemsEl.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const name = btn.closest("[data-stem]")?.dataset.stem;
    if (!name) return;

    if (btn.dataset.action === "mute") {
      stemState[name].muted = !stemState[name].muted;
      btn.classList.toggle("active", stemState[name].muted);
      btn.closest(".stem-track").classList.toggle("muted", stemState[name].muted);
    } else if (btn.dataset.action === "solo") {
      stemState[name].soloed = !stemState[name].soloed;
      btn.classList.toggle("active", stemState[name].soloed);
    }
    applyGains();
  });

  $stemsEl.addEventListener("input", (e) => {
    if (e.target.dataset.action !== "volume") return;
    const name = e.target.closest("[data-stem]")?.dataset.stem;
    if (!name) return;
    const pct = Number(e.target.value);
    stemState[name].volume = pct / 100;
    e.target.closest(".stem-track").querySelector(".vol-value").textContent = `${pct}%`;
    applyGains();
  });
}

function applyGains() {
  const anySolo = Object.values(stemState).some((s) => s.soloed);
  for (const [name, state] of Object.entries(stemState)) {
    const hear = anySolo ? state.soloed : !state.muted;
    stemGains[name].gain.value = hear ? state.volume : 0;
  }
}

// ── Transport ──────────────────────────────────────────────────────
function bindTransport() {
  $playBtn.addEventListener("click", togglePlay);

  // Show value while dragging; only reprocess on release
  $speedSlider.addEventListener("input", () => {
    playbackRate = Number($speedSlider.value);
    $speedVal.textContent = `${playbackRate.toFixed(2)}×`;
  });
  $speedSlider.addEventListener("change", () => applySpeed());

  async function applySpeed() {
    if (tempoMode && playbackRate !== 1) {
      const wasPlaying = isPlaying;
      if (wasPlaying) { startOffset = now(); pauseAll(); }
      await ensureStretched(playbackRate);
      if (wasPlaying) playAll();
    } else {
      if (isPlaying) { startOffset = now(); startSources(); }
    }
  }

  async function setMode(tempo) {
    tempoMode = tempo;
    $modeRate.classList.toggle("active", !tempo);
    $modeTempo.classList.toggle("active", tempo);
    if (tempo && playbackRate !== 1) {
      const wasPlaying = isPlaying;
      if (wasPlaying) { startOffset = now(); pauseAll(); }
      await ensureStretched(playbackRate);
      if (wasPlaying) playAll();
    } else {
      if (isPlaying) { startOffset = now(); startSources(); }
    }
  }
  $modeRate.addEventListener("click",  () => setMode(false));
  $modeTempo.addEventListener("click", () => setMode(true));

  // Seek bar — prevent RAF from fighting the thumb while dragging
  let dragging = false;
  $seekBar.addEventListener("mousedown",  () => { dragging = true; });
  $seekBar.addEventListener("touchstart", () => { dragging = true; });
  $seekBar.addEventListener("mouseup",    () => { dragging = false; commitSeek(); });
  $seekBar.addEventListener("touchend",   () => { dragging = false; commitSeek(); });
  $seekBar.addEventListener("input", () => { if (dragging) paintUI(Number($seekBar.value)); });

  function commitSeek() {
    startOffset = Number($seekBar.value);
    if (isPlaying) startSources();
    else paintUI(startOffset);
  }

  // Click on any waveform also seeks
  $stemsEl.addEventListener("click", (e) => {
    const wrap = e.target.closest(".waveform-wrap");
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    startOffset = Math.max(0, Math.min(pct * duration, duration));
    $seekBar.value = startOffset;
    if (isPlaying) startSources();
    else paintUI(startOffset);
  });
}

function togglePlay() {
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") audioCtx.resume();
  if (isPlaying) pauseAll(); else playAll();
}

function playAll() {
  if (startOffset >= duration - 0.05) startOffset = 0;
  startSources();
  isPlaying = true;
  $playBtn.textContent = "⏸";
  scheduleRaf();
}

function startSources() {
  stopSources();
  startedAt = audioCtx.currentTime;

  for (const [name, buf] of Object.entries(stemBuffers)) {
    const src = audioCtx.createBufferSource();
    const key = `${name}:${playbackRate.toFixed(2)}`;

    if (tempoMode && playbackRate !== 1 && stretchedBuffers[key]) {
      src.buffer = stretchedBuffers[key];
      src.playbackRate.value = 1;
      src.start(0, startOffset / playbackRate);
    } else {
      src.buffer = buf;
      src.playbackRate.value = playbackRate;
      src.start(0, startOffset);
    }

    src.connect(stemGains[name]);
    activeSources[name] = src;
  }

  const remaining = (duration - startOffset) / playbackRate;
  clearTimeout(endTimer);
  endTimer = setTimeout(onEnded, remaining * 1000);
}

// ── WSOLA time-stretch (off main thread) ──────────────────────────
function stretchBuffer(buf, rate) {
  return new Promise(resolve => {
    const worker = new Worker("/js/stretch-worker.js");
    const channels = Array.from({ length: buf.numberOfChannels }, (_, ch) => {
      const d = new Float32Array(buf.length);
      buf.copyFromChannel(d, ch);
      return d;
    });
    worker.onmessage = ({ data }) => {
      const out = audioCtx.createBuffer(
        data.channels.length, data.channels[0].length, buf.sampleRate
      );
      data.channels.forEach((ch, i) => out.copyToChannel(new Float32Array(ch), i));
      worker.terminate();
      resolve(out);
    };
    worker.postMessage({ channels, rate }, channels.map(c => c.buffer));
  });
}

async function ensureStretched(rate) {
  const rk = rate.toFixed(2);
  const needed = Object.keys(stemBuffers).filter(n => !stretchedBuffers[`${n}:${rk}`]);
  if (!needed.length) return;

  $speedVal.textContent = "…";
  const results = await Promise.all(
    needed.map(name => stretchBuffer(stemBuffers[name], rate).then(b => [name, b]))
  );
  for (const [name, b] of results) stretchedBuffers[`${name}:${rk}`] = b;
  $speedVal.textContent = `${rate.toFixed(2)}×`;
}

let endTimer = null;
function onEnded() {
  if (!isPlaying) return;
  pauseAll();
  startOffset = 0;
  paintUI(0);
}

function pauseAll() {
  startOffset = now();
  stopSources();
  clearTimeout(endTimer);
  isPlaying = false;
  $playBtn.textContent = "▶";
  cancelAnimationFrame(rafId);
  paintUI(startOffset);
}

function stopSources() {
  for (const src of Object.values(activeSources)) {
    try { src.stop(); } catch { /* already stopped */ }
  }
  activeSources = {};
}

function now() {
  if (!isPlaying) return startOffset;
  return Math.min(startOffset + (audioCtx.currentTime - startedAt) * playbackRate, duration);
}

// ── Animation loop ─────────────────────────────────────────────────
function scheduleRaf() {
  cancelAnimationFrame(rafId);
  function tick() {
    paintUI(now());
    if (isPlaying) rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function paintUI(t) {
  const pct = duration > 0 ? t / duration : 0;
  $timeCur.textContent = fmt(t);
  $seekBar.value = t;
  document.querySelectorAll(".waveform-playhead").forEach((el) => {
    el.style.left = `${pct * 100}%`;
  });
}

// ── Waveform ───────────────────────────────────────────────────────
function drawWaveform(canvas, buffer, hue) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.clientWidth;
  const H   = canvas.clientHeight;
  if (!W || !H) return;

  canvas.width  = W * dpr;
  canvas.height = H * dpr;

  const ctx  = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const data = buffer.getChannelData(0);
  const step = data.length / W;

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0,   `hsla(${hue},75%,60%,.65)`);
  grad.addColorStop(0.5, `hsla(${hue},85%,70%,1)`);
  grad.addColorStop(1,   `hsla(${hue},75%,60%,.65)`);
  ctx.fillStyle = grad;

  for (let x = 0; x < W; x++) {
    const s = Math.floor(x * step);
    const e = Math.min(Math.floor((x + 1) * step), data.length);
    let peak = 0;
    for (let i = s; i < e; i++) {
      const abs = Math.abs(data[i]);
      if (abs > peak) peak = abs;
    }
    const h = peak * H * 0.92;
    ctx.fillRect(x, (H - h) / 2, 1, h || 1);
  }
}

// ── Utility ────────────────────────────────────────────────────────
function fmt(secs) {
  if (!isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
