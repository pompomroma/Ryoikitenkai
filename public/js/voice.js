// Browser Web Speech API wrapper: STT (SpeechRecognition) + TTS (speechSynthesis).
// Exposes a shared event bus so other modules (interrupt, app) can react.

export const bus = new EventTarget();

const SR =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

export const sttSupported = !!SR;
export const ttsSupported =
  typeof window.speechSynthesis !== 'undefined' &&
  typeof window.SpeechSynthesisUtterance !== 'undefined';

let recognition = null;
let listening = false;
let muted = false;
let wantListening = false;
let restartTimer = null;

function emit(name, detail) {
  bus.dispatchEvent(new CustomEvent(name, { detail }));
}

function buildRecognition() {
  if (!SR) return null;
  const r = new SR();
  r.continuous = true;
  r.interimResults = true;
  r.lang = navigator.language || 'en-US';

  let interim = '';

  r.onstart = () => {
    listening = true;
    emit('voice:listening', { listening: true });
  };
  r.onend = () => {
    listening = false;
    emit('voice:listening', { listening: false });
    if (wantListening && !muted) {
      clearTimeout(restartTimer);
      restartTimer = setTimeout(() => {
        try {
          r.start();
        } catch (_) {}
      }, 250);
    }
  };
  r.onerror = (e) => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      wantListening = false;
      emit('voice:error', { message: 'Microphone permission denied.' });
    } else if (e.error === 'no-speech' || e.error === 'aborted') {
      // benign
    } else {
      emit('voice:error', { message: `Speech error: ${e.error}` });
    }
  };
  r.onresult = (event) => {
    interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const text = res[0] && res[0].transcript ? res[0].transcript : '';
      if (res.isFinal) {
        const finalText = text.trim();
        if (finalText) emit('voice:transcript', { text: finalText, final: true });
      } else {
        interim += text;
      }
    }
    if (interim) emit('voice:transcript', { text: interim.trim(), final: false });
  };
  return r;
}

export function startSTT() {
  if (!sttSupported || muted) return false;
  if (!recognition) recognition = buildRecognition();
  if (!recognition) return false;
  wantListening = true;
  if (!listening) {
    try {
      recognition.start();
    } catch (_) {
      // already starting
    }
  }
  return true;
}

export function stopSTT() {
  wantListening = false;
  if (recognition && listening) {
    try {
      recognition.stop();
    } catch (_) {}
  }
}

export function isListening() {
  return listening;
}

export function setMuted(v) {
  muted = !!v;
  if (muted) stopSTT();
  emit('voice:muted', { muted });
}

export function getMuted() {
  return muted;
}

let currentUtterance = null;
let speaking = false;

export function speakTTS(text) {
  if (!ttsSupported || !text) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  const u = new SpeechSynthesisUtterance(trimmed);
  u.rate = 1.05;
  u.pitch = 1.0;
  currentUtterance = u;
  u.onstart = () => {
    speaking = true;
    emit('voice:speaking', { speaking: true });
  };
  u.onend = () => {
    speaking = false;
    if (currentUtterance === u) currentUtterance = null;
    emit('voice:speaking', { speaking: false });
  };
  u.onerror = () => {
    speaking = false;
    if (currentUtterance === u) currentUtterance = null;
    emit('voice:speaking', { speaking: false });
  };
  window.speechSynthesis.speak(u);
}

export function cancelTTS() {
  if (!ttsSupported) return;
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    window.speechSynthesis.cancel();
  }
  speaking = false;
  currentUtterance = null;
  emit('voice:speaking', { speaking: false });
}

export function isSpeaking() {
  return speaking || (ttsSupported && window.speechSynthesis.speaking);
}

// Sentence-level TTS queue: callers feed prose deltas; we speak whole
// sentences as they become available so the AI sounds natural.
let proseBuffer = '';
let ttsEnabled = true;

export function setTTSEnabled(v) {
  ttsEnabled = !!v;
  if (!ttsEnabled) cancelTTS();
}

export function getTTSEnabled() {
  return ttsEnabled;
}

const SENTENCE_RE = /([\.\?\!。？！]+[\s"'\)\]]*)/;

export function feedTTSDelta(delta) {
  if (!ttsEnabled || !ttsSupported || !delta) return;
  proseBuffer += delta;
  while (true) {
    const m = SENTENCE_RE.exec(proseBuffer);
    if (!m) break;
    const idx = m.index + m[0].length;
    const sentence = proseBuffer.slice(0, idx).trim();
    proseBuffer = proseBuffer.slice(idx);
    if (sentence) speakTTS(sentence);
  }
}

export function flushTTS() {
  if (!ttsEnabled || !ttsSupported) return;
  const tail = proseBuffer.trim();
  proseBuffer = '';
  if (tail) speakTTS(tail);
}

export function resetTTSBuffer() {
  proseBuffer = '';
}
