
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}
import { autoCorrelateFloat32, freqToMidi, midiToFreq, midiToNoteName, centsOff } from "./pitch.js";
const $ = (id) => document.getElementById(id);

const btnStartAudio = $("btnStartAudio");
const micStatus = $("micStatus");
const noteReadout = $("noteReadout");
const jsStatus = $("jsStatus");
if (jsStatus) jsStatus.textContent = "JS: module ok";

window.addEventListener("error", (e)=>{ if(jsStatus) jsStatus.textContent = "JS: err"; });

const tunerNote = $("tunerNote");
const tunerHz = $("tunerHz");
const tunerCents = $("tunerCents");
const tunerPos = $("tunerPos");
const tunerAlt = $("tunerAlt");
const meterNeedle = $("meterNeedle");

const midiFile = $("midiFile");
const audioFile = $("audioFile");
const syncOffsetEl = $("syncOffset");
const playAudioEl = $("playAudio");
const btnRestart = $("btnRestart");
const btnSetA = $("btnSetA");
const btnSetB = $("btnSetB");
const loopOnEl = $("loopOn");
const loopReadout = $("loopReadout");
const btnPlay = $("btnPlay");
const btnStop = $("btnStop");

// Library
const libAddFiles = $("libAddFiles");
const libClear = $("libClear");
const libSearch = $("libSearch");
const libList = $("libList");
const libCount = $("libCount");
const btnPause = $("btnPause");
const viewModeEl = $("viewMode");
const uiScaleEl = $("uiScale");
const uiScaleReadout = $("uiScaleReadout");
const practiceStatus = $("practiceStatus");
const lane = $("lane");
const ctx = lane.getContext("2d");


let asphaltPattern = null;
let asphaltCanvas = null;

function buildAsphaltPattern() {
  asphaltCanvas = document.createElement("canvas");
  asphaltCanvas.width = 256;
  asphaltCanvas.height = 256;
  const g = asphaltCanvas.getContext("2d");
  // base
  g.fillStyle = "#15161a";
  g.fillRect(0,0,256,256);
  // speckles
  const img = g.getImageData(0,0,256,256);
  const d = img.data;
  for (let i=0;i<d.length;i+=4){
    const r = Math.random();
    const v = 18 + Math.floor(r*40);
    d[i]=v; d[i+1]=v; d[i+2]=v; d[i+3]=255;
    if (Math.random() < 0.04){
      const v2 = 80 + Math.floor(Math.random()*80);
      d[i]=v2; d[i+1]=v2; d[i+2]=v2;
    }
  }
  g.putImageData(img,0,0);
  // subtle diagonal streaks
  g.globalAlpha = 0.08;
  g.strokeStyle = "#ffffff";
  for (let y=-256;y<512;y+=18){
    g.beginPath();
    g.moveTo(0,y);
    g.lineTo(256,y+64);
    g.stroke();
  }
  g.globalAlpha = 1;
  asphaltPattern = ctx.createPattern(asphaltCanvas, "repeat");
}


// build pattern lazily on first GH draw
function resizeCanvasToDisplaySize() {
  const dpr = window.devicePixelRatio || 1;
  const rect = lane.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width));
  const h = Math.max(360, Math.floor(rect.height));
  const needW = Math.floor(w * dpr);
  const needH = Math.floor(h * dpr);
  if (lane.width !== needW || lane.height !== needH) {
    lane.width = needW;
    lane.height = needH;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, dpr };
}
window.addEventListener("resize", () => { resizeCanvasToDisplaySize(); drawLane(0); });

const hitWindowEl = $("hitWindow");
const minConfEl = $("minConf");
const maxFretEl = $("maxFret");
const speedEl = $("speed");
const speedReadout = $("speedReadout");
const bassOnlyEl = $("bassOnly");
const lowestOnlyEl = $("lowestOnly");

let audioCtx = null;
let analyser = null;
let micStream = null;
let dataBuf = null;

let lastPitch = { freq: null, confidence: 0, midi: null, name: "—" };


