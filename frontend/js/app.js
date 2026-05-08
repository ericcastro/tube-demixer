import * as api from "./api.js";

const ACTIVE_STATUSES = new Set(["created", "downloading", "extracting", "separating"]);
const STATUS_LABELS = {
  created:     "Queued",
  downloading: "Downloading…",
  extracting:  "Extracting audio…",
  separating:  "Separating stems…",
  ready:       "Ready",
  error:       "Error",
};

// stem name → hue (for consistent coloring)
const STEM_HUES = {
  vocals: 280, drums: 20, bass: 200, other: 150,
  guitar: 45,  piano: 340, no_vocals: 160, instrumental: 160,
};

// ── State ──────────────────────────────────────────────────────────
let projects = [];
let models = {};
let pollTimer = null;

// ── DOM refs ───────────────────────────────────────────────────────
const $grid      = document.getElementById("projects-grid");
const $empty     = document.getElementById("empty-state");
const $panel     = document.getElementById("new-project-panel");
const $form      = document.getElementById("new-project-form");
const $newBtn    = document.getElementById("new-project-btn");
const $cancelBtn = document.getElementById("cancel-btn");
const $createBtn = document.getElementById("create-btn");
const $urlInput  = document.getElementById("yt-url");
const $urlError  = document.getElementById("url-error");
const $modelSel  = document.getElementById("model-select");
const $modelHint = document.getElementById("model-hint");
const $backdrop  = $panel.querySelector(".panel-backdrop");

// ── Boot ───────────────────────────────────────────────────────────
const [, ] = await Promise.all([loadModels(), loadProjects()]);

$newBtn.addEventListener("click", openPanel);
$cancelBtn.addEventListener("click", closePanel);
$backdrop.addEventListener("click", closePanel);
$form.addEventListener("submit", handleCreate);
$modelSel.addEventListener("change", () => updateModelHint());
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closePanel(); });

// ── Models ─────────────────────────────────────────────────────────
async function loadModels() {
  try {
    models = await api.getModels();
  } catch {
    return;
  }
  $modelSel.innerHTML = "";
  for (const [id, info] of Object.entries(models)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = info.label;
$modelSel.appendChild(opt);
  }
  updateModelHint();
}

function updateModelHint() {
  const info = models[$modelSel.value];
  $modelHint.textContent = info ? info.description : "";
}

// ── Data ───────────────────────────────────────────────────────────
async function loadProjects() {
  try { projects = await api.getProjects(); } catch { projects = []; }
  render();
  schedulePolling();
}

function schedulePolling() {
  clearTimeout(pollTimer);
  if (projects.some((p) => ACTIVE_STATUSES.has(p.status))) {
    pollTimer = setTimeout(pollActive, 2000);
  }
}

async function pollActive() {
  const active = projects.filter((p) => ACTIVE_STATUSES.has(p.status));
  if (!active.length) return;

  const updated = await Promise.all(
    active.map((p) => api.getProject(p.id).catch(() => p))
  );
  for (const fresh of updated) {
    const idx = projects.findIndex((p) => p.id === fresh.id);
    if (idx !== -1) projects[idx] = fresh;
  }
  render();
  schedulePolling();
}

// ── Render ─────────────────────────────────────────────────────────
function render() {
  if (!projects.length) {
    $empty.classList.remove("hidden");
    $grid.innerHTML = "";
    return;
  }
  $empty.classList.add("hidden");
  $grid.innerHTML = projects.map(cardHtml).join("");

  $grid.querySelectorAll("[data-delete]").forEach((btn) =>
    btn.addEventListener("click", () => handleDelete(btn.dataset.delete))
  );
}

