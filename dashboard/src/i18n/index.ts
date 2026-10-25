import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import hi from "./locales/hi.json";
import mr from "./locales/mr.json";

export const LANGUAGES = [
  { code: "en", label: "English", speech: "en-IN" },
  { code: "hi", label: "हिन्दी", speech: "hi-IN" },
  { code: "mr", label: "मराठी", speech: "mr-IN" },
] as const;

export type LanguageCode = (typeof LANGUAGES)[number]["code"];

export const resources = { en: { translation: en }, hi: { translation: hi }, mr: { translation: mr } };

/** BCP 47 tag for Intl formatting and speech for a UI language. */
export const speechLang = (code: string) => LANGUAGES.find((l) => l.code === code)?.speech ?? "en-IN";

export const currentLanguage = (): LanguageCode => {
  const code = (i18n.resolvedLanguage || i18n.language || "en").split("-")[0];
  return (LANGUAGES.some((l) => l.code === code) ? code : "en") as LanguageCode;
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    supportedLngs: LANGUAGES.map((l) => l.code),
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false }, // React already escapes
    detection: { order: ["localStorage", "navigator"], lookupLocalStorage: "bhl-lang", caches: ["localStorage"] },
    returnNull: false,
  });

const syncHtmlLang = () => {
  if (typeof document !== "undefined") document.documentElement.lang = currentLanguage();
};
syncHtmlLang();
i18n.on("languageChanged", syncHtmlLang);

export default i18n;
