/**
 * Voice/typed command parser. Pure: text in, intent out, so it is unit-tested in every language.
 *
 * Matching is keyword-based and forgiving: punctuation and filler words are ignored, English
 * keywords are always accepted alongside the UI language (people mix "alert", "campaign" etc.
 * into Hindi and Marathi), and numbers may be spoken as digits (Latin or Devanagari) or words.
 */
import type { EvidenceState, Role, Severity } from "../lib/types";
import type { LanguageCode } from "../i18n";

export type Page = "/" | "/trace" | "/evidence" | "/alerts" | "/transactions" | "/verify-delivery";

export type Intent =
  | { type: "navigate"; page: Page }
  | { type: "openCampaign"; id: number }
  | { type: "noCampaign" }
  | { type: "role"; role: Role }
  | { type: "language"; lng: LanguageCode }
  | { type: "filterAlerts"; severity: Severity | "all" }
  | { type: "filterEvidence"; state: EvidenceState | "all" }
  | { type: "donate"; amount: number; campaignId?: number }
  | { type: "read" }
  | { type: "help" }
  | { type: "back" }
  | { type: "scroll"; dir: "up" | "down" }
  | { type: "stop" };

export interface CommandContext {
  campaigns: { id: number; name: string }[];
  /** Campaign shown on screen, used when a command names no campaign ("donate 10"). */
  currentCampaignId?: number;
}

type Lexicon = {
  pages: Record<Page, string[]>;
  campaign: string[];
  roles: Record<Role, string[]>;
  languages: Record<LanguageCode, string[]>;
  severity: Record<Severity, string[]>;
  evidenceState: Record<EvidenceState, string[]>;
  all: string[];
  donate: string[];
  read: string[];
  help: string[];
  back: string[];
  scrollDown: string[];
  scrollUp: string[];
  stop: string[];
  numbers: Record<string, number>;
};

const en: Lexicon = {
  pages: {
    "/": ["campaigns", "campaign list", "home", "overview", "dashboard", "main page"],
    "/trace": ["follow a donation", "follow donation", "track donation", "trace", "donation trace", "follow my money"],
    "/evidence": ["evidence", "receipts", "receipt", "proofs"],
    "/alerts": ["alerts", "alert", "warnings", "fraud"],
    "/transactions": ["transactions", "transaction", "history", "ledger"],
    "/verify-delivery": ["check a delivery", "check delivery", "delivery", "verify delivery", "proof checker", "merkle"],
  },
  campaign: ["campaign", "campaigns"],
  roles: {
    donor: ["donor"],
    ngo: ["ngo", "n g o", "admin", "ngo admin"],
    vendor: ["vendor", "supplier"],
    verifier: ["verifier", "auditor"],
  },
  languages: { en: ["english"], hi: ["hindi"], mr: ["marathi"] },
  severity: { critical: ["critical"], high: ["high"], medium: ["medium"], low: ["low"] },
  evidenceState: { pending: ["pending", "awaiting", "waiting"], attested: ["verified", "attested", "approved"], challenged: ["challenged"], rejected: ["rejected", "forged"] },
  all: ["all", "every", "everything"],
  donate: ["donate", "donation of", "give", "contribute"],
  read: ["read", "summary", "summarise", "summarize", "what is on", "what's on", "tell me about"],
  help: ["help", "what can i say", "commands", "options"],
  back: ["go back", "back", "previous page"],
  scrollDown: ["scroll down", "down", "next"],
  scrollUp: ["scroll up", "up", "top"],
  stop: ["stop", "cancel", "quiet", "shut up", "be quiet"],
  numbers: { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, twentyfive: 25, thirty: 30, forty: 40, fifty: 50, hundred: 100, first: 1, second: 2, third: 3 },
};

