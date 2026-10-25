import { describe, expect, it } from "vitest";
import { extractNumbers, LEXICONS, normalize, parseCommand, type Intent } from "./commands";
import type { LanguageCode } from "../i18n";

const ctx = {
  campaigns: [
    { id: 1, name: "Clean Water for Wardha District" },
    { id: 2, name: "Flood Relief Kits — Assam" },
    { id: 3, name: "School Meals — Nagpur Rural" },
  ],
};
const p = (text: string, lng: LanguageCode = "en", extra: Partial<typeof ctx & { currentCampaignId: number }> = {}) => parseCommand(text, lng, { ...ctx, ...extra });

/** [utterance, language, expected intent] — real phrasings in each language, incl. mixed. */
const CASES: [string, LanguageCode, Intent][] = [
  // ---------- English
  ["open alerts", "en", { type: "navigate", page: "/alerts" }],
  ["Go to the transactions page.", "en", { type: "navigate", page: "/transactions" }],
  ["show me the evidence", "en", { type: "navigate", page: "/evidence" }],
  ["follow a donation", "en", { type: "navigate", page: "/trace" }],
  ["check a delivery", "en", { type: "navigate", page: "/verify-delivery" }],
  ["go home", "en", { type: "navigate", page: "/" }],
  ["show all campaigns", "en", { type: "navigate", page: "/" }],
  ["open campaign 2", "en", { type: "openCampaign", id: 2 }],
  ["open campaign two", "en", { type: "openCampaign", id: 2 }],
  ["show flood relief", "en", { type: "openCampaign", id: 2 }],
  ["school meals please", "en", { type: "openCampaign", id: 3 }],
  ["open campaign 9", "en", { type: "noCampaign" }],
  ["switch to verifier", "en", { type: "role", role: "verifier" }],
  ["view as NGO admin", "en", { type: "role", role: "ngo" }],
  ["I am a vendor", "en", { type: "role", role: "vendor" }],
  ["switch to Hindi", "en", { type: "language", lng: "hi" }],
  ["change language to Marathi", "en", { type: "language", lng: "mr" }],
  ["show critical alerts", "en", { type: "filterAlerts", severity: "critical" }],
  ["high alerts", "en", { type: "filterAlerts", severity: "high" }],
  ["show all alerts", "en", { type: "filterAlerts", severity: "all" }],
  ["show pending receipts", "en", { type: "filterEvidence", state: "pending" }],
  ["show verified evidence", "en", { type: "filterEvidence", state: "attested" }],
  ["rejected receipts", "en", { type: "filterEvidence", state: "rejected" }],
  ["donate 10 to campaign 1", "en", { type: "donate", amount: 10, campaignId: 1 }],
  ["donate 25 to flood relief", "en", { type: "donate", amount: 25, campaignId: 2 }],
  ["donate five", "en", { type: "donate", amount: 5, campaignId: undefined }],
  ["read this page", "en", { type: "read" }],
  ["give me a summary", "en", { type: "read" }],
  ["what can I say", "en", { type: "help" }],
  ["help", "en", { type: "help" }],
  ["go back", "en", { type: "back" }],
  ["scroll down", "en", { type: "scroll", dir: "down" }],
  ["scroll up", "en", { type: "scroll", dir: "up" }],
  ["stop", "en", { type: "stop" }],

  // ---------- Hindi
  ["अलर्ट खोलो", "hi", { type: "navigate", page: "/alerts" }],
  ["लेनदेन दिखाओ", "hi", { type: "navigate", page: "/transactions" }],
  ["सबूत दिखाइए", "hi", { type: "navigate", page: "/evidence" }],
  ["दान को ट्रैक करो", "hi", { type: "navigate", page: "/trace" }],
  ["डिलीवरी जाँचें", "hi", { type: "navigate", page: "/verify-delivery" }],
  ["अभियान खोलो", "hi", { type: "navigate", page: "/" }],
  ["अभियान 2 खोलो", "hi", { type: "openCampaign", id: 2 }],
  ["अभियान दो खोलो", "hi", { type: "openCampaign", id: 2 }],
  ["अभियान ३ खोलो", "hi", { type: "openCampaign", id: 3 }],
  ["सत्यापनकर्ता बनो", "hi", { type: "role", role: "verifier" }],
  ["वेरिफायर बनो", "hi", { type: "role", role: "verifier" }],
  ["दानदाता के रूप में देखो", "hi", { type: "role", role: "donor" }],
  ["मराठी में बदलो", "hi", { type: "language", lng: "mr" }],
  ["इंग्लिश में बदलो", "hi", { type: "language", lng: "en" }],
  ["गंभीर अलर्ट दिखाओ", "hi", { type: "filterAlerts", severity: "critical" }],
  ["सभी अलर्ट दिखाओ", "hi", { type: "filterAlerts", severity: "all" }],
  ["लंबित रसीदें दिखाओ", "hi", { type: "filterEvidence", state: "pending" }],
  ["अस्वीकृत रसीदें", "hi", { type: "filterEvidence", state: "rejected" }],
  ["अभियान 1 में 10 दान करो", "hi", { type: "donate", amount: 10, campaignId: 1 }],
  ["दस दान करो", "hi", { type: "donate", amount: 10, campaignId: undefined }],
  ["यह पेज पढ़ो", "hi", { type: "read" }],
  ["मदद", "hi", { type: "help" }],
  ["पीछे जाओ", "hi", { type: "back" }],
  ["नीचे स्क्रॉल करो", "hi", { type: "scroll", dir: "down" }],
  ["रुको", "hi", { type: "stop" }],
  // Hinglish: English keywords inside Hindi speech
  ["alerts खोलो", "hi", { type: "navigate", page: "/alerts" }],
  ["campaign 3 खोलो", "hi", { type: "openCampaign", id: 3 }],

  // ---------- Marathi
  ["इशारे उघडा", "mr", { type: "navigate", page: "/alerts" }],
  ["व्यवहार दाखवा", "mr", { type: "navigate", page: "/transactions" }],
  ["पुरावे दाखवा", "mr", { type: "navigate", page: "/evidence" }],
  ["देणगीचा मागोवा घ्या", "mr", { type: "navigate", page: "/trace" }],
  ["वितरण तपासा", "mr", { type: "navigate", page: "/verify-delivery" }],
  ["मोहिमा उघडा", "mr", { type: "navigate", page: "/" }],
  ["मोहीम 2 उघडा", "mr", { type: "openCampaign", id: 2 }],
  ["मोहीम दोन उघडा", "mr", { type: "openCampaign", id: 2 }],
  ["पडताळणीकर्ता म्हणून पाहा", "mr", { type: "role", role: "verifier" }],
  ["विक्रेता म्हणून पाहा", "mr", { type: "role", role: "vendor" }],
  ["हिंदीत बदला", "mr", { type: "language", lng: "hi" }],
  ["इंग्रजीत बदला", "mr", { type: "language", lng: "en" }],
  ["इंग्रजी मध्ये बदला", "mr", { type: "language", lng: "en" }],
  ["गंभीर इशारे दाखवा", "mr", { type: "filterAlerts", severity: "critical" }],
  ["प्रलंबित पावत्या दाखवा", "mr", { type: "filterEvidence", state: "pending" }],
  ["नाकारलेल्या पावत्या", "mr", { type: "filterEvidence", state: "rejected" }],
  ["मोहीम 1 ला 10 देणगी द्या", "mr", { type: "donate", amount: 10, campaignId: 1 }],
  ["हे पान वाचा", "mr", { type: "read" }],
  ["मदत", "mr", { type: "help" }],
  ["मागे जा", "mr", { type: "back" }],
  ["खाली स्क्रोल करा", "mr", { type: "scroll", dir: "down" }],
  ["वर स्क्रोल करा", "mr", { type: "scroll", dir: "up" }],
  ["थांबा", "mr", { type: "stop" }],
  ["alerts उघडा", "mr", { type: "navigate", page: "/alerts" }],
];

