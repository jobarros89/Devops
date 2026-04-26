(() => {
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  const state = {
    projectBpm: 120,
    zoom: 1,
    snap: true,
    cursorTime: 0,
    tapTimes: [],
    selectedMarkerId: null,
    markers: [],
    transientsA: [],
    transientsB: [],
    history: [],
    historyIndex: -1,
    tracks: {
      A: { buffer: null, source: null, gain: audioCtx.createGain(), offsetSec: 0, stretch: 1, bpm: null },
      B: { buffer: null, source: null, gain: audioCtx.createGain(), offsetSec: 0, stretch: 1, bpm: null }
    }
  };

  state.tracks.A.gain.gain.value = 0.95;
  state.tracks.B.gain.gain.value = 0.95;
  state.tracks.A.gain.connect(audioCtx.destination);
  state.tracks.B.gain.connect(audioCtx.destination);

  const ui = {
    projectBpm: document.getElementById('projectBpm'),
    projectTempoMs: document.getElementById('projectTempoMs'),
    trackAFile: document.getElementById('trackAFile'),
    trackBFile: document.getElementById('trackBFile'),
    tapTempoBtn: document.getElementById('tapTempoBtn'),
    halfTimeBtn: document.getElementById('halfTimeBtn'),
    doubleTimeBtn: document.getElementById('doubleTimeBtn'),
    autoSyncBtn: document.getElementById('autoSyncBtn'),
    toggleSnapBtn: document.getElementById('toggleSnapBtn'),
    addMarkerBtn: document.getElementById('addMarkerBtn'),
    set111Btn: document.getElementById('set111Btn'),
    warpFromHereBtn: document.getElementById('warpFromHereBtn'),
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn'),
    nudgeMs: document.getElementById('nudgeMs'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    playBtn: document.getElementById('playBtn'),
    pauseBtn: document.getElementById('pauseBtn'),
    timelineCanvas: document.getElementById('timelineCanvas'),
    statusText: document.getElementById('statusText'),
    cursorTime: document.getElementById('cursorTime')
  };

  const canvas = ui.timelineCanvas;
  const ctx = canvas.getContext('2d');

  function pushHistory() {
    const snapshot = {
      markers: JSON.parse(JSON.stringify(state.markers)),
      tracks: {
        A: { offsetSec: state.tracks.A.offsetSec, stretch: state.tracks.A.stretch },
        B: { offsetSec: state.tracks.B.offsetSec, stretch: state.tracks.B.stretch }
      },
      projectBpm: state.projectBpm
    };
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);
    state.historyIndex = state.history.length - 1;
  }

  function restoreHistory(idx) {
    const snap = state.history[idx];
    if (!snap) return;
    state.markers = JSON.parse(JSON.stringify(snap.markers));
    state.projectBpm = snap.projectBpm;
    state.tracks.A.offsetSec = snap.tracks.A.offsetSec;
    state.tracks.A.stretch = snap.tracks.A.stretch;
    state.tracks.B.offsetSec = snap.tracks.B.offsetSec;
    state.tracks.B.stretch = snap.tracks.B.stretch;
    ui.projectBpm.value = state.projectBpm.toFixed(2);
    updateTempoLabel();
    render();
  }

  function updateTempoLabel() {
    ui.projectTempoMs.textContent = (60000 / state.projectBpm).toFixed(2);
  }

  async function loadTrack(file, key) {
    const arr = await file.arrayBuffer();
    const buffer = await audioCtx.decodeAudioData(arr.slice(0));
    state.tracks[key].buffer = buffer;
    state.tracks[key].bpm = detectBpm(buffer).bpm;
    const transients = detectTransients(buffer);
    if (key === 'A') state.transientsA = transients;
    if (key === 'B') state.transientsB = transients;
    ui.statusText.textContent = `Track ${key} carregada. BPM detectado: ${state.tracks[key].bpm.toFixed(2)}.`;
    pushHistory();
    render();
  }

  function detectBpm(buffer) {
    const channel = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const blockSize = 1024;
    const envelope = [];
    for (let i = 0; i < channel.length; i += blockSize) {
      let sum = 0;
      const end = Math.min(i + blockSize, channel.length);
      for (let j = i; j < end; j++) sum += Math.abs(channel[j]);
      envelope.push(sum / (end - i));
    }
    const peaks = [];
    for (let i = 2; i < envelope.length - 2; i++) {
      if (envelope[i] > envelope[i - 1] && envelope[i] > envelope[i + 1] && envelope[i] > 0.05) peaks.push(i);
    }
    const intervals = {};
    for (let i = 0; i < peaks.length - 1; i++) {
      const d = peaks[i + 1] - peaks[i];
      if (d <= 0) continue;
      const bpm = 60 / ((d * blockSize) / sampleRate);
      const normalized = normalizeBpm(bpm);
      const bin = normalized.toFixed(1);
      intervals[bin] = (intervals[bin] || 0) + 1;
    }
    const best = Object.entries(intervals).sort((a, b) => b[1] - a[1])[0];
    return { bpm: best ? Number(best[0]) : 120 };
  }

  function normalizeBpm(v) {
    let bpm = v;
    while (bpm < 70) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return bpm;
  }

  function detectTransients(buffer) {
    const data = buffer.getChannelData(0);
    const hop = 512;
    const frame = 2048;
    const transients = [];
    let prevEnergy = 0;
    for (let i = 0; i + frame < data.length; i += hop) {
      let energy = 0;
      for (let j = i; j < i + frame; j++) energy += data[j] * data[j];
      energy /= frame;
      const diff = energy - prevEnergy;
      if (diff > 0.002) transients.push(i / buffer.sampleRate);
      prevEnergy = energy;
    }
    return transients;
  }

  function secondsToX(sec) {
    const dur = Math.max(getMaxDuration(), 1);
    return ((sec * state.zoom) / dur) * canvas.width;
  }

  function xToSeconds(x) {
    const dur = Math.max(getMaxDuration(), 1);
    return (x / canvas.width) * dur / state.zoom;
  }

  function getMaxDuration() {
    const a = state.tracks.A.buffer ? state.tracks.A.buffer.duration : 0;
    const b = state.tracks.B.buffer ? state.tracks.B.buffer.duration : 0;
    return Math.max(a, b, 1);
  }

  function drawGrid() {
    const beatSec = 60 / state.projectBpm;
    const max = getMaxDuration() / state.zoom;
    ctx.strokeStyle = '#293142';
    ctx.lineWidth = 1;
    for (let t = 0, i = 0; t <= max; t += beatSec, i++) {
      const x = secondsToX(t);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
      if (i % 4 === 0) {
        ctx.fillStyle = '#64748b';
        const bar = Math.floor(i / 4) + 1;
        const beat = (i % 4) + 1;
        ctx.fillText(`${bar}.${beat}.1`, x + 4, 12);
      }
    }
  }

  function drawWave(buffer, color, offsetSec = 0) {
    if (!buffer) return;
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor((data.length / canvas.width) / state.zoom));
    const amp = canvas.height / 3;
    ctx.strokeStyle = color;
    ctx.beginPath();
    for (let i = 0; i < canvas.width; i++) {
      const idx = Math.floor((i / canvas.width) * data.length / state.zoom);
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) {
        const v = data[idx + j] || 0;
        min = Math.min(min, v);
        max = Math.max(max, v);
      }
      const x = i + secondsToX(offsetSec);
      ctx.moveTo(x, (1 + min) * amp);
      ctx.lineTo(x, (1 + max) * amp);
    }
    ctx.stroke();
  }

  function drawTransients(points, color, offsetSec = 0) {
    ctx.strokeStyle = color;
    points.forEach((t) => {
      const x = secondsToX(t + offsetSec);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
    });
  }

  function drawMarkers() {
    state.markers.forEach((m) => {
      const x = secondsToX(m.timeSec);
      ctx.strokeStyle = m.id === state.selectedMarkerId ? '#f59e0b' : '#f472b6';
      ctx.lineWidth = m.id === state.selectedMarkerId ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
      ctx.fillStyle = '#f9a8d4';
      ctx.fillText(`W${m.id}`, x + 3, canvas.height - 8);
    });
    ctx.lineWidth = 1;
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGrid();
    drawWave(state.tracks.A.buffer, 'rgba(99,179,255,.75)', state.tracks.A.offsetSec);
    drawWave(state.tracks.B.buffer, 'rgba(244,114,182,.65)', state.tracks.B.offsetSec);
    drawTransients(state.transientsA, 'rgba(59,130,246,.4)', state.tracks.A.offsetSec);
    drawTransients(state.transientsB, 'rgba(236,72,153,.35)', state.tracks.B.offsetSec);
    drawMarkers();
    const x = secondsToX(state.cursorTime);
    ctx.strokeStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
    ui.cursorTime.textContent = `${state.cursorTime.toFixed(3)}s | ${(state.cursorTime * 1000).toFixed(1)} ms`;
  }

  function addMarker(sec) {
    pushHistory();
    const id = Date.now();
    state.markers.push({ id, timeSec: sec, beatPos: null });
    state.selectedMarkerId = id;
    render();
  }

  function closestMarker(sec, toleranceSec = 0.02) {
    const hit = state.markers.find((m) => Math.abs(m.timeSec - sec) <= toleranceSec);
    return hit || null;
  }

  function quantizeToGrid(sec) {
    if (!state.snap) return sec;
    const beat = 60 / state.projectBpm;
    return Math.round(sec / beat) * beat;
  }

  function nudgeSelected(deltaMs) {
    const m = state.markers.find((mk) => mk.id === state.selectedMarkerId);
    if (!m) return;
    pushHistory();
    m.timeSec = Math.max(0, m.timeSec + deltaMs / 1000);
    render();
  }

  function set111Here() {
    pushHistory();
    state.markers.forEach((m) => {
      if (m.id === state.selectedMarkerId) m.beatPos = '1.1.1';
    });
    ui.statusText.textContent = 'Marcador definido como 1.1.1 (âncora do grid).';
    render();
  }

  function warpFromHere() {
    const marker = state.markers.find((m) => m.id === state.selectedMarkerId);
    if (!marker || !state.tracks.B.buffer) return;
    pushHistory();
    const targetSec = quantizeToGrid(marker.timeSec);
    const ratio = targetSec / Math.max(marker.timeSec, 0.001);
    state.tracks.B.stretch = Math.max(0.5, Math.min(2, ratio));
    ui.statusText.textContent = `Warp From Here aplicado. Stretch B: ${state.tracks.B.stretch.toFixed(4)}x`;
    render();
  }

  function autoSync() {
    if (!state.transientsA.length || !state.transientsB.length) return;
    pushHistory();
    const a = state.transientsA[0];
    const b = state.transientsB[0];
    state.tracks.B.offsetSec += (a - b);

    if (state.tracks.A.bpm && state.tracks.B.bpm) {
      state.tracks.B.stretch = state.tracks.A.bpm / state.tracks.B.bpm;
    }
    ui.statusText.textContent = `Sync automático concluído. Offset B: ${(state.tracks.B.offsetSec * 1000).toFixed(2)}ms, Stretch: ${state.tracks.B.stretch.toFixed(4)}x`;
    render();
  }

  function startPlayback() {
    ['A', 'B'].forEach((key) => {
      const track = state.tracks[key];
      if (!track.buffer) return;
      const src = audioCtx.createBufferSource();
      src.buffer = track.buffer;
      src.playbackRate.value = track.stretch;
      src.connect(track.gain);
      const when = Math.max(0, audioCtx.currentTime + (track.offsetSec > 0 ? track.offsetSec : 0));
      const startAt = Math.max(0, -track.offsetSec);
      src.start(when, startAt);
      track.source = src;
    });
  }

  function stopPlayback() {
    ['A', 'B'].forEach((key) => {
      const source = state.tracks[key].source;
      if (source) {
        try { source.stop(); } catch (_) {}
      }
      state.tracks[key].source = null;
    });
  }

  let draggingMarker = null;
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sec = xToSeconds(x);
    state.cursorTime = sec;
    const hit = closestMarker(sec, 0.03 / state.zoom);
    if (hit) {
      state.selectedMarkerId = hit.id;
      draggingMarker = hit.id;
    } else {
      state.selectedMarkerId = null;
    }
    render();
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const sec = xToSeconds(x);
    state.cursorTime = sec;
    if (draggingMarker) {
      const marker = state.markers.find((m) => m.id === draggingMarker);
      if (marker) marker.timeSec = Math.max(0, quantizeToGrid(sec));
    }
    render();
  });

  window.addEventListener('mouseup', () => {
    if (draggingMarker) pushHistory();
    draggingMarker = null;
  });

  ui.trackAFile.addEventListener('change', (e) => e.target.files[0] && loadTrack(e.target.files[0], 'A'));
  ui.trackBFile.addEventListener('change', (e) => e.target.files[0] && loadTrack(e.target.files[0], 'B'));
  ui.projectBpm.addEventListener('change', () => {
    const val = Number(ui.projectBpm.value);
    if (!Number.isFinite(val) || val <= 0) return;
    pushHistory();
    state.projectBpm = Number(val.toFixed(2));
    updateTempoLabel();
    render();
  });

  ui.tapTempoBtn.addEventListener('click', () => {
    const now = performance.now();
    state.tapTimes.push(now);
    state.tapTimes = state.tapTimes.slice(-8);
    if (state.tapTimes.length >= 2) {
      const intervals = [];
      for (let i = 1; i < state.tapTimes.length; i++) intervals.push(state.tapTimes[i] - state.tapTimes[i - 1]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      state.projectBpm = Number((60000 / avg).toFixed(2));
      ui.projectBpm.value = state.projectBpm.toFixed(2);
      updateTempoLabel();
      render();
    }
  });

  ui.halfTimeBtn.addEventListener('click', () => {
    state.projectBpm = Number((state.projectBpm / 2).toFixed(2));
    ui.projectBpm.value = state.projectBpm.toFixed(2);
    updateTempoLabel();
    render();
  });

  ui.doubleTimeBtn.addEventListener('click', () => {
    state.projectBpm = Number((state.projectBpm * 2).toFixed(2));
    ui.projectBpm.value = state.projectBpm.toFixed(2);
    updateTempoLabel();
    render();
  });

  ui.toggleSnapBtn.addEventListener('click', () => {
    state.snap = !state.snap;
    ui.toggleSnapBtn.textContent = `Snap: ${state.snap ? 'ON' : 'OFF'}`;
  });

  ui.addMarkerBtn.addEventListener('click', () => addMarker(state.cursorTime));
  ui.set111Btn.addEventListener('click', set111Here);
  ui.warpFromHereBtn.addEventListener('click', warpFromHere);
  ui.autoSyncBtn.addEventListener('click', autoSync);

  ui.undoBtn.addEventListener('click', () => {
    if (state.historyIndex <= 0) return;
    state.historyIndex -= 1;
    restoreHistory(state.historyIndex);
  });

  ui.redoBtn.addEventListener('click', () => {
    if (state.historyIndex >= state.history.length - 1) return;
    state.historyIndex += 1;
    restoreHistory(state.historyIndex);
  });

  ui.zoomInBtn.addEventListener('click', () => { state.zoom = Math.min(32, state.zoom * 2); render(); });
  ui.zoomOutBtn.addEventListener('click', () => { state.zoom = Math.max(1, state.zoom / 2); render(); });
  ui.playBtn.addEventListener('click', async () => {
    await audioCtx.resume();
    startPlayback();
  });
  ui.pauseBtn.addEventListener('click', stopPlayback);

  window.addEventListener('keydown', (e) => {
    if (!state.selectedMarkerId) return;
    const baseNudge = Number(ui.nudgeMs.value) || 1;
    const sampleMs = state.tracks.A.buffer ? (1000 / state.tracks.A.buffer.sampleRate) : 0.02;
    if (e.key === 'ArrowLeft') nudgeSelected(-(e.shiftKey ? sampleMs : baseNudge));
    if (e.key === 'ArrowRight') nudgeSelected(e.shiftKey ? sampleMs : baseNudge);
    if (e.key.toLowerCase() === 's') {
      state.snap = !state.snap;
      ui.toggleSnapBtn.textContent = `Snap: ${state.snap ? 'ON' : 'OFF'}`;
    }
  });

  updateTempoLabel();
  pushHistory();
  render();
})();
