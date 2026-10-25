import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import en from "./locales/en.json";
import hi from "./locales/hi.json";
import mr from "./locales/mr.json";

type Tree = { [k: string]: string | Tree };

/** Flattens nested locale JSON into "a.b.c" → string. */
function flatten(tree: Tree, prefix = ""): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((out, [k, v]) => {
    const key = prefix ? `${prefix}.${k}` : k;
    return typeof v === "string" ? { ...out, [key]: v } : { ...out, ...flatten(v, key) };
  }, {});
}

const placeholders = (s: string) => [...s.matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]).sort();
const base = flatten(en as Tree);
const others = { hi: flatten(hi as Tree), mr: flatten(mr as Tree) };
const DEVANAGARI = /[ऀ-ॿ]/;

describe("locale files", () => {
  for (const [lng, strings] of Object.entries(others)) {
    it(`${lng} has exactly the same keys as en`, () => {
      expect(Object.keys(strings).sort()).toEqual(Object.keys(base).sort());
    });

    it(`${lng} keeps every {{placeholder}} of the English text`, () => {
      for (const key of Object.keys(base)) expect(placeholders(strings[key]), key).toEqual(placeholders(base[key]));
    });

    it(`${lng} has no empty strings and is actually translated`, () => {
      for (const [key, value] of Object.entries(strings)) expect(value.trim(), key).not.toBe("");
      const untranslated = Object.keys(base).filter((k) => strings[k] === base[k] && /[a-z]{4,}/i.test(base[k]) && !/^(mUSD|Ctrl|0x)/.test(base[k]));
      // Only brand-like or technical strings may stay identical to English.
      expect(untranslated).toEqual([]);
      const devanagariShare = Object.values(strings).filter((v) => DEVANAGARI.test(v)).length / Object.keys(strings).length;
      expect(devanagariShare).toBeGreaterThan(0.9);
    });
  }

  it("every t() key used in the source exists in the English file", () => {
    const src = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(f) && !f.endsWith(".test.ts")) files.push(p);
      }
    };
    walk(src);
    const missing: string[] = [];
    for (const file of files) {
      const code = fs.readFileSync(file, "utf8");
      // Literal keys only: t("a.b"), i18n.t("a.b"). Dynamic keys are covered by the enums below.
      for (const m of code.matchAll(/\bt\(\s*"([a-zA-Z][\w-]*(?:\.[\w-]+)+)"/g)) {
        if (!(m[1] in base)) missing.push(`${path.basename(file)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("has a string for every dynamic key family the UI builds", () => {
    const families: Record<string, string[]> = {
      roles: ["donor.label", "ngo.label", "vendor.label", "verifier.label", "donor.blurb", "ngo.blurb", "vendor.blurb", "verifier.blurb"],
      banner: ["loading", "stale", "demo"],
      severity: ["critical", "high", "medium", "low"],
      freezeReasons: ["0", "1", "2", "3", "4"],
      tranche: ["released", "pending", "locked", "blocked"],
      stage: ["verified", "pending", "failed"],
      evidenceState: ["pending", "attested", "challenged", "rejected"],
      evidenceFilter: ["all", "pending", "attested", "challenged", "rejected"],
      txKind: ["donation", "release", "swap", "bridge", "offramp", "attestation", "freeze", "refund"],
      rules: ["duplicate-evidence", "forgery-ratio", "vendor-concentration", "amount-clustering", "report-mismatch", "unexplained-transfer", "category-breach", "quorum-challenge"],
    };
    for (const [family, keys] of Object.entries(families)) {
      for (const k of keys) for (const strings of [base, ...Object.values(others)]) expect(strings[`${family}.${k}`], `${family}.${k}`).toBeTruthy();
    }
  });
});