// --- IndexedDB MIDI Library (local) ---
const DB_NAME = "basscoach";
const DB_VER = 1;
const STORE = "midis";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: "id" });
        s.createIndex("by_name", "name", { unique: false });
        s.createIndex("by_added", "addedAt", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(item) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(item);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbGetAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function dbDelete(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function dbClear() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function hashBuffer(buf) {
  const h = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(h)).map(b=>b.toString(16).padStart(2,"0")).join("");
}

// Practice state
let audioEl = null;
let audioLoaded = false;
let audioUrl = null;

let midiData = null;
let libraryItems = []; // {id,name,addedAt,size,bytes}

let isPlaying = false;
let isPaused = false;
let pausedAt = 0; // seconds in scaled timeline
let wallAtPause = 0; // audioCtx time at pause

let startTime = 0;
let rafId = null;

let loopA = null;
let loopB = null;

function getSpeedFactor(){
  const v = speedEl ? parseInt(speedEl.value,10) : 100;
  const f = Math.max(0.25, Math.min(2.0, v/100));
  if (speedReadout) speedReadout.textContent = `${f.toFixed(2)}×`;
  return f;
}
if (speedEl) speedEl.addEventListener("input", ()=>{ getSpeedFactor();

function applyUiScale() {
  const v = uiScaleEl ? parseInt(uiScaleEl.value,10) : 100;
  const s = Math.max(60, Math.min(140, v)) / 100; // 0.60..1.40
  // Road height scales relative to viewport but clamped
  const base = Math.min(720, Math.max(420, Math.round(window.innerHeight * 0.62)));
  const h = Math.round(base * s);
  document.documentElement.style.setProperty("--roadH", `${h}px`);
  if (uiScaleReadout) uiScaleReadout.textContent = `${Math.round(s*100)}%`;
  setTimeout(() => { try { resizeCanvasToDisplaySize(); } catch(_){} }, 50);
}
if (uiScaleEl) uiScaleEl.addEventListener("input", applyUiScale);
applyUiScale();


function ensureAudioEl() {
  if (audioEl) return audioEl;
  audioEl = document.createElement("audio");
  audioEl.id = "audioPlayer";
  audioEl.preload = "auto";
  audioEl.controls = false;
  document.body.appendChild(audioEl);
  return audioEl;
}

function getSyncOffset() {
  return syncOffsetEl ? parseFloat(syncOffsetEl.value || "0") : 0;
}

function loopLabel() {
  const a = loopA == null ? "—" : loopA.toFixed(2) + "s";
  const b = loopB == null ? "—" : loopB.toFixed(2) + "s";
  if (loopReadout) loopReadout.textContent = `A: ${a}  B: ${b}`;
}
loopLabel();
 });
getSpeedFactor();

// Bass mapping (standard tuning)
const STRINGS = [
  { name: "E", midiOpen: 28 }, // E1
  { name: "A", midiOpen: 33 }, // A1
  { name: "D", midiOpen: 38 }, // D2
  { name: "G", midiOpen: 43 }  // G2
];

function bassPositionsForMidi(targetMidi, maxFret = 20) {
  const positions = [];
  for (const s of STRINGS) {
    const fret = targetMidi - s.midiOpen;
    if (fret >= 0 && fret <= maxFret) {
      positions.push({ string: s.name, fret, midi: targetMidi });
    }
  }
  // Prefer lower frets, and if tie prefer higher string (G>D>A>E) for reach
  const stringRank = { "G": 0, "D": 1, "A": 2, "E": 3 };
  positions.sort((a,b) => (a.fret - b.fret) || (stringRank[a.string]-stringRank[b.string]));
  return positions;
}

function formatPos(p) {
  return `${p.string} string • fret ${p.fret}`;
}

function filterToBassPlayable(events, maxFret, lowestOnly=true) {
  const playable = events.filter(ev => bassPositionsForMidi(ev.midi, maxFret).length > 0);
  if (!lowestOnly) return playable;

  playable.sort((a,b)=>a.time-b.time || a.midi-b.midi);
  const grouped = [];
  const EPS = 0.03; // 30ms
  let bucket = [];
  let t0 = null;

  for (const ev of playable) {
    if (t0 === null || Math.abs(ev.time - t0) <= EPS) {
      bucket.push(ev);
      if (t0 === null) t0 = ev.time;
    } else {
      bucket.sort((x,y)=>x.midi-y.midi);
      grouped.push(bucket[0]);
      bucket = [ev];
      t0 = ev.time;
    }
  }
  if (bucket.length) {
    bucket.sort((x,y)=>x.midi-y.midi);
    grouped.push(bucket[0]);
  }
  return grouped;
}

function setTab(name) {
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
  $(`tab-${name}`).classList.add("active");
}
document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

async function startMic() {
  if (audioCtx) return;

  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" });
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false
    }
  });

  const src = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 4096; // good for low notes
  dataBuf = new Float32Array(analyser.fftSize);

  src.connect(analyser);

  micStatus.textContent = "Mic: on";
  loopPitch();
}

