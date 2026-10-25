# Dashboard sources and attribution

Only the four approved sources were considered: ThreeUI, Taste Skill, GSAP, 21st.dev.

| Area | Source | What was used |
|---|---|---|
| Motion (entrance staggers, meter fills) | **GSAP** 3.12.5 (npm `gsap`, GSAP standard "no charge" license) | `gsap.context`, `gsap.matchMedia` with a `prefers-reduced-motion: no-preference` guard — `src/lib/motion.ts` |
| Hero backdrop | **ThreeUI** (pattern only) | Follows ThreeUI's lightweight raw-WebGL background approach (single full-screen fragment shader, no three.js). The shader is **project-specific code** written for this app; no ThreeUI source was copied. `src/components/HorizonField.tsx` |
| Design direction | **Taste Skill** (principles) | Anti-template layout: serif display + neutral sans pairing, one accent per role (Love Potion = action, Orange Pepper = attention), tabular numerals, generous whitespace, no neon/gradient "crypto" styling. |
| UI primitives (Card, Badge, Button, Meter, Field) | **21st.dev / shadcn registry conventions** (structure only) | Primitives follow the Tailwind + shadcn component API shape used by 21st.dev so registry components can be dropped in later. They are **project-specific implementations**; no 21st.dev component code was copied (time constraints prevented per-component license review). |

Other runtime dependencies are the existing project stack: React, React Router, Tailwind, and `ethers` (already used by the Hardhat project) for keccak256 in the Merkle proof checker.

Added for languages and voice:

- **Languages:** `i18next`, `react-i18next` and `i18next-browser-languagedetector` (MIT).
- **Devanagari fonts:** Noto Sans Devanagari and Noto Serif Devanagari from Google Fonts (SIL Open Font License).
- **Voice:** built on the browser's own Web Speech API (`SpeechRecognition`) and `speechSynthesis`, so no package is needed. The command parser, voice panel and summaries are project-specific code (`src/voice/`).
- **Tests:** `vitest` (MIT), a dev dependency.

## Palette
- Love Potion `#9E2A5A` — primary actions, critical states
- Orange Pepper `#D9601F` — attention, focus ring, pending states
- Cloud Dancer `#F0EEE9` — page background