const hi: Lexicon = {
  pages: {
    "/": ["अभियान", "अभियानों", "कैंपेन", "होम", "मुख्य पेज", "मुख्य पृष्ठ", "डैशबोर्ड"],
    "/trace": ["दान को ट्रैक", "दान ट्रैक", "ट्रैक", "ट्रेस", "दान का पता", "पैसा कहाँ गया"],
    "/evidence": ["सबूत", "रसीद", "रसीदें", "रसीदों", "प्रमाण", "एविडेंस"],
    "/alerts": ["अलर्ट", "अलर्ट्स", "चेतावनी", "चेतावनियाँ", "धोखाधड़ी"],
    "/transactions": ["लेनदेन", "लेन देन", "ट्रांजैक्शन", "इतिहास", "लेजर"],
    "/verify-delivery": ["डिलीवरी", "वितरण", "डिलीवरी जाँच", "डिलीवरी जांच"],
  },
  campaign: ["अभियान", "कैंपेन"],
  roles: {
    donor: ["दानदाता", "दाता", "डोनर"],
    ngo: ["एनजीओ", "संस्था", "एडमिन"],
    vendor: ["विक्रेता", "वेंडर", "सप्लायर"],
    verifier: ["सत्यापनकर्ता", "वेरिफायर", "सत्यापक", "जाँचकर्ता", "जांचकर्ता"],
  },
  languages: { en: ["अंग्रेज़ी", "अंग्रेजी", "इंग्लिश"], hi: ["हिंदी", "हिन्दी"], mr: ["मराठी"] },
  severity: { critical: ["गंभीर"], high: ["उच्च", "हाई"], medium: ["मध्यम"], low: ["कम", "निम्न"] },
  evidenceState: { pending: ["लंबित", "बाकी", "बाक़ी", "प्रतीक्षा"], attested: ["सत्यापित", "प्रमाणित", "स्वीकृत"], challenged: ["चुनौती"], rejected: ["अस्वीकृत", "खारिज", "ख़ारिज", "जाली"] },
  all: ["सभी", "सब", "सारे", "सारी"],
  donate: ["दान करो", "दान करें", "दान करना", "दान दो", "दान दें"],
  read: ["पढ़ो", "पढ़ें", "पढ़कर", "सुनाओ", "सारांश", "बताओ", "बताइए"],
  help: ["मदद", "सहायता", "क्या बोल सकता", "क्या बोल सकती", "क्या कह सकता"],
  back: ["पीछे जाओ", "पीछे", "वापस जाओ", "वापस"],
  scrollDown: ["नीचे", "नीचे स्क्रॉल"],
  scrollUp: ["ऊपर", "ऊपर स्क्रॉल"],
  stop: ["रुको", "बंद करो", "चुप", "रोको"],
  numbers: { एक: 1, दो: 2, तीन: 3, चार: 4, पांच: 5, पाँच: 5, छह: 6, छः: 6, सात: 7, आठ: 8, नौ: 9, दस: 10, ग्यारह: 11, बारह: 12, पंद्रह: 15, बीस: 20, पच्चीस: 25, तीस: 30, चालीस: 40, पचास: 50, सौ: 100, पहला: 1, पहले: 1, दूसरा: 2, दूसरे: 2, तीसरा: 3, तीसरे: 3 },
};

