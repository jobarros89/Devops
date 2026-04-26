(() => {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioCtx();
  const MAX_HISTORY = 50;

  const state = {
    projectBpm: 120,
    snap: true,
    overlay: true,
    syncScroll: true,
    zoom: 1,
    scrollSec: 0,
    cursorSec: 0,
    activeTrack: 'A',
    tap: [],
    dragging: null,
    minimapDrag: false,
    history: [],
    hIndex: -1,
    tracks: {
      A: mkTrack('A', '#4da3ff'),
      B: mkTrack('B', '#ff9f40')
    }
  };

  function mkTrack(id, color) {
    return {
      id, color, fileName: 'sem arquivo', buffer: null, source: null, gain: audioCtx.createGain(),
      bpm: null, transients: [], markers: [], locked: false, muted: false, solo: false,
      offsetSec: 0, stretch: 1, unsaved: false
    };
  }

  state.tracks.A.gain.connect(audioCtx.destination);
  state.tracks.B.gain.connect(audioCtx.destination);

  const ui = {
    projectBpm: el('projectBpm'), projectMs: el('projectMs'), tapTempoBtn: el('tapTempoBtn'),
    halfBtn: el('halfBtn'), doubleBtn: el('doubleBtn'), playBtn: el('playBtn'), stopBtn: el('stopBtn'),
    autoSyncBtn: el('autoSyncBtn'), overlayBtn: el('overlayBtn'), snapBtn: el('snapBtn'),
    syncScrollBtn: el('syncScrollBtn'), undoBtn: el('undoBtn'), redoBtn: el('redoBtn'), exportOpenBtn: el('exportOpenBtn'),
    canvasA: el('canvasA'), canvasB: el('canvasB'), minimapCanvas: el('minimapCanvas'),
    trackA: el('trackA'), trackB: el('trackB'), aFile: el('aFile'), bFile: el('bFile'),
    aName: el('aName'), bName: el('bName'), aBpmInfo: el('aBpmInfo'), bBpmInfo: el('bBpmInfo'), bDiff: el('bDiff'),
    aBpm: el('aBpm'), bBpm: el('bBpm'), aMute: el('aMute'), bMute: el('bMute'), aSolo: el('aSolo'), bSolo: el('bSolo'), aLock: el('aLock'), bLock: el('bLock'),
    activeTrackLabel: el('activeTrackLabel'), cursorInfo: el('cursorInfo'), offsetMs: el('offsetMs'), offsetSamples: el('offsetSamples'),
    offsetReset: el('offsetReset'), snapNearestBtn: el('snapNearestBtn'), zoomInBtn: el('zoomInBtn'), zoomOutBtn: el('zoomOutBtn'),
    undoInfo: el('undoInfo'), toast: el('toast'), shortcuts: el('shortcuts'),
    exportWhat: el('exportWhat'), exportSr: el('exportSr'), exportName: el('exportName'), exportBtn: el('exportBtn'), exportBar: el('exportBar')
  };

  const cA = ui.canvasA.getContext('2d');
  const cB = ui.canvasB.getContext('2d');
  const cM = ui.minimapCanvas.getContext('2d');

  function el(id) { return document.getElementById(id); }
  function maxDur() { return Math.max(state.tracks.A.buffer?.duration || 0, state.tracks.B.buffer?.duration || 0, 1); }
  function secToX(sec, canvas) { return ((sec - state.scrollSec) / visSec()) * canvas.width; }
  function xToSec(x, canvas) { return state.scrollSec + (x / canvas.width) * visSec(); }
  function visSec() { return maxDur() / state.zoom; }
  function bpmMs(bpm) { return 60000 / bpm; }

  function setToast(msg) {
    ui.toast.textContent = msg;
    setTimeout(() => { if (ui.toast.textContent === msg) ui.toast.textContent = ''; }, 1800);
  }

  function pushHistory() {
    const snap = JSON.stringify({
      projectBpm: state.projectBpm, snap: state.snap, overlay: state.overlay, syncScroll: state.syncScroll,
      activeTrack: state.activeTrack,
      tracks: {
        A: pickTrack(state.tracks.A),
        B: pickTrack(state.tracks.B)
      }
    });
    state.history = state.history.slice(0, state.hIndex + 1);
    state.history.push(snap);
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.hIndex = state.history.length - 1;
    updateUndoInfo();
  }

  function pickTrack(t) {
    return {
      bpm: t.bpm, markers: t.markers, locked: t.locked, muted: t.muted, solo: t.solo,
      offsetSec: t.offsetSec, stretch: t.stretch, unsaved: t.unsaved
    };
  }

  function restoreHistory(idx) {
    const raw = state.history[idx];
    if (!raw) return;
    const snap = JSON.parse(raw);
    state.projectBpm = snap.projectBpm;
    state.snap = snap.snap;
    state.overlay = snap.overlay;
    state.syncScroll = snap.syncScroll;
    state.activeTrack = snap.activeTrack;
    ['A','B'].forEach(k => Object.assign(state.tracks[k], snap.tracks[k]));
    syncUiFromState();
    renderAll();
    updateUndoInfo();
  }

  function updateUndoInfo() {
    ui.undoInfo.textContent = `↩ ${Math.max(0, state.hIndex)} ações para desfazer`;
  }

  async function loadTrack(file, key) {
    const arr = await file.arrayBuffer();
    const buf = await audioCtx.decodeAudioData(arr.slice(0));
    const t = state.tracks[key];
    t.fileName = file.name;
    t.buffer = buf;
    t.transients = detectTransients(buf);
    t.bpm = detectBpm(buf);
    if (key === 'A') { ui.aName.textContent = `| ${file.name}`; ui.aBpm.value = t.bpm.toFixed(2); }
    else { ui.bName.textContent = `| ${file.name}`; ui.bBpm.value = t.bpm.toFixed(2); }
    updateTrackInfo();
    pushHistory();
    renderAll();
    setToast(`✓ Track ${key} carregada (${t.bpm.toFixed(2)} BPM)`);
  }

  function detectBpm(buffer) {
    const d = buffer.getChannelData(0), sr = buffer.sampleRate, hop = 1024;
    const env = [];
    for (let i = 0; i < d.length; i += hop) {
      let sum = 0;
      for (let j = i; j < i + hop && j < d.length; j++) sum += Math.abs(d[j]);
      env.push(sum / hop);
    }
    const peaks = [];
    for (let i = 2; i < env.length - 2; i++) if (env[i] > env[i - 1] && env[i] > env[i + 1] && env[i] > 0.05) peaks.push(i);
    const bins = {};
    for (let i = 1; i < peaks.length; i++) {
      const sec = ((peaks[i] - peaks[i - 1]) * hop) / sr;
      let bpm = 60 / Math.max(sec, 0.001);
      while (bpm < 70) bpm *= 2;
      while (bpm > 180) bpm /= 2;
      const b = bpm.toFixed(2);
      bins[b] = (bins[b] || 0) + 1;
    }
    const best = Object.entries(bins).sort((a, b) => b[1] - a[1])[0];
    return best ? Number(best[0]) : 120;
  }

  function detectTransients(buffer) {
    const d = buffer.getChannelData(0), frame = 2048, hop = 512, out = [];
    let prev = 0;
    for (let i = 0; i + frame < d.length; i += hop) {
      let e = 0;
      for (let j = i; j < i + frame; j++) e += d[j] * d[j];
      e /= frame;
      if (e - prev > 0.0025) out.push(i / buffer.sampleRate);
      prev = e;
    }
    return out;
  }

  function renderLane(ctx, track, canvas, isActive) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid(ctx, canvas);
    if (track.buffer) drawWave(ctx, canvas, track, track.color);
    drawTransients(ctx, canvas, track);
    drawMarkers(ctx, canvas, track);
    if (isActive) {
      const x = secToX(state.cursorSec, canvas);
      ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    }
  }

  function drawGrid(ctx, canvas) {
    const beat = 60 / state.projectBpm;
    const subdivisions = [1, 0.5, 0.25];
    subdivisions.forEach((sub, idx) => {
      ctx.strokeStyle = `rgba(148,163,184,${0.33 - idx * 0.09})`;
      for (let t = Math.floor(state.scrollSec / (beat * sub)) * beat * sub; t < state.scrollSec + visSec(); t += beat * sub) {
        const x = secToX(t, canvas);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      }
    });
    ctx.fillStyle = '#94a3b8';
    for (let t = Math.floor(state.scrollSec / (beat * 4)) * beat * 4, bar = 1; t < state.scrollSec + visSec(); t += beat, bar++) {
      const x = secToX(t, canvas);
      const beatNum = ((Math.round((t / beat)) % 4) + 1);
      const barNum = Math.floor(t / (beat * 4)) + 1;
      ctx.fillText(`${barNum}.${beatNum}`, x + 2, 10);
    }
  }

  function drawWave(ctx, canvas, track, color) {
    const d = track.buffer.getChannelData(0);
    const from = Math.floor((state.scrollSec / track.buffer.duration) * d.length);
    const to = Math.floor(((state.scrollSec + visSec()) / track.buffer.duration) * d.length);
    const len = Math.max(1, to - from);
    const step = Math.max(1, Math.floor(len / canvas.width));
    const mid = canvas.height / 2;
    ctx.strokeStyle = color;
    for (let x = 0; x < canvas.width; x++) {
      const i = from + x * step;
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) {
        const v = d[i + j] || 0; if (v < min) min = v; if (v > max) max = v;
      }
      ctx.beginPath(); ctx.moveTo(x, mid + min * mid * 0.9); ctx.lineTo(x, mid + max * mid * 0.9); ctx.stroke();
    }
  }

  function drawTransients(ctx, canvas, track) {
    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    track.transients.forEach(t => {
      if (t < state.scrollSec || t > state.scrollSec + visSec()) return;
      const x = secToX(t + track.offsetSec, canvas);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
    });
  }

  function drawMarkers(ctx, canvas, track) {
    track.markers.forEach((m, idx) => {
      const x = secToX(m.sec, canvas);
      ctx.strokeStyle = track.color; ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.fillText(`${idx + 1} ${toBars(m.sec)}`, x + 2, canvas.height - 4);
    });
    ctx.lineWidth = 1;
  }

  function renderMinimap() {
    cM.clearRect(0, 0, ui.minimapCanvas.width, ui.minimapCanvas.height);
    ['A', 'B'].forEach((k, idx) => {
      const t = state.tracks[k]; if (!t.buffer) return;
      const d = t.buffer.getChannelData(0); const h = ui.minimapCanvas.height / 2; const yBase = idx === 0 ? h * .5 : h * 1.5;
      cM.strokeStyle = idx === 0 ? 'rgba(77,163,255,.7)' : 'rgba(255,159,64,.7)';
      const step = Math.max(1, Math.floor(d.length / ui.minimapCanvas.width));
      for (let x = 0; x < ui.minimapCanvas.width; x++) {
        let max = 0; const i = x * step;
        for (let j = 0; j < step; j++) max = Math.max(max, Math.abs(d[i + j] || 0));
        cM.beginPath(); cM.moveTo(x, yBase); cM.lineTo(x, yBase - max * 22); cM.stroke();
      }
    });
    cM.strokeStyle = '#fff';
    cM.strokeRect((state.scrollSec / maxDur()) * ui.minimapCanvas.width, 2, (visSec() / maxDur()) * ui.minimapCanvas.width, ui.minimapCanvas.height - 4);
  }

  function renderAll() {
    renderLane(cA, state.tracks.A, ui.canvasA, state.activeTrack === 'A');
    renderLane(cB, state.tracks.B, ui.canvasB, state.activeTrack === 'B');
    if (state.overlay && state.tracks.B.buffer) {
      cA.globalAlpha = .5;
      drawWave(cA, ui.canvasA, state.tracks.B, '#ff9f40');
      cA.globalAlpha = 1;
    }
    renderMinimap();
    ui.cursorInfo.textContent = `${state.cursorSec.toFixed(3)}s | ${(state.cursorSec * 1000).toFixed(2)} ms`;
    ui.activeTrackLabel.textContent = state.activeTrack;
    const sr = state.tracks.B.buffer?.sampleRate || 44100;
    ui.offsetSamples.textContent = `${Math.round(state.tracks.B.offsetSec * sr)} samples`;
    ui.offsetMs.value = (state.tracks.B.offsetSec * 1000).toFixed(2);
    ['A', 'B'].forEach(k => {
      const lane = k === 'A' ? ui.trackA : ui.trackB;
      lane.classList.toggle('active', state.activeTrack === k);
      lane.classList.toggle('unsaved', state.tracks[k].unsaved);
    });
  }

  function syncUiFromState() {
    ui.projectBpm.value = state.projectBpm.toFixed(2);
    ui.projectMs.textContent = `${bpmMs(state.projectBpm).toFixed(2)} ms/beat`;
    ui.snapBtn.textContent = `Snap ${state.snap ? 'ON' : 'OFF'}`;
    ui.overlayBtn.textContent = `Overlay ${state.overlay ? 'ON' : 'OFF'}`;
    ui.syncScrollBtn.textContent = `Sync Scroll ${state.syncScroll ? 'ON' : 'OFF'}`;
    updateTrackInfo();
  }

  function updateTrackInfo() {
    ui.aBpmInfo.textContent = `| BPM: ${state.tracks.A.bpm ? state.tracks.A.bpm.toFixed(2) : '--'}`;
    ui.bBpmInfo.textContent = `| BPM: ${state.tracks.B.bpm ? state.tracks.B.bpm.toFixed(2) : '--'}`;
    const b = state.tracks.B.bpm;
    ui.bDiff.textContent = b ? `| Δ projeto: ${(((b - state.projectBpm) / state.projectBpm) * 100).toFixed(1)}%` : '| Δ projeto: --';
    ui.projectMs.textContent = `${bpmMs(state.projectBpm).toFixed(2)} ms/beat`;
  }

  function toBars(sec) {
    const beat = 60 / state.projectBpm;
    const q = sec / (beat / 4);
    const bar = Math.floor(q / 16) + 1;
    const beatN = Math.floor((q % 16) / 4) + 1;
    const sub = Math.floor(q % 4) + 1;
    return `${bar}.${beatN}.${sub}`;
  }

  function setActiveTrack(k) { state.activeTrack = k; renderAll(); }

  function getHitMarker(track, sec) { return track.markers.find(m => Math.abs(m.sec - sec) < (visSec() / 120)); }

  function makeMarker(track, sec) {
    if (track.locked) return;
    track.markers.push({ sec, id: Date.now() + Math.random() });
    track.unsaved = true;
    pushHistory();
    setToast(`✓ Warp marker adicionado em ${toBars(sec)}`);
    renderAll();
  }

  function quantize(sec) {
    if (!state.snap) return sec;
    const beat = 60 / state.projectBpm / 4;
    return Math.round(sec / beat) * beat;
  }

  function nudgeActive(direction, evt) {
    const t = state.tracks[state.activeTrack];
    if (t.locked) return;
    const sr = t.buffer?.sampleRate || 44100;
    const stepMs = evt.altKey ? 100 : evt.ctrlKey ? (1000 / sr) : evt.shiftKey ? 1 : 10;
    const delta = direction * stepMs / 1000;
    if (state.activeTrack === 'B') t.offsetSec += delta;
    else t.markers.forEach(m => m.sec = Math.max(0, m.sec + delta));
    t.unsaved = true;
    pushHistory();
    renderAll();
  }

  function autoSync() {
    const a = state.tracks.A.transients[0], b = state.tracks.B.transients[0];
    if (a == null || b == null) return;
    state.tracks.B.offsetSec += (a - b);
    if (state.tracks.A.bpm && state.tracks.B.bpm) state.tracks.B.stretch = state.tracks.A.bpm / state.tracks.B.bpm;
    state.tracks.B.unsaved = true;
    pushHistory();
    renderAll();
    setToast('✓ Auto Sync concluído');
  }

  function startPlayback() {
    const solo = Object.values(state.tracks).find(t => t.solo)?.id;
    ['A', 'B'].forEach(k => {
      const t = state.tracks[k];
      if (!t.buffer) return;
      const src = audioCtx.createBufferSource();
      src.buffer = t.buffer;
      src.playbackRate.value = t.stretch;
      t.gain.gain.value = solo ? (solo === k ? 1 : 0) : (t.muted ? 0 : 1);
      src.connect(t.gain);
      const when = Math.max(audioCtx.currentTime, audioCtx.currentTime + Math.max(0, t.offsetSec));
      const startAt = Math.max(0, -t.offsetSec);
      src.start(when, startAt);
      t.source = src;
    });
  }

  function stopPlayback() {
    ['A', 'B'].forEach(k => {
      const s = state.tracks[k].source;
      if (s) { try { s.stop(); } catch (_) {} }
      state.tracks[k].source = null;
    });
  }

  async function exportWav() {
    const sr = Number(ui.exportSr.value);
    const what = ui.exportWhat.value;
    const dur = maxDur();
    const off = new OfflineAudioContext(2, Math.ceil(sr * dur), sr);
    ui.exportBar.style.width = '10%';
    await renderExportTrack(off, 'A', what);
    ui.exportBar.style.width = '45%';
    await renderExportTrack(off, 'B', what);
    ui.exportBar.style.width = '75%';
    const rendered = await off.startRendering();
    const wav = encodeWav(rendered);
    const blob = new Blob([wav], { type: 'audio/wav' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = ui.exportName.value || 'aligned_mix.wav';
    a.click();
    ui.exportBar.style.width = '100%';
    setToast('✓ Export final concluído');
    setTimeout(() => ui.exportBar.style.width = '0%', 1200);
  }

  async function renderExportTrack(off, k, what) {
    if (what !== 'mix' && what !== k) return;
    const t = state.tracks[k];
    if (!t.buffer) return;
    const src = off.createBufferSource();
    src.buffer = t.buffer;
    src.playbackRate.value = t.stretch;
    src.connect(off.destination);
    src.start(Math.max(0, t.offsetSec), Math.max(0, -t.offsetSec));
  }

  function encodeWav(buffer) {
    const ch0 = buffer.getChannelData(0), ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
    const len = ch0.length;
    const out = new ArrayBuffer(44 + len * 4);
    const v = new DataView(out);
    writeStr(v, 0, 'RIFF');
    v.setUint32(4, 36 + len * 4, true);
    writeStr(v, 8, 'WAVE');
    writeStr(v, 12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
    v.setUint32(24, buffer.sampleRate, true); v.setUint32(28, buffer.sampleRate * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true);
    writeStr(v, 36, 'data'); v.setUint32(40, len * 4, true);
    let o = 44;
    for (let i = 0; i < len; i++) {
      v.setInt16(o, Math.max(-1, Math.min(1, ch0[i])) * 0x7fff, true); o += 2;
      v.setInt16(o, Math.max(-1, Math.min(1, ch1[i])) * 0x7fff, true); o += 2;
    }
    return out;
  }

  function writeStr(v, o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }

  function bindCanvas(canvas, key) {
    canvas.addEventListener('click', () => setActiveTrack(key));
    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      state.cursorSec = xToSec((e.clientX - r.left) * (canvas.width / r.width), canvas);
      renderAll();
      if (state.dragging && state.dragging.track === key) {
        const t = state.tracks[key];
        const s = e.shiftKey ? state.cursorSec : quantize(state.cursorSec);
        t.markers[state.dragging.idx].sec = Math.max(0, s);
      }
    });
    canvas.addEventListener('dblclick', (e) => {
      const r = canvas.getBoundingClientRect();
      const sec = xToSec((e.clientX - r.left) * (canvas.width / r.width), canvas);
      makeMarker(state.tracks[key], sec);
    });
    canvas.addEventListener('mousedown', (e) => {
      const t = state.tracks[key]; if (t.locked) return;
      const r = canvas.getBoundingClientRect();
      const sec = xToSec((e.clientX - r.left) * (canvas.width / r.width), canvas);
      const mk = getHitMarker(t, sec);
      if (mk) {
        const idx = t.markers.indexOf(mk);
        if (e.altKey) {
          t.markers.push({ ...mk, id: Date.now() });
          state.dragging = { track: key, idx: t.markers.length - 1 };
        } else state.dragging = { track: key, idx };
      }
    });
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const t = state.tracks[key];
      const r = canvas.getBoundingClientRect();
      const sec = xToSec((e.clientX - r.left) * (canvas.width / r.width), canvas);
      const mk = getHitMarker(t, sec);
      if (!mk) return;
      const action = prompt('Ação do marker: set111 | warp | delete', 'delete');
      if (action === 'delete') t.markers = t.markers.filter(m => m !== mk);
      if (action === 'set111') mk.sec = 0;
      if (action === 'warp') t.stretch = Math.max(.5, Math.min(2, quantize(mk.sec) / Math.max(mk.sec, .001)));
      t.unsaved = true;
      pushHistory();
      renderAll();
    });
  }

  window.addEventListener('mouseup', () => {
    if (state.dragging) {
      state.tracks[state.dragging.track].unsaved = true;
      pushHistory();
    }
    state.dragging = null;
  });

  ui.minimapCanvas.addEventListener('mousedown', (e) => { state.minimapDrag = true; moveMinimap(e); });
  ui.minimapCanvas.addEventListener('mousemove', (e) => state.minimapDrag && moveMinimap(e));
  window.addEventListener('mouseup', () => state.minimapDrag = false);
  function moveMinimap(e) {
    const r = ui.minimapCanvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * (ui.minimapCanvas.width / r.width);
    state.scrollSec = Math.max(0, (x / ui.minimapCanvas.width) * maxDur() - visSec() / 2);
    renderAll();
  }

  ui.aFile.addEventListener('change', (e) => e.target.files[0] && loadTrack(e.target.files[0], 'A'));
  ui.bFile.addEventListener('change', (e) => e.target.files[0] && loadTrack(e.target.files[0], 'B'));
  ui.projectBpm.addEventListener('change', () => { state.projectBpm = Number(ui.projectBpm.value) || 120; updateTrackInfo(); pushHistory(); renderAll(); });
  ui.aBpm.addEventListener('change', () => { state.tracks.A.bpm = Number(ui.aBpm.value); updateTrackInfo(); pushHistory(); });
  ui.bBpm.addEventListener('change', () => { state.tracks.B.bpm = Number(ui.bBpm.value); updateTrackInfo(); pushHistory(); });
  ui.tapTempoBtn.addEventListener('click', () => {
    state.tap.push(performance.now());
    state.tap = state.tap.slice(-4);
    if (state.tap.length >= 2) {
      const iv = []; for (let i = 1; i < state.tap.length; i++) iv.push(state.tap[i] - state.tap[i - 1]);
      state.projectBpm = Number((60000 / (iv.reduce((a, b) => a + b, 0) / iv.length)).toFixed(2));
      syncUiFromState(); pushHistory(); renderAll();
    }
  });
  ui.halfBtn.addEventListener('click', () => { state.projectBpm = Number((state.projectBpm / 2).toFixed(2)); syncUiFromState(); pushHistory(); renderAll(); setToast('BPM ÷2'); });
  ui.doubleBtn.addEventListener('click', () => { state.projectBpm = Number((state.projectBpm * 2).toFixed(2)); syncUiFromState(); pushHistory(); renderAll(); setToast('BPM ×2'); });
  ui.autoSyncBtn.addEventListener('click', autoSync);
  ui.overlayBtn.addEventListener('click', () => { state.overlay = !state.overlay; syncUiFromState(); renderAll(); });
  ui.snapBtn.addEventListener('click', () => { state.snap = !state.snap; syncUiFromState(); renderAll(); });
  ui.syncScrollBtn.addEventListener('click', () => { state.syncScroll = !state.syncScroll; syncUiFromState(); });
  ui.zoomInBtn.addEventListener('click', () => { state.zoom = Math.min(64, state.zoom * 2); renderAll(); });
  ui.zoomOutBtn.addEventListener('click', () => { state.zoom = Math.max(1, state.zoom / 2); renderAll(); });
  ui.playBtn.addEventListener('click', async () => { await audioCtx.resume(); startPlayback(); });
  ui.stopBtn.addEventListener('click', stopPlayback);
  ui.undoBtn.addEventListener('click', () => { if (state.hIndex > 0) restoreHistory(--state.hIndex); });
  ui.redoBtn.addEventListener('click', () => { if (state.hIndex < state.history.length - 1) restoreHistory(++state.hIndex); });
  ui.offsetMs.addEventListener('change', () => { state.tracks.B.offsetSec = Number(ui.offsetMs.value) / 1000; state.tracks.B.unsaved = true; pushHistory(); renderAll(); });
  ui.offsetReset.addEventListener('click', () => { state.tracks.B.offsetSec = 0; state.tracks.B.unsaved = false; pushHistory(); renderAll(); });
  ui.snapNearestBtn.addEventListener('click', () => {
    const c = state.cursorSec;
    const nearest = state.tracks.B.transients.reduce((best, t) => Math.abs(t - c) < Math.abs(best - c) ? t : best, state.tracks.B.transients[0] || 0);
    state.tracks.B.offsetSec += (c - nearest);
    state.tracks.B.unsaved = true;
    pushHistory();
    renderAll();
  });

  [['A','Mute'],['B','Mute'],['A','Solo'],['B','Solo'],['A','Lock'],['B','Lock']].forEach(([k, n]) => {
    ui[`${k.toLowerCase()}${n}`].addEventListener('click', () => {
      const prop = n.toLowerCase();
      state.tracks[k][prop] = !state.tracks[k][prop];
      pushHistory();
      renderAll();
    });
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === '?') { ui.shortcuts.classList.toggle('open'); return; }
    if (e.key === 'Tab') {
      e.preventDefault();
      state.activeTrack = (state.activeTrack === 'A') ^ e.shiftKey ? 'B' : 'A';
      renderAll();
      return;
    }
    if (e.key.toLowerCase() === 's') { state.snap = !state.snap; syncUiFromState(); renderAll(); return; }
    if (e.key === 'ArrowLeft') { e.preventDefault(); nudgeActive(-1, e); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); nudgeActive(1, e); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); if (state.hIndex > 0) restoreHistory(--state.hIndex); }
    if ((e.ctrlKey || e.metaKey) && ((e.key.toLowerCase() === 'z' && e.shiftKey) || e.key.toLowerCase() === 'y')) {
      e.preventDefault(); if (state.hIndex < state.history.length - 1) restoreHistory(++state.hIndex);
    }
  });

  ui.exportOpenBtn.addEventListener('click', () => $('#exportModal').modal('show'));
  ui.exportBtn.addEventListener('click', exportWav);

  bindCanvas(ui.canvasA, 'A');
  bindCanvas(ui.canvasB, 'B');
  syncUiFromState();
  pushHistory();
  renderAll();
})();