function loopPitch() {
  if (!analyser) return;
  analyser.getFloatTimeDomainData(dataBuf);

  const { freq, confidence } = autoCorrelateFloat32(dataBuf, audioCtx.sampleRate);
  const minConf = parseFloat(minConfEl.value);

  const maxFret = parseInt(maxFretEl.value, 10) || 20;

  if (freq && confidence >= minConf) {
    const midi = freqToMidi(freq);
    const name = midiToNoteName(midi);
    lastPitch = { freq, confidence, midi, name };
    noteReadout.textContent = `${name} (${freq.toFixed(1)} Hz)`;

    // Update tuner UI using nearest semitone as target
    const targetMidi = Math.round(midi);
    const targetFreq = midiToFreq(targetMidi);
    const cents = centsOff(freq, targetFreq);

    tunerNote.textContent = midiToNoteName(targetMidi);
    tunerHz.textContent = `${freq.toFixed(2)} Hz`;
    tunerCents.textContent = `${cents >= 0 ? "+" : ""}${cents.toFixed(1)} cents`;

    // Suggested string+fret
    const pos = bassPositionsForMidi(targetMidi, maxFret);
    if (pos.length) {
      tunerPos.textContent = formatPos(pos[0]);
      if (pos.length > 1) {
        tunerAlt.textContent = `Also: ${pos.slice(1,4).map(formatPos).join(" • ")}`;
      } else {
        tunerAlt.textContent = " ";
      }
    } else {
      tunerPos.textContent = `Out of range (max fret ${maxFret})`;
      tunerAlt.textContent = " ";
    }

    // Meter needle: clamp to [-50, +50]
    const clamped = Math.max(-50, Math.min(50, cents));
    const pct = 50 + (clamped); // -50=>0, +50=>100
    meterNeedle.style.left = `${pct}%`;
  } else {
    noteReadout.textContent = `—`;
    tunerHz.textContent = `— Hz`;
    tunerCents.textContent = `— cents`;
    tunerPos.textContent = "—";
    tunerAlt.textContent = " ";
    meterNeedle.style.left = `50%`;
  }

  requestAnimationFrame(loopPitch);
}

btnStartAudio.addEventListener("click", async () => {
  try {
    await startMic();
  } catch (e) {
    console.error(e);
    micStatus.textContent = "Mic: error";
  }
});

// MIDI upload

if (audioFile) {
  audioFile.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const a = ensureAudioEl();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(file);
    a.src = audioUrl;
    audioLoaded = true;
    practiceStatus.textContent = "Audio loaded. Use Song sync (sec) if notes don't line up.";
  });
}


async function loadMidiFromFile(file) {
  if (!file) return;
  try {
    const { parseMidiFile } = await import("./midi.js");
    midiData = await parseMidiFile(file);

    const maxFret = parseInt(maxFretEl.value,10) || 20;
    const bassOnly = bassOnlyEl ? bassOnlyEl.checked : true;
    const lowestOnly = lowestOnlyEl ? lowestOnlyEl.checked : true;
    if (bassOnly) {
      const filtered = filterToBassPlayable(midiData.events, maxFret, lowestOnly);
      midiData = { events: filtered, duration: midiData.duration };
    }

    practiceStatus.textContent = `Loaded: ${midiData.events.length} playable notes • ${midiData.duration.toFixed(2)}s`;
    drawLane(0);
  } catch (e) {
    console.error(e);
    alert("Could not read that MIDI file.");
  }
}


if (libSearch) libSearch.addEventListener("input", renderLibrary);

if (libClear) {
  libClear.addEventListener("click", async () => {
    if (!confirm("Clear all saved MIDI files from this device?")) return;
    await dbClear();
    await refreshLibrary();
  });
}

if (libAddFiles) {
  libAddFiles.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []).filter(f => f && (f.name||"").toLowerCase().endsWith(".mid") || (f.name||"").toLowerCase().endsWith(".midi"));
    if (!files.length) return;

    let added = 0;
    for (const f of files) {
      const buf = await f.arrayBuffer();
      const id = await hashBuffer(buf);
      await dbPut({
        id,
        name: f.name,
        size: f.size,
        addedAt: Date.now(),
        bytes: new Uint8Array(buf)
      });
      added++;
    }
    practiceStatus.textContent = `Saved ${added} MIDI file${added===1?"":"s"} to Library.`;
    await refreshLibrary();
    // reset input so uploading same files again triggers change
    libAddFiles.value = "";
  });
}