const mr: Lexicon = {
  pages: {
    "/": ["मोहीम", "मोहिमा", "मोहिमांची", "कॅम्पेन", "मुख्यपृष्ठ", "मुख्य पान", "होम", "डॅशबोर्ड"],
    "/trace": ["मागोवा", "देणगीचा मागोवा", "ट्रॅक", "ट्रेस", "पैसे कुठे गेले"],
    "/evidence": ["पुरावा", "पुरावे", "पावती", "पावत्या", "एव्हिडन्स"],
    "/alerts": ["इशारा", "इशारे", "अलर्ट", "सूचना", "फसवणूक"],
    "/transactions": ["व्यवहार", "ट्रान्झॅक्शन", "इतिहास", "लेजर"],
    "/verify-delivery": ["वितरण", "डिलिव्हरी", "वितरण तपासा"],
  },
  campaign: ["मोहीम", "मोहिमा", "कॅम्पेन"],
  roles: {
    donor: ["देणगीदार", "दाता", "डोनर"],
    ngo: ["संस्था", "एनजीओ", "प्रशासक"],
    vendor: ["विक्रेता", "व्हेंडर", "पुरवठादार"],
    verifier: ["पडताळणीकर्ता", "पडताळणीकर्त्या", "व्हेरिफायर", "तपासनीस"],
  },
  languages: { en: ["इंग्रजी", "इंग्रजीत", "इंग्लिश"], hi: ["हिंदी", "हिन्दी", "हिंदीत"], mr: ["मराठी", "मराठीत"] },
  severity: { critical: ["गंभीर"], high: ["उच्च"], medium: ["मध्यम"], low: ["कमी"] },
  evidenceState: { pending: ["प्रलंबित", "बाकी", "प्रतीक्षा"], attested: ["पडताळलेल्या", "पडताळलेली", "पडताळलेले", "प्रमाणित", "मंजूर"], challenged: ["आव्हान"], rejected: ["नाकारलेल्या", "नाकारलेली", "नाकारलेले", "बनावट"] },
  all: ["सर्व", "सगळे", "सगळ्या", "सगळी"],
  donate: ["देणगी द्या", "देणगी दे", "दान करा", "दान द्या"],
  read: ["वाचा", "वाचून दाखवा", "सारांश", "सांगा"],
  help: ["मदत", "काय बोलू", "काय म्हणू"],
  back: ["मागे जा", "मागे", "परत जा"],
  scrollDown: ["खाली", "खाली स्क्रोल"],
  scrollUp: ["वर स्क्रोल", "वर जा"],
  stop: ["थांबा", "थांब", "बंद करा", "गप्प"],
  numbers: { एक: 1, दोन: 2, तीन: 3, चार: 4, पाच: 5, सहा: 6, सात: 7, आठ: 8, नऊ: 9, दहा: 10, अकरा: 11, बारा: 12, पंधरा: 15, वीस: 20, पंचवीस: 25, तीस: 30, चाळीस: 40, पन्नास: 50, शंभर: 100, पहिली: 1, पहिला: 1, दुसरी: 2, दुसरा: 2, तिसरी: 3, तिसरा: 3 },
};

export const LEXICONS: Record<LanguageCode, Lexicon> = { en, hi, mr };

const DEVANAGARI_DIGITS = "०१२३४५६७८९";

