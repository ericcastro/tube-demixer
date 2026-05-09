import * as api from "./api.js";

const SVG_PLAY     = `<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true"><path d="M5 3.5l13 6.5-13 6.5z"/></svg>`;
const SVG_PAUSE    = `<svg viewBox="0 0 20 20" fill="currentColor" width="18" height="18" aria-hidden="true"><rect x="3.5" y="3" width="5" height="14" rx="1.5"/><rect x="11.5" y="3" width="5" height="14" rx="1.5"/></svg>`;
const SVG_DOWNLOAD = `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true"><path d="M10 2a1 1 0 0 0-1 1v7.586L6.707 8.293a1 1 0 1 0-1.414 1.414l4 4a1 1 0 0 0 1.414 0l4-4a1 1 0 1 0-1.414-1.414L11 10.586V3a1 1 0 0 0-1-1z"/><rect x="3" y="16" width="14" height="1.5" rx=".75"/></svg>`;

const STEM_HUES = {
  vocals: 280, drums: 20, bass: 200, other: 150,
  guitar: 45,  piano: 340, no_vocals: 160, instrumental: 160,
};

// ── Project context ────────────────────────────────────────────────
const PROJECT_ID = new URLSearchParams(window.location.search).get("id");

// ── Web Audio state ────────────────────────────────────────────────
let audioCtx      = null;
let stemBuffers   = {};   // stemName → AudioBuffer
let stemGains     = {};   // stemName → GainNode
let activeSources = {};   // stemName → AudioBufferSourceNode (live while playing)
let stemState     = {};   // stemName → { volume: 0..1.5, muted: bool, soloed: bool }

let isPlaying     = false;
let startOffset   = 0;    // audio position (s) captured when play() was called
let startedAt     = 0;    // audioCtx.currentTime when play() was called
let duration      = 0;
let playbackRate  = 1;
let tempoMode     = false;
let stretchedBuffers = {};

// ── Beat / loop state ──────────────────────────────────────────────
let beats            = [];    // beat times in seconds (original speed)
let baseBpm          = 0;
let loopEnabled      = false;
let loopStart        = 0;
let loopEnd          = 0;
let loopStartBeatIdx = -1;
let loopEndBeatIdx   = -1;
let beatsClickPhase  = 0;  // 0=clear, 1=start set, 2=loop active

let rafId = null;

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

    beats   = project.beats  ?? [];
    baseBpm = project.bpm    ?? 0;
    loopEnd = project.duration ? Number(project.duration) : 0;

    await loadAllStems(project.stems);
    buildMixer(project.stems);
    $loading.classList.add("hidden");
    $root.classList.remove("hidden");
    bindTransport();
    bindStemControls();
    bindLoopControls();

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

  $stemsEl.appendChild(buildBeatsTrack());
  for (const stem of stems) {
    $stemsEl.appendChild(buildTrack(stem.stem_name, stem.url));
  }

  requestAnimationFrame(() => {
    // Beat canvas
    const beatsCanvas = $stemsEl.querySelector(".beats-track .waveform");
    if (beatsCanvas) drawBeats(beatsCanvas);

    // Stem waveforms
    for (const [name, buf] of Object.entries(stemBuffers)) {
      const canvas = $stemsEl.querySelector(`[data-stem="${name}"] .waveform`);
      if (canvas) drawWaveform(canvas, buf, STEM_HUES[name] ?? 220);
    }
  });
}

function buildBeatsTrack() {
  const el = document.createElement("div");
  el.className = "stem-track beats-track";
  el.style.setProperty("--stem-hue", 195);
  el.innerHTML = `
    <div class="stem-label beats-label">
      BEATS
      <span class="bpm-display" id="bpm-display">${baseBpm ? Math.round(baseBpm) + " BPM" : ""}</span>
    </div>
    <div class="waveform-wrap" id="beats-wrap">
      <canvas class="waveform"></canvas>
      <div class="waveform-playhead"></div>
      <div class="loop-region" id="loop-region-beats"></div>
    </div>
    <div class="stem-controls beats-controls">
      <div class="loop-row">
        <span class="beat-count" id="beat-count">—</span>
        <button class="loop-btn" id="btn-loop-start"  title="Set loop in (snaps to beat)">[</button>
        <button class="loop-btn" id="btn-loop-end"    title="Set loop out &amp; restart (snaps to beat)">]</button>
        <button class="loop-btn" id="btn-loop-toggle" title="Toggle loop">⟳</button>
      </div>
      <div class="loop-row">
        <button class="loop-btn" id="btn-loop-prev"   title="Move loop 1 beat back">‹</button>
        <button class="loop-btn" id="btn-loop-shrink" title="Remove 1 beat from loop">−</button>
        <button class="loop-btn" id="btn-loop-expand" title="Add 1 beat to loop">+</button>
        <button class="loop-btn" id="btn-loop-next"   title="Move loop 1 beat forward">›</button>
      </div>
    </div>`;
  return el;
}