midiFile.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  await loadMidiFromFile(file);
});
function refilterMidi() {
  if (!midiData) return;
  const maxFret = parseInt(maxFretEl.value,10) || 20;
  const bassOnly = bassOnlyEl ? bassOnlyEl.checked : true;
  const lowestOnly = lowestOnlyEl ? lowestOnlyEl.checked : true;
  if (bassOnly) {
    const filtered = filterToBassPlayable(midiData.events, maxFret, lowestOnly);
    midiData = { events: filtered, duration: midiData.duration };
    practiceStatus.textContent = `Ready: ${midiData.events.length} playable notes • ${midiData.duration.toFixed(2)}s`;
  } else {
    practiceStatus.textContent = `Ready: ${midiData.events.length} notes • ${midiData.duration.toFixed(2)}s`;
  }
  drawLane(0);
}
if (maxFretEl) maxFretEl.addEventListener("change", refilterMidi);
if (bassOnlyEl) bassOnlyEl.addEventListener("change", refilterMidi);
if (lowestOnlyEl) lowestOnlyEl.addEventListener("change", refilterMidi);
if (viewModeEl) viewModeEl.addEventListener("change", () => { drawLane(0); });

btnPlay.addEventListener("click", () => {
  if (!midiData) return alert("Load a MIDI file first.");
  if (!audioCtx) return alert("Tap “Enable Mic” first (Safari requirement).");

  // Resume if paused
  if (isPaused) {
    isPlaying = true;
    isPaused = false;
    // Keep continuity: startTime such that playbackTime continues from pausedAt
    startTime = audioCtx.currentTime - (pausedAt / getSpeedFactor());
    if (audioLoaded && (playAudioEl && playAudioEl.checked)) {
      const a = ensureAudioEl();
      const target = Math.max(0, pausedAt + getSyncOffset());
      a.currentTime = target;
      a.play().catch(()=>{});
    }
    tick();
    return;
  }

  isPlaying = true;
  isPaused = false;
  pausedAt = 0;
  startTime = audioCtx.currentTime;
  if (audioLoaded && (playAudioEl && playAudioEl.checked)) {
    const a = ensureAudioEl();
    const target = Math.max(0, 0 + getSyncOffset());
    a.currentTime = target;
    a.play().catch(()=>{});
  }
  tick();
});

btnStop.addEventListener("click", stopPlayback);
function currentPlaybackTimeScaled() {
  const speed = getSpeedFactor();
  return (audioCtx.currentTime - startTime) * speed;
}

function pausePlayback() {
  if (!isPlaying || !audioCtx) return;
  isPaused = true;
  isPlaying = false;
  pausedAt = currentPlaybackTimeScaled();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  practiceStatus.textContent = "Paused. Press Play or Space to resume.";
  if (audioLoaded) { try { ensureAudioEl().pause(); } catch(_){} }
  // Keep the last drawn frame visible (do not clear)
}

function togglePause() {
  if (isPlaying) pausePlayback();
  else if (isPaused) btnPlay.click();
}

if (btnPause) btnPause.addEventListener("click", togglePause);

window.addEventListener("keydown", (e) => {
  // Don't hijack typing in inputs
  const t = e.target;
  const tag = t && t.tagName ? t.tagName.toLowerCase() : "";
  if (tag === "input" || tag === "textarea" || tag === "select") return;

  if (e.code === "Space") {
    e.preventDefault();
    togglePause();
  }
});



function setTimelineTo(tSec) {
  const speed = getSpeedFactor();
  startTime = audioCtx.currentTime - (tSec / speed);
}

function getTimelineNow() {
  const speed = getSpeedFactor();
  return (audioCtx.currentTime - startTime) * speed;
}

if (btnRestart) btnRestart.addEventListener("click", () => {
  if (!audioCtx) return;
  const t0 = loopA != null ? loopA : 0;
  setTimelineTo(t0);
  if (audioLoaded && (playAudioEl && playAudioEl.checked)) {
    const a = ensureAudioEl();
    const target = Math.max(0, t0 + getSyncOffset());
    a.currentTime = target;
    a.play().catch(()=>{});
  }
  drawLane(t0);
});

if (btnSetA) btnSetA.addEventListener("click", () => {
  if (!audioCtx) return;
  loopA = getTimelineNow();
  if (loopB != null && loopB <= loopA) loopB = null;
  loopLabel();
});

if (btnSetB) btnSetB.addEventListener("click", () => {
  if (!audioCtx) return;
  loopB = getTimelineNow();
  if (loopA == null) loopA = 0;
  if (loopB <= loopA) loopB = loopA + 1.0;
  loopLabel();
});

if (loopOnEl) loopOnEl.addEventListener("change", () => {
  loopLabel();
});

function stopPlayback() {
  isPaused = false;
  pausedAt = 0;
  isPlaying = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  drawLane(0);
  practiceStatus.textContent = midiData ? "Stopped." : "Load a MIDI file to begin.";
  if (audioLoaded) { try { ensureAudioEl().pause(); } catch(_){} }
}