/** Lower-case, Devanagari digits → Latin, punctuation → spaces, padded for whole-word matching. */
export function normalize(text: string) {
  const digits = text.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));
  const clean = digits
    .toLowerCase()
    .replace(/\.(?!\d)|(?<!\d)\./g, " ") // keep decimal points ("12.5"), drop sentence dots
    .replace(/[“”"'‘’`,!?।॥:;()\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ` ${clean} `;
}

const has = (text: string, phrase: string) => text.includes(` ${phrase.toLowerCase()} `);
const hasAny = (text: string, phrases: string[]) => phrases.some((p) => has(text, p));

/** Merge the UI language's lexicon with English. */
function lexiconFor(lng: LanguageCode) {
  const own = LEXICONS[lng];
  if (lng === "en") return [en];
  return [own, en];
}

/** All numbers in the text, from digits and number words, in spoken order. */
export function extractNumbers(text: string, lexicons: Lexicon[]) {
  const words = text.trim().split(" ");
  const out: number[] = [];
  for (const w of words) {
    if (/^\d+(\.\d+)?$/.test(w)) {
      out.push(Number(w));
      continue;
    }
    for (const lex of lexicons) {
      if (w in lex.numbers) {
        out.push(lex.numbers[w]);
        break;
      }
    }
  }
  return out;
}

/** Campaign named in the text: by number next to the word "campaign", or by distinctive name words. */
function findCampaign(text: string, lexicons: Lexicon[], ctx: CommandContext, numbers: number[]) {
  const campaignWord = lexicons.some((l) => hasAny(text, l.campaign));
  if (campaignWord && numbers.length) {
    const byNumber = ctx.campaigns.find((c) => numbers.includes(c.id));
    if (byNumber) return { found: byNumber.id };
  }
  // Name match: any significant word (4+ letters) of a campaign name, e.g. "flood", "water", "meals".
  const stop = new Set(["for", "the", "and", "district", "rural"]);
  let best: { id: number; score: number } | undefined;
  for (const c of ctx.campaigns) {
    const words = normalize(c.name).trim().split(" ").filter((w) => w.length >= 4 && !stop.has(w));
    const score = words.filter((w) => has(text, w)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: c.id, score };
  }
  if (best) return { found: best.id };
  return campaignWord && numbers.length ? { missing: true } : undefined;
}

export function parseCommand(raw: string, lng: LanguageCode, ctx: CommandContext): Intent | null {
  const text = normalize(raw);
  if (!text.trim()) return null;
  const lex = lexiconFor(lng);
  const any = (pick: (l: Lexicon) => string[]) => lex.some((l) => hasAny(text, pick(l)));
  const numbers = extractNumbers(text, lex);

  if (any((l) => l.stop)) return { type: "stop" };
  if (any((l) => l.help)) return { type: "help" };

  // Language switch ("switch to Hindi", "मराठी में बदलो").
  for (const code of ["en", "hi", "mr"] as LanguageCode[]) {
    if (any((l) => l.languages[code])) return { type: "language", lng: code };
  }

  // Donation prefill needs an amount; it never sends a transaction by itself.
  if (any((l) => l.donate) && numbers.length) {
    const campaign = findCampaign(text, lex, ctx, numbers);
    const campaignId = campaign?.found ?? ctx.currentCampaignId;
    // The amount is the number that is not the campaign id (or the first number).
    const amount = numbers.find((n) => n !== campaignId || numbers.length === 1) ?? numbers[0];
    return { type: "donate", amount, campaignId };
  }

  // Role switch.
  for (const role of ["verifier", "vendor", "donor", "ngo"] as Role[]) {
    if (any((l) => l.roles[role])) return { type: "role", role };
  }

  // Filters: severity words imply the alerts page, evidence-state words the evidence page.
  for (const sev of ["critical", "high", "medium", "low"] as Severity[]) {
    if (any((l) => l.severity[sev]) && (any((l) => l.pages["/alerts"]) || !any((l) => l.pages["/evidence"]))) {
      return { type: "filterAlerts", severity: sev };
    }
  }
  for (const state of ["pending", "attested", "challenged", "rejected"] as EvidenceState[]) {
    if (any((l) => l.evidenceState[state])) return { type: "filterEvidence", state };
  }
  if (any((l) => l.all)) {
    if (any((l) => l.pages["/alerts"])) return { type: "filterAlerts", severity: "all" };
    if (any((l) => l.pages["/evidence"])) return { type: "filterEvidence", state: "all" };
  }

  if (any((l) => l.read)) return { type: "read" };
  if (any((l) => l.back)) return { type: "back" };

  // A specific campaign ("open campaign 2", "show flood relief").
  const campaign = findCampaign(text, lex, ctx, numbers);
  if (campaign?.found) return { type: "openCampaign", id: campaign.found };
  if (campaign?.missing) return { type: "noCampaign" };

  // Pages. Longer phrases first so "follow a donation" beats a bare "donation".
  const pages = (Object.keys(en.pages) as Page[])
    .flatMap((page) => lex.flatMap((l) => l.pages[page].map((phrase) => ({ page, phrase }))))
    .sort((a, b) => b.phrase.length - a.phrase.length);
  const page = pages.find((p) => has(text, p.phrase));
  if (page) return { type: "navigate", page: page.page };

  if (any((l) => l.scrollDown)) return { type: "scroll", dir: "down" };
  if (any((l) => l.scrollUp)) return { type: "scroll", dir: "up" };
  return null;
}
