import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { currentLanguage, speechLang } from "../i18n";
import { fmt, useLedger } from "../lib/store";
import { parseCommand, type Intent, type Page } from "./commands";
import { listen, recognitionSupported, speak, stopSpeaking, synthesisSupported } from "./speech";
import { summarize } from "./summary";

const PAGE_LABEL: Record<Page, string> = {
  "/": "nav.campaigns",
  "/trace": "nav.trace",
  "/evidence": "nav.evidence",
  "/alerts": "nav.alerts",
  "/transactions": "nav.transactions",
  "/verify-delivery": "nav.delivery",
};

const read = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
};
const write = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* storage unavailable: the setting just isn't remembered */
  }
};

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={`h-5 w-5 ${active ? "animate-pulse" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/** Floating voice control: push-to-talk, typed commands, transcript, spoken replies. */
export default function VoiceControl() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const loc = useLocation();
  const { data, setRole } = useLedger();
  const [open, setOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [noVoice, setNoVoice] = useState(false);
  const [typed, setTyped] = useState("");
  const [speakReplies, setSpeakReplies] = useState(() => read("bhl-voice-speak", true));
  const [privacySeen, setPrivacySeen] = useState(() => read("bhl-voice-privacy-seen", false));
  const stopRef = useRef<() => void>(() => {});
  const inputRef = useRef<HTMLInputElement>(null);

  const respond = useCallback(
    (text: string, lng = currentLanguage()) => {
      setReply(text);
      setNoVoice(speakReplies && !speak(text, speechLang(lng)));
    },
    [speakReplies],
  );

  const currentCampaignId = Number(loc.pathname.match(/^\/campaigns\/(\d+)/)?.[1]) || undefined;

  const run = useCallback(
    (intent: Intent) => {
      switch (intent.type) {
        case "navigate":
          navigate(intent.page);
          return respond(t("voice.done.navigate", { page: t(PAGE_LABEL[intent.page]) }));
        case "openCampaign": {
          const c = data.campaigns.find((x) => x.id === intent.id);
          if (!c) return respond(t("voice.done.noCampaign"));
          navigate(`/campaigns/${c.id}`);
          return respond(t("voice.done.campaign", { name: c.name }));
        }
        case "noCampaign":
          return respond(t("voice.done.noCampaign"));
        case "role":
          setRole(intent.role);
          return respond(t("voice.done.role", { role: t(`roles.${intent.role}.label`) }));
        case "language":
          i18n.changeLanguage(intent.lng).then(() => respond(i18n.t("voice.done.language"), intent.lng));
          return;
        case "filterAlerts":
          navigate(intent.severity === "all" ? "/alerts" : `/alerts?severity=${intent.severity}`);
          return respond(t("voice.done.alerts", { severity: intent.severity === "all" ? t("common.all") : t(`severity.${intent.severity}`) }));
        case "filterEvidence":
          navigate(intent.state === "all" ? "/evidence" : `/evidence?status=${intent.state}`);
          return respond(t("voice.done.evidence", { state: t(`evidenceFilter.${intent.state}`) }));
        case "donate":
          if (!intent.campaignId || !data.campaigns.some((c) => c.id === intent.campaignId)) {
            return respond(t("voice.done.donateWhich", { amount: fmt(intent.amount) }));
          }
          // Prefill only: the donor still reviews the amount and presses Donate.
          setRole("donor");
          navigate(`/campaigns/${intent.campaignId}?donate=${intent.amount}`);
          return respond(t("voice.done.donate", { amount: fmt(intent.amount) }));
        case "read":
          return respond(summarize(loc.pathname, data, t, fmt));
        case "help":
          return respond(t("voice.help"));
        case "back":
          navigate(-1);
          return respond(t("voice.done.back"));
        case "scroll":
          window.scrollBy({ top: (intent.dir === "down" ? 1 : -1) * window.innerHeight * 0.8, behavior: "smooth" });
          return respond(t(intent.dir === "down" ? "voice.done.scrollDown" : "voice.done.scrollUp"));
        case "stop":
          stopSpeaking();
          stopRef.current();
          return setReply(t("voice.done.stopped"));
      }
    },
    [data, i18n, loc.pathname, navigate, respond, setRole, t],
  );

  /** Tries each recogniser alternative until one parses; reports what was heard either way. */
  const handle = useCallback(
    (alternatives: string[]) => {
      setHeard(alternatives[0] ?? "");
      const ctx = { campaigns: data.campaigns.map((c) => ({ id: c.id, name: c.name })), currentCampaignId };
      for (const alt of alternatives) {
        const intent = parseCommand(alt, currentLanguage(), ctx);
        if (intent) return run(intent);
      }
      respond(t("voice.notUnderstood"));
    },
    [currentCampaignId, data.campaigns, respond, run, t],
  );

  const errorText = (code: string) =>
    code === "not-allowed" || code === "service-not-allowed"
      ? t("voice.errorPermission")
      : code === "no-speech"
        ? t("voice.errorNoSpeech")
        : code === "network"
          ? t("voice.errorNetwork")
          : code === "aborted"
            ? ""
            : t("voice.errorGeneric", { code });

  const start = useCallback(() => {
    setOpen(true);
    if (!privacySeen) {
      setPrivacySeen(true);
      write("bhl-voice-privacy-seen", true);
    }
    if (!recognitionSupported) {
      inputRef.current?.focus();
      return;
    }
    stopSpeaking();
    setHeard("");
    setReply("");
    setListening(true);
    stopRef.current = listen(speechLang(currentLanguage()), {
      onInterim: setHeard,
      onFinal: handle,
      onError: (code) => {
        const msg = errorText(code);
        if (msg) setReply(msg);
      },
      onEnd: () => setListening(false),
    });
    // errorText only depends on t, which `handle` already tracks.
  }, [handle, privacySeen]);

  const stop = () => {
    stopRef.current();
    setListening(false);
  };

  // Ctrl+Space toggles listening (or focuses the command box where speech is unavailable).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === "Space") {
        e.preventDefault();
        if (listening) stop();
        else start();
      }
      if (e.key === "Escape" && open) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => () => stopRef.current(), []);

  const onTyped = (e: FormEvent) => {
    e.preventDefault();
    if (!typed.trim()) return;
    handle([typed.trim()]);
    setTyped("");
  };

  const toggleSpeak = () => {
    const next = !speakReplies;
    setSpeakReplies(next);
    write("bhl-voice-speak", next);
    if (!next) stopSpeaking();
  };

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 md:bottom-6 md:right-6">
      {open && (
        <section aria-label={t("voice.panelTitle")} className="w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-cloud-300 bg-cloud-50 p-4 text-sm shadow-lg">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-serif text-lg">{t("voice.panelTitle")}</h2>
            <button onClick={() => setOpen(false)} className="rounded-full px-2 text-ink-50 hover:text-ink" aria-label={t("voice.close")}>✕</button>
          </div>

          {!recognitionSupported && <p className="mb-3 rounded-lg bg-pepper-100 px-3 py-2 text-xs text-pepper-600">{t("voice.unsupported")}</p>}
          {recognitionSupported && <p className="mb-3 text-xs text-ink-50">{t("voice.privacy")}</p>}

          {listening && <p className="mb-2 font-medium text-potion">{t("voice.listening")}</p>}
          <div aria-live="polite" className="space-y-2">
            {heard && (
              <p>
                <span className="text-ink-50">{t("voice.heard")}: </span>
                <q className="text-ink">{heard}</q>
              </p>
            )}
            {reply && (
              <p className="rounded-lg bg-cloud-200 px-3 py-2 text-ink-70" data-voice-reply>
                {reply}
              </p>
            )}
            {reply && noVoice && <p className="text-xs text-ink-50" data-no-voice>{t("voice.noVoice")}</p>}
          </div>

          <form onSubmit={onTyped} className="mt-3">
            <label className="block text-xs text-ink-70" htmlFor="voice-typed">{t("voice.typeLabel")}</label>
            <div className="mt-1 flex gap-2">
              <input
                id="voice-typed"
                ref={inputRef}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={t("voice.typePlaceholder")}
                className="w-full rounded-xl border border-cloud-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-50 focus:border-pepper focus:outline-none"
              />
              <button type="submit" className="rounded-full bg-ink px-3 text-xs font-medium text-cloud-50">{t("voice.run")}</button>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-50">
            {synthesisSupported && (
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={speakReplies} onChange={toggleSpeak} className="accent-potion" />
                {t("voice.speak")}
              </label>
            )}
            <span className="hidden md:inline">{t("voice.shortcut")}</span>
          </div>
        </section>
      )}

      {!open && (
        <button
          onClick={() => {
            setOpen(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          aria-label={t("voice.typeOpen")}
          title={t("voice.typeOpen")}
          className="grid h-10 w-10 place-items-center rounded-full border border-cloud-300 bg-cloud-50 text-ink-70 shadow hover:text-ink"
        >
          <svg aria-hidden viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <rect x="3" y="6" width="18" height="12" rx="2" />
            <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
          </svg>
        </button>
      )}
      <button
        onClick={() => (listening ? stop() : start())}
        aria-pressed={listening}
        aria-label={listening ? t("voice.stop") : recognitionSupported ? t("voice.listen") : t("voice.button")}
        title={t("voice.button")}
        className={`grid h-14 w-14 place-items-center rounded-full shadow-lg transition-colors ${listening ? "bg-pepper-600 text-white" : "bg-potion text-cloud-50 hover:bg-potion-600"}`}
      >
        <MicIcon active={listening} />
      </button>
    </div>
  );
}