function tick() {
  if (!isPlaying || !midiData) return;
  const speed = getSpeedFactor();
  const t = (audioCtx.currentTime - startTime) * speed;
  // Loop A–B (visual timeline)
  if ((loopOnEl && loopOnEl.checked) && loopA != null && loopB != null && t >= loopB) {
    const backTo = loopA;
    setTimelineTo(backTo);
    if (audioLoaded && (playAudioEl && playAudioEl.checked)) {
      const a = ensureAudioEl();
      a.currentTime = Math.max(0, backTo + getSyncOffset());
      a.play().catch(()=>{});
    }
    drawLane(backTo);
    rafId = requestAnimationFrame(tick);
    return;
  }

  // Optional audio sync
  if (audioLoaded && (playAudioEl && playAudioEl.checked)) {
    const a = ensureAudioEl();
    const want = Math.max(0, t + getSyncOffset());
    const drift = Math.abs((a.currentTime || 0) - want);
    if (!a.paused && drift > 0.25) {
      a.currentTime = want;
    } else if (a.paused) {
      a.currentTime = want;
      a.play().catch(()=>{});
    }
  }

  drawLane(t);
  rafId = requestAnimationFrame(tick);
  if (t > midiData.duration + 0.5) stopPlayback();
}


function pickBestPositionForMidi(midi, maxFret) {
  const pos = bassPositionsForMidi(midi, maxFret);
  return pos.length ? pos[0] : null;
}