function buildTrack(name, url) {
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
      <div class="loop-region"></div>
    </div>
    <div class="stem-controls">
      <button class="btn-mute" data-action="mute"   title="Mute">M</button>
      <button class="btn-solo" data-action="solo"   title="Solo">S</button>
      <input  class="vol-slider" type="range" data-action="volume"
              min="0" max="150" value="100" title="Volume">
      <span class="vol-value">100%</span>
      <a class="btn-download" href="${url}" download="${name}.wav" title="Download ${name}">${SVG_DOWNLOAD}</a>
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
    updateBpm();
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

  // Click on any stem waveform seeks (beats-wrap handled separately with snap)
  $stemsEl.addEventListener("click", (e) => {
    const wrap = e.target.closest(".waveform-wrap");
    if (!wrap || wrap.id === "beats-wrap") return;
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
  $playBtn.innerHTML = SVG_PAUSE;
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

    if (loopEnabled && loopEnd > loopStart) {
      src.loop = true;
      if (tempoMode && playbackRate !== 1) {
        src.loopStart = loopStart / playbackRate;
        src.loopEnd   = loopEnd   / playbackRate;
      } else {
        src.loopStart = loopStart;
        src.loopEnd   = loopEnd;
      }
    }

    src.connect(stemGains[name]);
    activeSources[name] = src;
  }

  const remaining = loopEnabled
    ? Infinity
    : (duration - startOffset) / playbackRate;
  clearTimeout(endTimer);
  if (isFinite(remaining)) endTimer = setTimeout(onEnded, remaining * 1000);
}

// ── Beat helpers ───────────────────────────────────────────────────
function nearestBeatIdx(t) {
  if (!beats.length) return -1;
  let idx = 0, minDist = Infinity;
  for (let i = 0; i < beats.length; i++) {
    const d = Math.abs(beats[i] - t);
    if (d < minDist) { minDist = d; idx = i; }
  }
  return idx;
}

function setLoopByBeats(startIdx, endIdx) {
  loopStartBeatIdx = Math.max(0, startIdx);
  loopEndBeatIdx   = Math.min(beats.length - 1, endIdx);
  loopStart = beats[loopStartBeatIdx] ?? 0;
  loopEnd   = beats[loopEndBeatIdx]   ?? duration;
  updateBeatCount();
  updateLoopUI();
}

function updateBeatCount() {
  const el = document.getElementById("beat-count");
  if (!el) return;
  if (!loopEnabled || loopStartBeatIdx < 0 || loopEndBeatIdx <= loopStartBeatIdx) {
    el.textContent = "—";
  } else {
    el.textContent = `${loopEndBeatIdx - loopStartBeatIdx}♩`;
  }
}

// ── Loop controls ─────────────────────────────────────────────────
function bindLoopControls() {
  // [ — set loop in, snap to beat, enable loop
  document.getElementById("btn-loop-start")?.addEventListener("click", () => {
    const idx = nearestBeatIdx(now());
    loopStartBeatIdx = idx >= 0 ? idx : 0;
    loopStart = beats[loopStartBeatIdx] ?? now();
    if (loopEndBeatIdx < 0 || loopEndBeatIdx <= loopStartBeatIdx) {
      loopEndBeatIdx = Math.min(loopStartBeatIdx + 4, beats.length - 1);
      loopEnd = beats[loopEndBeatIdx] ?? duration;
    }
    loopEnabled = true;
    beatsClickPhase = 2;
    document.getElementById("btn-loop-toggle")?.classList.add("active");
    updateBeatCount();
    updateLoopUI();
    if (isPlaying) { startOffset = loopStart; startSources(); }
  });

  // ] — set loop out, snap to beat, enable loop, restart from loopStart
  document.getElementById("btn-loop-end")?.addEventListener("click", () => {
    const idx = nearestBeatIdx(now());
    loopEndBeatIdx = idx >= 0 ? idx : beats.length - 1;
    loopEnd = beats[loopEndBeatIdx] ?? now();
    if (loopEndBeatIdx <= loopStartBeatIdx) {
      loopStartBeatIdx = Math.max(0, loopEndBeatIdx - 4);
      loopStart = beats[loopStartBeatIdx] ?? 0;
    }
    loopEnabled = true;
    beatsClickPhase = 2;
    document.getElementById("btn-loop-toggle")?.classList.add("active");
    updateBeatCount();
    updateLoopUI();
    startOffset = loopStart;
    if (isPlaying) startSources(); else paintUI(startOffset);
  });

  // ⟳ — toggle loop only
  document.getElementById("btn-loop-toggle")?.addEventListener("click", () => {
    loopEnabled = !loopEnabled;
    if (!loopEnabled) beatsClickPhase = 0;
    document.getElementById("btn-loop-toggle")?.classList.toggle("active", loopEnabled);
    updateBeatCount();
    updateLoopUI();
    if (isPlaying) { startOffset = now(); startSources(); }
  });

  // ‹ — move loop 1 beat back
  document.getElementById("btn-loop-prev")?.addEventListener("click", () => {
    if (loopStartBeatIdx <= 0) return;
    setLoopByBeats(loopStartBeatIdx - 1, loopEndBeatIdx - 1);
    if (isPlaying && loopEnabled) { startOffset = loopStart; startSources(); }
  });

  // › — move loop 1 beat forward
  document.getElementById("btn-loop-next")?.addEventListener("click", () => {
    if (loopEndBeatIdx >= beats.length - 1) return;
    setLoopByBeats(loopStartBeatIdx + 1, loopEndBeatIdx + 1);
    if (isPlaying && loopEnabled) { startOffset = loopStart; startSources(); }
  });

  // − — remove 1 beat from loop
  document.getElementById("btn-loop-shrink")?.addEventListener("click", () => {
    if (loopEndBeatIdx - loopStartBeatIdx <= 1) return;
    setLoopByBeats(loopStartBeatIdx, loopEndBeatIdx - 1);
    if (isPlaying && loopEnabled) { startOffset = loopStart; startSources(); }
  });

  // + — add 1 beat to loop
  document.getElementById("btn-loop-expand")?.addEventListener("click", () => {
    if (loopEndBeatIdx >= beats.length - 1) return;
    setLoopByBeats(loopStartBeatIdx, loopEndBeatIdx + 1);
    if (isPlaying && loopEnabled) { startOffset = loopStart; startSources(); }
  });

  // Click on beats canvas — 3-phase: set start → set end → clear
  document.getElementById("beats-wrap")?.addEventListener("click", (e) => {
    const wrap = e.currentTarget;
    const pct  = (e.clientX - wrap.getBoundingClientRect().left) / wrap.clientWidth;
    const t    = Math.max(0, Math.min(pct * duration, duration));
    const idx  = nearestBeatIdx(t);
    const snapped = idx >= 0 ? beats[idx] : t;

    if (beatsClickPhase === 2) {
      // 3rd click — clear loop entirely
      loopEnabled      = false;
      loopStartBeatIdx = -1;
      loopEndBeatIdx   = -1;
      beatsClickPhase  = 0;
      document.getElementById("btn-loop-toggle")?.classList.remove("active");
      if (isPlaying) { startOffset = now(); startSources(); }
    } else if (beatsClickPhase === 1 && idx > loopStartBeatIdx) {
      // 2nd click after a valid start — close the loop
      loopEndBeatIdx = idx;
      loopEnd        = snapped;
      loopEnabled    = true;
      beatsClickPhase = 2;
      document.getElementById("btn-loop-toggle")?.classList.add("active");
      startOffset = loopStart;
      if (isPlaying) startSources(); else paintUI(startOffset);
    } else {
      // 1st click (or reset) — set loop start, seek cursor to that beat
      loopStartBeatIdx = idx >= 0 ? idx : 0;
      loopStart        = snapped;
      loopEndBeatIdx   = -1;
      loopEnabled      = false;
      beatsClickPhase  = 1;
      document.getElementById("btn-loop-toggle")?.classList.remove("active");
      startOffset = loopStart;
      $seekBar.value = startOffset;
      if (isPlaying) startSources(); else paintUI(startOffset);
    }

    updateBeatCount();
    updateLoopUI();
  });
}

function updateLoopUI() {
  const pctS = duration > 0 ? loopStart / duration : 0;
  const pctE = duration > 0 ? loopEnd   / duration : 1;
  document.querySelectorAll(".loop-region").forEach(el => {
    el.style.left  = `${pctS * 100}%`;
    el.style.width = `${(pctE - pctS) * 100}%`;
    el.classList.toggle("visible", loopEnabled);
  });
  updateBeatCount();
}

function updateBpm() {
  const el = document.getElementById("bpm-display");
  if (el && baseBpm) el.textContent = `${Math.round(baseBpm * playbackRate)} BPM`;
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
  $playBtn.innerHTML = SVG_PLAY;
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
  const elapsed = (audioCtx.currentTime - startedAt) * playbackRate;
  if (loopEnabled && loopEnd > loopStart) {
    const raw = startOffset + elapsed;
    if (raw < loopEnd) return raw;
    const loopLen = loopEnd - loopStart;
    return loopStart + ((raw - loopEnd) % loopLen);
  }
  return Math.min(startOffset + elapsed, duration);
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

// ── Beat canvas ────────────────────────────────────────────────────
function drawBeats(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.clientWidth;
  const H   = canvas.clientHeight;
  if (!W || !H) return;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "hsl(195 30% 10%)";
  ctx.fillRect(0, 0, W, H);

  if (!beats.length || !duration) return;

  // Group beats into bars (every 4 beats) for visual hierarchy
  beats.forEach((t, i) => {
    const x   = (t / duration) * W;
    const bar = i % 4 === 0;
    ctx.fillStyle = bar
      ? "hsl(195 80% 65% / 0.9)"
      : "hsl(195 60% 50% / 0.55)";
    const w = bar ? 2 : 1;
    const h = bar ? H : H * 0.6;
    ctx.fillRect(x - w / 2, (H - h) / 2, w, h);
  });
}

// ── Utility ────────────────────────────────────────────────────────
function fmt(secs) {
  if (!isFinite(secs) || secs < 0) return "0:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
