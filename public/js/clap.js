// Clap-to-wake detector using Web Audio API.
// Listens to the mic and emits 'clap:wake' on the shared voice bus when
// two transient peaks are detected within 1.5s.

import { bus } from './voice.js';

let audioCtx = null;
let analyser = null;
let silentSink = null;
let micStream = null;
let rafId = null;
let enabled = false;

const PEAK_THRESHOLD = 0.22;
const REFRACTORY_MS = 120;
const DOUBLE_WINDOW_MS = 1500;

let lastPeakAt = 0;
let prevPeakAt = 0;
let timeBuf = null;

function processFrame() {
  if (!enabled || !analyser) return;
  rafId = requestAnimationFrame(processFrame);

  if (!timeBuf || timeBuf.length !== analyser.fftSize) {
    timeBuf = new Uint8Array(analyser.fftSize);
  }
  analyser.getByteTimeDomainData(timeBuf);

  let peak = 0;
  for (let i = 0; i < timeBuf.length; i++) {
    const v = Math.abs(timeBuf[i] - 128) / 128;
    if (v > peak) peak = v;
  }

  const now = performance.now();
  if (peak >= PEAK_THRESHOLD && now - lastPeakAt > REFRACTORY_MS) {
    prevPeakAt = lastPeakAt;
    lastPeakAt = now;
    console.log(
      `[clap] peak=${peak.toFixed(3)} gap=${prevPeakAt ? Math.round(now - prevPeakAt) : '-'}ms`
    );
    bus.dispatchEvent(
      new CustomEvent('clap:peak', { detail: { peak, t: now } })
    );
    if (
      prevPeakAt > 0 &&
      lastPeakAt - prevPeakAt < DOUBLE_WINDOW_MS &&
      lastPeakAt - prevPeakAt > REFRACTORY_MS
    ) {
      prevPeakAt = 0;
      lastPeakAt = 0;
      console.log('[clap] wake!');
      bus.dispatchEvent(new CustomEvent('clap:wake', { detail: {} }));
    }
  }
}

export async function enableClap() {
  if (enabled) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
  } catch (e) {
    bus.dispatchEvent(
      new CustomEvent('voice:error', {
        detail: { message: 'Microphone access denied for clap detection.' },
      })
    );
    return false;
  }
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') {
    try {
      await audioCtx.resume();
    } catch (_) {}
  }
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  // Some browsers won't pull samples through an AnalyserNode unless the
  // graph terminates at the destination. Route through a muted gain so the
  // analyser stays "live" without playing the mic back into the speakers.
  silentSink = audioCtx.createGain();
  silentSink.gain.value = 0;
  analyser.connect(silentSink);
  silentSink.connect(audioCtx.destination);
  enabled = true;
  prevPeakAt = 0;
  lastPeakAt = 0;
  console.log(
    `[clap] enabled (sampleRate=${audioCtx.sampleRate}, state=${audioCtx.state}, threshold=${PEAK_THRESHOLD})`
  );
  bus.dispatchEvent(new CustomEvent('clap:state', { detail: { enabled: true } }));
  processFrame();
  return true;
}

export function disableClap() {
  enabled = false;
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (micStream) {
    micStream.getTracks().forEach((t) => t.stop());
    micStream = null;
  }
  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }
  analyser = null;
  silentSink = null;
  prevPeakAt = 0;
  lastPeakAt = 0;
  bus.dispatchEvent(
    new CustomEvent('clap:state', { detail: { enabled: false } })
  );
}

export function isClapEnabled() {
  return enabled;
}