function drawGHView(nowSec, midiData, w, h, maxFret, hitWindowSec) {
  // Pseudo-3D "highway" with better perspective + lane colors + sustain tails.
  const lanes = ["E","A","D","G"]; // low->high
  const laneColors = {
    E: "rgba(76, 195, 255, 0.95)",
    A: "rgba(120, 255, 140, 0.95)",
    D: "rgba(255, 220, 90, 0.95)",
    G: "rgba(255, 120, 200, 0.95)",
  };

  const topY = 40;
  const bottomY = h - 55;
  const cx = w / 2;

  const topW = Math.min(w * 0.40, 520);
  const botW = Math.min(w * 0.92, 980);

  const hitY = bottomY - 26;
  const pxPerSec = 260; // fall speed feel

  // Background
  ctx.fillStyle = "#07070a";
  ctx.fillRect(0,0,w,h);

  // Road trapezoid
  const topL = cx - topW/2, topR = cx + topW/2;
  const botL = cx - botW/2, botR = cx + botW/2;

  // Clip to road
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(topL, topY);
  ctx.lineTo(topR, topY);
  ctx.lineTo(botR, bottomY);
  ctx.lineTo(botL, bottomY);
  ctx.closePath();
  ctx.clip();

  // Asphalt texture (scrolling)
  if (!asphaltPattern) buildAsphaltPattern();
  const scroll = (nowSec * 190) % 256;
  ctx.setTransform(1,0,0,1,0,0);
  ctx.translate(0, scroll);
  ctx.fillStyle = asphaltPattern;
  ctx.fillRect(0, -256, w, (bottomY - topY) + 512);
  ctx.setTransform(1,0,0,1,0,0);

  // Lighting gradient (horizon darker)
  const g = ctx.createLinearGradient(0, topY, 0, bottomY);
  g.addColorStop(0, "rgba(0,0,0,0.62)");
  g.addColorStop(0.65, "rgba(0,0,0,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0.10)");
  ctx.fillStyle = g;
  ctx.fillRect(0, topY, w, bottomY-topY);

  // Lane separators + subtle colored glow strips
  for (let k=0;k<4;k++){
    const t0 = k/4, t1 = (k+1)/4;
    const xTop0 = topL + t0*topW;
    const xTop1 = topL + t1*topW;
    const xBot0 = botL + t0*botW;
    const xBot1 = botL + t1*botW;

    const lane = lanes[k];
    // glow strip near bottom
    ctx.fillStyle = laneColors[lane];
    ctx.globalAlpha = 0.10;
    ctx.beginPath();
    ctx.moveTo(xBot0, hitY+10);
    ctx.lineTo(xBot1, hitY+10);
    ctx.lineTo(xBot1, bottomY);
    ctx.lineTo(xBot0, bottomY);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;

    // separators
    if (k>0){
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(xTop0, topY);
      ctx.lineTo(xBot0, bottomY);
      ctx.stroke();
    }
  }

  // Perspective dashed center
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 3;
  ctx.setLineDash([22, 16]);
  ctx.lineDashOffset = -(nowSec*220)%38;
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx, bottomY);
  ctx.stroke();
  ctx.setLineDash([]);

  // Hit line + glow
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(botL, hitY, botW, 3);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(botL, hitY-12, botW, 26);

  ctx.restore();

  // Big lane letters at bottom (outside road for readability)
  ctx.font = "700 18px -apple-system, system-ui";
  for (let k=0;k<4;k++){
    const lane = lanes[k];
    const x = (cx - botW/2) + (k+0.5)*(botW/4);
    ctx.fillStyle = laneColors[lane];
    ctx.globalAlpha = 0.95;
    ctx.fillText(lane, x-6, bottomY + 30);
    ctx.globalAlpha = 1;
  }

  // Helper: perspective mapping
  function roadAtY(y){
    const p = (y - topY) / (bottomY - topY);
    const ww = topW + p*(botW-topW);
    const ll = cx - ww/2;
    return { p: Math.max(0, Math.min(1, p)), w: ww, l: ll };
  }

  // Draw events within window
  const windowStart = nowSec - 0.15;
  const windowEnd = nowSec + 5.0;

  let currentTarget = null;

  for (const ev of midiData.events) {
    if (ev.time < windowStart || ev.time > windowEnd) continue;
    const best = pickBestPositionForMidi(ev.midi, maxFret);
    if (!best) continue;

    const laneIdx = lanes.indexOf(best.string);
    if (laneIdx < 0) continue;

    const dt = ev.time - nowSec;
    const y = hitY - dt * pxPerSec;

    const { p, w: rw, l: rl } = roadAtY(y);
    const laneW = rw / 4;
    const x = rl + laneIdx*laneW + laneW*0.18;
    const noteW = laneW*0.64;

    // sustain tail length based on duration
    const dur = Math.max(0.05, ev.duration || 0.1);
    const tailH = Math.min((dur * pxPerSec), (bottomY - y) + 40);
    const yTop = y - 18 - tailH;

    const near = Math.abs(ev.time - nowSec) <= hitWindowSec;
    if (near && !currentTarget) currentTarget = ev;

    // Clip notes to road so they don't float
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx-topW/2, topY);
    ctx.lineTo(cx+topW/2, topY);
    ctx.lineTo(cx+botW/2, bottomY);
    ctx.lineTo(cx-botW/2, bottomY);
    ctx.closePath();
    ctx.clip();

    // Tail (gradient)
    const c = laneColors[best.string];
    const tailGrad = ctx.createLinearGradient(0, yTop, 0, y-6);
    tailGrad.addColorStop(0, c.replace("0.95", "0.00"));
    tailGrad.addColorStop(1, c.replace("0.95", near ? "0.45" : "0.28"));
    ctx.fillStyle = tailGrad;
    roundRect(ctx, x + noteW*0.35, yTop, noteW*0.30, tailH, 10 + p*8);
    ctx.fill();

    // Note "gem" (rounded pill)
    const gemH = 22 + p*10;
    const gemY = y - gemH;
    // Shadow
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "#000";
    roundRect(ctx, x+2, gemY+3, noteW, gemH, 12 + p*10);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = c;
    roundRect(ctx, x, gemY, noteW, gemH, 12 + p*10);
    ctx.fill();

    // inner highlight
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#fff";
    roundRect(ctx, x+4, gemY+4, noteW-8, gemH*0.35, 10 + p*8);
    ctx.fill();
    ctx.globalAlpha = 1;

    // Text label
    ctx.fillStyle = "rgba(10,10,10,0.88)";
    ctx.font = `${Math.round(12 + p*5)}px -apple-system, system-ui`;
    ctx.fillText(`${best.string}${best.fret}`, x + 10, gemY + gemH*0.68);

    ctx.restore();
  }

  // HUD tip
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "12px -apple-system, system-ui";
  ctx.fillText("Tip: Use UI scale to zoom; Song sync aligns audio; Loop A–B for drilling sections.", 12, 18);

  return currentTarget;
}



