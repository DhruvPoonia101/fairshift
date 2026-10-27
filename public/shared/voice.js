import { icon } from './icons.js';
import { currentLocale, t } from './i18n.js';

/** Voice helpers. Both are feature-detected; nothing breaks when the browser lacks them. */

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canSpeak = 'speechSynthesis' in window;
export const canDictate = Boolean(Recognition);

export function speak(text) {
  if (!canSpeak) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = currentLocale();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (canSpeak) window.speechSynthesis.cancel();
}

/**
 * A mic button that types what the user says into `textarea`. Audio is handled entirely by the
 * browser's speech engine; FairShift only ever receives the resulting text.
 * @param {HTMLTextAreaElement} textarea
 * @returns {HTMLElement | null} null when dictation is unsupported (the user just types)
 */
export function dictationButton(textarea) {
  if (!canDictate) return null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.setAttribute('aria-pressed', 'false');
  const label = document.createElement('span');
  button.append(icon('mic'), label);
  let recognition = null;

  const setListening = (listening) => {
    button.setAttribute('aria-pressed', String(listening));
    label.textContent = t(listening ? 'voice.stop' : 'voice.start');
  };
  label.textContent = t('voice.start');

  button.addEventListener('click', () => {
    if (recognition) {
      recognition.stop();
      return;
    }
    recognition = new Recognition();
    recognition.lang = currentLocale();
    recognition.interimResults = false;
    recognition.onresult = (event) => {
      const heard = event.results[0][0].transcript;
      textarea.value = `${textarea.value} ${heard}`.trim();
    };
    recognition.onend = () => {
      recognition = null;
      setListening(false);
    };
    recognition.onerror = recognition.onend;
    setListening(true);
    recognition.start();
  });
  document.addEventListener('langchange', () => setListening(recognition !== null));
  return button;
}
