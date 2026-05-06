// Clap-to-wake detector using Web Audio API.
// Listens to the mic and emits 'clap:wake' on the shared voice bus when
// two transient peaks are detected within 1s.

import { bus } from './voice.js';

let audioCtx = null;
let analyser = null;
let micStream = null;
let rafId = null;
let enabled = false;

const PEAK_THRESHOLD = 0.55;
const REFRACTORY_MS = 120;
const DOUBLE_WINDOW_MS = 1000;

let lastPeakAt = 0;
let prevPeakAt = 0;

function processFrame() {
  if (!enabled || !analyser) return;
  rafId = requestAnimationFrame(processFrame);

  const buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf);

  let peak = 0;
  for (let i = 0; i < buf.length; i++) {
    const v = Math.abs(buf[i] - 128) / 128;
    if (v > peak) peak = v;
  }

  const now = performance.now();
  if (peak >= PEAK_THRESHOLD && now - lastPeakAt > REFRACTORY_MS) {
    prevPeakAt = lastPeakAt;
    lastPeakAt = now;
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
  const source = audioCtx.createMediaStreamSource(micStream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0;
  source.connect(analyser);
  enabled = true;
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
  prevPeakAt = 0;
  lastPeakAt = 0;
  bus.dispatchEvent(
    new CustomEvent('clap:state', { detail: { enabled: false } })
  );
}

export function isClapEnabled() {
  return enabled;
}
