// Voice interrupt: while TTS is speaking, keep STT listening so the user
// can talk over the AI. The first finalized phrase cancels the TTS and the
// transcript flows through to the chat handler in app.js.

import { bus, startSTT, cancelTTS, getMuted, sttSupported } from './voice.js';

let interruptArmed = false;

bus.addEventListener('voice:speaking', (e) => {
  const speaking = !!(e.detail && e.detail.speaking);
  if (speaking) {
    if (!getMuted() && sttSupported) {
      interruptArmed = true;
      startSTT();
    }
  } else {
    interruptArmed = false;
  }
});

bus.addEventListener('voice:transcript', (e) => {
  const detail = e.detail || {};
  if (!detail.final) return;
  if (interruptArmed) {
    interruptArmed = false;
    cancelTTS();
    bus.dispatchEvent(
      new CustomEvent('voice:interrupt', { detail: { text: detail.text } })
    );
  }
});