function drawTabView(nowSec, midiData, w, h, centerX, pxPerSec, maxFret, hitWindowSec) {
  // Draw 4 horizontal lanes labeled G D A E (top to bottom)
  const laneTop = 60;
  const laneBottom = h - 30;
  const laneH = (laneBottom - laneTop) / 4;
  const lanes = ["G","D","A","E"];
  ctx.fillStyle = "#bbb";
  ctx.font = "14px -apple-system, system-ui";
  ctx.fillText("G", 10, laneTop + laneH*0.5 + 5);
  ctx.fillText("D", 10, laneTop + laneH*1.5 + 5);
  ctx.fillText("A", 10, laneTop + laneH*2.5 + 5);
  ctx.fillText("E", 10, laneTop + laneH*3.5 + 5);

  // lane lines
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#202020";
  for (let k=0;k<5;k++){
    const y = laneTop + k*laneH;
    ctx.fillRect(0, y-1, w, 2);
  }

  const windowStart = nowSec - 0.2;
  const windowEnd = nowSec + (w / pxPerSec);

  let currentTarget = null;

  for (const ev of midiData.events) {
    if (ev.time < windowStart || ev.time > windowEnd) continue;
    const best = pickBestPositionForMidi(ev.midi, maxFret);
    if (!best) continue;

    const laneIdx = lanes.indexOf(best.string);
    const y = laneTop + laneIdx*laneH + laneH/2;

    const x = centerX + (ev.time - nowSec) * pxPerSec;
    const noteW = Math.max(10, ev.duration * pxPerSec);
    const noteH = 18;

    const near = Math.abs(ev.time - nowSec) <= hitWindowSec;
    if (near && !currentTarget) currentTarget = ev;

    ctx.fillStyle = near ? "#ddd" : "#777";
    ctx.fillRect(x, y - noteH/2, noteW, noteH);

    ctx.fillStyle = "#0b0b0b";
    ctx.font = "13px -apple-system, system-ui";
    ctx.fillText(String(best.fret), x + 6, y + 5);
  }

  return currentTarget;
}
function drawLane(nowSec) {
  const w = lane.width, h = lane.height;
  ctx.clearRect(0, 0, w, h);

  const secondsOnScreen = 4.0;
  const centerX = w * 0.25; // hit line
  const pxPerSec = w / secondsOnScreen;

  // hit line
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#444";
  ctx.fillRect(centerX - 2, 0, 4, h);

  // Map MIDI -> Y
  const minMidi = 28; // E1
  const maxMidi = 67; // G4
  const yForMidi = (m) => {
    const clamped = Math.max(minMidi, Math.min(maxMidi, m));
    const t = (clamped - minMidi) / (maxMidi - minMidi);
    return h - (t * (h - 50)) - 25;
  };

  const maxFret = parseInt(maxFretEl.value, 10) || 20;

  if (midiData) {
    const windowStart = nowSec - 0.2;
    const windowEnd = nowSec + secondsOnScreen;

    const hitWindowMs = parseInt(hitWindowEl.value, 10) || 180;
    const hitWindowSec = hitWindowMs / 1000;

    const mode = viewModeEl ? viewModeEl.value : "piano";
    let currentTarget = null;

    if (mode === "gh") {
      currentTarget = drawGHView(nowSec, midiData, w, h, maxFret, hitWindowSec);
    } else if (mode === "tab") {
      currentTarget = drawTabView(nowSec, midiData, w, h, centerX, pxPerSec, maxFret, hitWindowSec);
    } else {

    for (const ev of midiData.events) {
      if (ev.time < windowStart || ev.time > windowEnd) continue;

      const x = centerX + (ev.time - nowSec) * pxPerSec;
      const y = yForMidi(ev.midi);
      const noteW = Math.max(6, ev.duration * pxPerSec);
      const noteH = 12;

      const near = Math.abs(ev.time - nowSec) <= hitWindowSec;
      if (near && !currentTarget) currentTarget = ev;

      ctx.fillStyle = near ? "#ddd" : "#777";
      ctx.fillRect(x, y - noteH / 2, noteW, noteH);

      // Label with string+fret suggestion
      const positions = bassPositionsForMidi(ev.midi, maxFret);
      const label = positions.length ? `${midiToNoteName(ev.midi)} • ${positions[0].string}${positions[0].fret}` : midiToNoteName(ev.midi);

      ctx.fillStyle = "#bbb";
      ctx.font = "12px -apple-system, system-ui";
      ctx.fillText(label, x + 4, y - 10);
    }

    }

    // Evaluate hit/miss for current target
    if (currentTarget && lastPitch.midi != null) {
      const played = Math.round(lastPitch.midi);
      const target = currentTarget.midi;

      const ok = (played === target);

      // Compute suggested position for target
      const tpos = bassPositionsForMidi(target, maxFret);
      const tlabel = tpos.length ? `${midiToNoteName(target)} (${formatPos(tpos[0])})` : midiToNoteName(target);

      ctx.globalAlpha = 0.15;
      ctx.fillStyle = ok ? "#0f0" : "#f55";
      ctx.fillRect(0, 0, w, 46);
      ctx.globalAlpha = 1;
      ctx.fillStyle = ok ? "#9f9" : "#f99";
      ctx.font = "16px -apple-system, system-ui";
      ctx.fillText(
        ok
          ? `HIT ✅  ${midiToNoteName(played)}`
          : `MISS ❌  Target ${tlabel} • You ${lastPitch.name}`,
        12,
        30

    } else {
      ctx.fillStyle = "#bbb";
      ctx.font = "14px -apple-system, system-ui";
      ctx.fillText("Play along near the hit line. Your detected note drives HIT/MISS.", 12, 30);
    }
  }
}
async function refreshLibrary() {
  try {
    libraryItems = await dbGetAll();
    libraryItems.sort((a,b)=> (b.addedAt||0) - (a.addedAt||0));
    renderLibrary();
  } catch (e) {
    if (libList) libList.textContent = "Library unavailable (IndexedDB blocked).";
  }
}

function renderLibrary() {
  if (!libList) return;
  const q = ((libSearch && libSearch.value) || "").trim().toLowerCase();
  const items = q ? libraryItems.filter(it => (it.name||"").toLowerCase().includes(q)) : libraryItems;

  libList.innerHTML = "";
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "libItem";

    const meta = document.createElement("div");
    meta.className = "libMeta";

    const title = document.createElement("div");
    title.className = "libTitle";
    title.textContent = it.name || "(untitled)";

    const sub = document.createElement("div");
    sub.className = "libSub";
    const kb = Math.round((it.size||0)/1024);
    const dt = it.addedAt ? new Date(it.addedAt).toLocaleString() : "";
    sub.textContent = `${kb} KB • ${dt}`;

    meta.appendChild(title);
    meta.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "libActions";

    const btnLoad = document.createElement("button");
    btnLoad.textContent = "Load";
    btnLoad.addEventListener("click", async () => {
      try {
        // Convert stored bytes to File-like for existing parse
        const blob = new Blob([it.bytes], { type: "audio/midi" });
        const file = new File([blob], it.name || "song.mid", { type: "audio/midi" });
        // Reuse existing midi parsing flow by calling the same handler function
        await loadMidiFromFile(file);
        // Jump to Practice tab
        showTab("practice");
      } catch (e) {
        alert("Could not load MIDI.");
      }
    });

    const btnDel = document.createElement("button");
    btnDel.textContent = "Delete";
    btnDel.addEventListener("click", async () => {
      await dbDelete(it.id);
      await refreshLibrary();
    });

    actions.appendChild(btnLoad);
    actions.appendChild(btnDel);

    row.appendChild(meta);
    row.appendChild(actions);
    libList.appendChild(row);
  }

  if (libCount) libCount.textContent = `${items.length} song${items.length===1?"":"s"}`;
}



