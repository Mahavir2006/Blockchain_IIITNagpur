/**
 * Thin wrappers over the browser's Web Speech API (recognition) and speechSynthesis (replies).
 * Recognition exists in Chrome and Edge; elsewhere `recognitionSupported` is false and the UI
 * offers typed commands instead.
 */

interface RecognitionAlternative { transcript: string; confidence: number }
interface RecognitionResult { isFinal: boolean; length: number; [i: number]: RecognitionAlternative }
interface RecognitionEvent { resultIndex: number; results: { length: number; [i: number]: RecognitionResult } }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

// Looked up at call time (not import time) so a polyfill or test double installed later is used.
const getCtor = (): RecognitionCtor | undefined =>
  typeof window === "undefined" ? undefined : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);

export const recognitionSupported = Boolean(getCtor());
export const synthesisSupported = typeof window !== "undefined" && "speechSynthesis" in window;

export interface ListenHandlers {
  /** Live partial transcript while the user is speaking. */
  onInterim: (text: string) => void;
  /** Final result: every alternative the recogniser offered, best first. */
  onFinal: (alternatives: string[]) => void;
  onError: (code: string) => void;
  onEnd: () => void;
}

/** Starts one push-to-talk recognition session; returns a function that stops it. */
export function listen(lang: string, h: ListenHandlers): () => void {
  const Ctor = getCtor();
  if (!Ctor) {
    h.onError("unsupported");
    h.onEnd();
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 3;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const alts = Array.from({ length: r.length }, (_, k) => r[k].transcript.trim()).filter(Boolean);
      if (r.isFinal) h.onFinal(alts);
      else if (alts[0]) h.onInterim(alts[0]);
    }
  };
  rec.onerror = (e) => h.onError(e.error);
  rec.onend = () => h.onEnd();
  try {
    rec.start();
  } catch {
    h.onError("start-failed");
    h.onEnd();
  }
  return () => rec.stop();
}

/** Best installed voice for a BCP 47 tag; Marathi falls back to a Hindi voice (same script). */
function pickVoice(tag: string) {
  const voices = window.speechSynthesis.getVoices();
  const norm = (l: string) => l.replace("_", "-").toLowerCase();
  const base = tag.split("-")[0].toLowerCase();
  return (
    voices.find((v) => norm(v.lang) === tag.toLowerCase()) ??
    voices.find((v) => norm(v.lang).startsWith(base)) ??
    (base === "mr" ? voices.find((v) => norm(v.lang).startsWith("hi")) : undefined)
  );
}

/**
 * Speaks `text` with a voice for `tag`. Returns false (and stays silent) when the device has voices
 * but none for this language: an English voice reading Devanagari is silence or noise.
 */
export function speak(text: string, tag: string): boolean {
  if (!synthesisSupported || !text) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const voice = pickVoice(tag);
  if (!voice && synth.getVoices().length > 0) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = tag;
  if (voice) u.voice = voice;
  u.rate = 1;
  synth.speak(u);
  return true;
}

export function stopSpeaking() {
  if (synthesisSupported) window.speechSynthesis.cancel();
}