function cardHtml(p) {
  const isActive = ACTIVE_STATUSES.has(p.status);

  const thumbInner = p.video_thumbnail
    ? `<img class="card-thumb" src="${esc(p.video_thumbnail)}" alt="" loading="lazy">`
    : `<div class="card-thumb-placeholder"></div>`;

  const thumb = p.status === "ready"
    ? `<a class="card-thumb-link" href="/mixer.html?id=${esc(p.id)}" aria-label="Open mixer">${thumbInner}</a>`
    : thumbInner;

  const modelInfo = models[p.model_id];
  const modelLabel = modelInfo ? modelInfo.label : p.model_id;

  const meta = [
    p.duration && p.duration !== "0" ? formatDuration(Number(p.duration)) : "",
    `<span class="model-badge">${esc(modelLabel)}</span>`,
  ].filter(Boolean).join(" · ");

  const stemBadges = p.status === "ready" && p.stems?.length
    ? `<div class="stem-badges">${p.stems.map((s) => stemBadge(s.stem_name)).join("")}</div>`
    : "";

  const error = p.error_message
    ? `<p class="card-error" title="${esc(p.error_message)}">${esc(p.error_message)}</p>`
    : "";

  return `
    <article class="project-card">
      ${thumb}
      <div class="card-body">
        <h3 class="card-title">${esc(p.name)}</h3>
        <div class="card-meta">${meta}</div>
        <div class="card-status">
          ${isActive ? `<span class="spinner"></span>` : ""}
          <span class="status-label status-${p.status}">${STATUS_LABELS[p.status] ?? p.status}</span>
        </div>
        ${stemBadges}
        ${error}
      </div>
      <div class="card-actions">
        <button class="btn btn-sm btn-ghost btn-danger" data-delete="${esc(p.id)}">Delete</button>
      </div>
    </article>`;
}

function stemBadge(name) {
  const hue = STEM_HUES[name] ?? 220;
  return `<span class="stem-badge" style="--hue:${hue}">${esc(name)}</span>`;
}

// ── Handlers ───────────────────────────────────────────────────────
async function handleCreate(e) {
  e.preventDefault();
  $urlError.textContent = "";
  $urlInput.classList.remove("invalid");

  const url = $urlInput.value.trim();
  if (!isYouTubeUrl(url)) {
    $urlError.textContent = "Enter a valid YouTube URL.";
    $urlInput.classList.add("invalid");
    $urlInput.focus();
    return;
  }

  const name     = document.getElementById("proj-name").value.trim();
  const model_id = $modelSel.value;

  setCreating(true);
  try {
    const project = await api.createProject({ youtube_url: url, name, model_id });
    projects.unshift(project);
    render();
    schedulePolling();
    closePanel();
    $form.reset();
    updateModelHint();
  } catch (err) {
    $urlError.textContent = err.message;
    $urlInput.classList.add("invalid");
  } finally {
    setCreating(false);
  }
}

async function handleDelete(id) {
  if (!confirm("Delete this project?")) return;
  try {
    await api.deleteProject(id);
    projects = projects.filter((p) => p.id !== id);
    render();
    schedulePolling();
  } catch (err) {
    alert(`Delete failed: ${err.message}`);
  }
}

// ── Panel helpers ──────────────────────────────────────────────────
function openPanel() {
  $panel.classList.remove("hidden");
  $urlInput.focus();
}

function closePanel() {
  $panel.classList.add("hidden");
  $form.reset();
  $urlError.textContent = "";
  $urlInput.classList.remove("invalid");
  updateModelHint();
  setCreating(false);
}

function setCreating(busy) {
  $createBtn.disabled = busy;
  $createBtn.querySelector(".btn-label").textContent = busy ? "Creating…" : "Create & Process";
  $createBtn.querySelector(".btn-spinner").classList.toggle("hidden", !busy);
}

// ── Utilities ──────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDuration(secs) {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h) return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${m}:${String(s).padStart(2,"0")}`;
}

function isYouTubeUrl(url) {
  try {
    return /youtube\.com|youtu\.be/.test(new URL(url).hostname);
  } catch { return false; }
}