function showTab(tabName) {
  document.querySelectorAll(".tab").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tabName)

  document.querySelectorAll(".panel").forEach((p) => {
    p.hidden = p.id !== `tab-${tabName}`;
  });
}



// Initialize library
if (libCount || libList) { refreshLibrary(); }

// --- Build / update helpers ---
const BUILD_VERSION = "v27";

const updateBar = document.getElementById("updateBar");
const btnUpdateNow = document.getElementById("btnUpdateNow");
const btnUnregisterSW = document.getElementById("btnUnregisterSW");

async function unregisterServiceWorkerAndReload() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    for (const r of regs) await r.unregister();
    // Clear Cache Storage
    const keys = await caches.keys();
    for (const k of keys) await caches.delete(k);
  } catch (e) {
    console.warn(e);
  }
  location.reload(true);
}

if (btnUnregisterSW) btnUnregisterSW.addEventListener("click", () => {
  if (!confirm("This will clear this site's offline cache on this browser and reload. Continue?")) return;
  unregisterServiceWorkerAndReload();
});

if (btnUpdateNow) btnUpdateNow.addEventListener("click", () => {
  location.reload(true);
});

// If SW reports an update, show banner
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // New SW took control
    if (updateBar) updateBar.hidden = true;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  // honor the active tab button in the DOM
  const active = document.querySelector(".tab.active");
  const tab = (active && active.dataset)?.tab || "tuner";
  showTab(tab);
  if (tab === "library") refreshLibrary();
});

// Fullscreen toggle
const btnFullscreen = document.getElementById("btnFullscreen");
if (btnFullscreen) {
  btnFullscreen.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        document.body.classList.add("fullscreen");
      } else {
        await document.exitFullscreen();
        document.body.classList.remove("fullscreen");
      }
      setTimeout(() => {
        if (typeof resizeCanvasToDisplaySize === "function") resizeCanvasToDisplaySize();
      }, 50);
    } catch (e) {
      console.warn(e);
    }
  });
}

const buildBadge = document.getElementById("buildBadge"); if (buildBadge) buildBadge.textContent = `Build v21 • 2025-12-26 22:39 UTC`;