describe("parseCommand", () => {
  for (const [text, lng, expected] of CASES) {
    it(`[${lng}] “${text}”`, () => {
      expect(p(text, lng)).toEqual(expected);
    });
  }

  it("uses the campaign on screen when a donation names none", () => {
    expect(p("donate 7", "en", { currentCampaignId: 3 })).toEqual({ type: "donate", amount: 7, campaignId: 3 });
    expect(p("दस दान करो", "hi", { currentCampaignId: 2 })).toEqual({ type: "donate", amount: 10, campaignId: 2 });
  });

  it("separates the amount from the campaign number in either order", () => {
    expect(p("donate 1 to campaign 1")).toEqual({ type: "donate", amount: 1, campaignId: 1 });
    expect(p("to campaign 3 donate 12")).toEqual({ type: "donate", amount: 12, campaignId: 3 });
  });

  it("never treats 'follow a donation' as a donation", () => {
    expect(p("follow a donation")).toEqual({ type: "navigate", page: "/trace" });
    expect(p("follow donation 5")?.type).not.toBe("donate");
  });

  it("does not confuse 'verified' (evidence state) with 'verifier' (role)", () => {
    expect(p("show verified receipts")).toEqual({ type: "filterEvidence", state: "attested" });
    expect(p("switch to verifier")).toEqual({ type: "role", role: "verifier" });
  });

  it("returns null for unrelated or empty speech", () => {
    for (const t of ["", "   ", "what is the weather today", "मौसम कैसा है", "आज हवामान कसे आहे"]) {
      expect(p(t, t.match(/[ऀ-ॿ]/) ? "hi" : "en"), t).toBeNull();
    }
  });

  it("is case- and punctuation-insensitive", () => {
    expect(p("OPEN ALERTS!!!")).toEqual({ type: "navigate", page: "/alerts" });
    expect(p("Open, campaign 2.")).toEqual({ type: "openCampaign", id: 2 });
    expect(p("अलर्ट खोलो।", "hi")).toEqual({ type: "navigate", page: "/alerts" });
  });
});

describe("numbers", () => {
  it("normalises Devanagari digits", () => {
    expect(normalize("अभियान ३")).toBe(" अभियान 3 ");
    expect(normalize("१०")).toBe(" 10 ");
  });

  it("reads number words in each language", () => {
    expect(extractNumbers(normalize("two and ten"), [LEXICONS.en])).toEqual([2, 10]);
    expect(extractNumbers(normalize("दो और पचास"), [LEXICONS.hi])).toEqual([2, 50]);
    expect(extractNumbers(normalize("दोन आणि शंभर"), [LEXICONS.mr])).toEqual([2, 100]);
    expect(extractNumbers(normalize("12.5 mUSD"), [LEXICONS.en])).toEqual([12.5]);
  });
});
