import { useEffect, useRef, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { API, LedgerProvider, useLedger } from "./lib/store";
import type { Role } from "./lib/types";
import Overview from "./pages/Overview";
import CampaignDetail from "./pages/CampaignDetail";
import Trace from "./pages/Trace";
import EvidencePage from "./pages/Evidence";
import Alerts from "./pages/Alerts";
import Transactions from "./pages/Transactions";
import ProofChecker from "./pages/ProofChecker";

const ROLES: { id: Role; label: string; blurb: string }[] = [
  { id: "donor", label: "Donor", blurb: "Follow where your money went" },
  { id: "ngo", label: "NGO admin", blurb: "Request tranches, track budgets" },
  { id: "vendor", label: "Vendor", blurb: "Submit signed receipts" },
  { id: "verifier", label: "Verifier", blurb: "Attest, challenge, vote" },
];

const NAV = [
  { to: "/", label: "Campaigns" },
  { to: "/trace", label: "Follow a donation" },
  { to: "/evidence", label: "Evidence" },
  { to: "/alerts", label: "Alerts" },
  { to: "/transactions", label: "Transactions" },
  { to: "/verify-delivery", label: "Check a delivery" },
];

function Shell() {
  const { role, setRole, source, data, error, clearError } = useLedger();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const main = useRef<HTMLElement>(null);
  const prevPath = useRef(loc.pathname);
  const alertCount = data.alerts.filter((a) => a.severity === "critical" || a.severity === "high").length;

  useEffect(() => {
    setOpen(false);
    // Only move focus on an actual route change, so first load starts at the skip link.
    if (prevPath.current === loc.pathname) return;
    prevPath.current = loc.pathname;
    window.scrollTo(0, 0);
    main.current?.focus({ preventScroll: true });
  }, [loc.pathname]);

  const nav = (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.to === "/"}
          className={({ isActive }) =>
            `flex items-center justify-between rounded-xl px-3 py-2 text-sm transition-colors ${isActive ? "bg-ink text-cloud-50" : "text-ink-70 hover:bg-cloud-200"}`
          }
        >
          {n.label}
          {n.to === "/alerts" && alertCount > 0 && (
            <span className="tabular rounded-full bg-pepper-600 px-2 text-xs text-white" aria-label={`${alertCount} serious alerts`}>{alertCount}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );

  const roleSwitch = (
    <fieldset>
      <legend className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-ink-50">Viewing as</legend>
      <div className="grid grid-cols-2 gap-1 rounded-2xl bg-cloud-200 p-1">
        {ROLES.map((r) => (
          <button
            key={r.id}
            onClick={() => setRole(r.id)}
            aria-pressed={role === r.id}
            className={`rounded-xl px-2 py-1.5 text-xs font-medium transition-colors ${role === r.id ? "bg-cloud-50 text-potion shadow-sm" : "text-ink-70 hover:text-ink"}`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-50">{ROLES.find((r) => r.id === role)?.blurb}</p>
    </fieldset>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded focus:bg-ink focus:px-3 focus:py-2 focus:text-cloud-50">Skip to content</a>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-cloud-300 bg-cloud/90 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="mobile-nav" className="rounded-full border border-cloud-300 px-3 py-1.5 text-sm">
          {open ? "Close" : "Menu"}
        </button>
      </header>
      {open && (
        <div id="mobile-nav" className="space-y-6 border-b border-cloud-300 bg-cloud-50 p-4 lg:hidden">
          {roleSwitch}
          {nav}
        </div>
      )}

      <aside className="sticky top-0 hidden h-screen flex-col gap-8 border-r border-cloud-300 bg-cloud-50 p-5 lg:flex">
        <Brand />
        {roleSwitch}
        {nav}
        <p className="mt-auto text-xs leading-relaxed text-ink-50">
          Money is held in escrow and only released when independent verifiers confirm the proof. No single person can freeze or unfreeze a campaign.
        </p>
      </aside>

      <main id="main" ref={main} tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 pb-16 pt-6 outline-none md:px-8">
        {source !== "live" && (
          <div role="status" className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-pepper/40 bg-pepper-100 px-4 py-2 text-sm text-pepper-600">
            <strong className="font-semibold">{{ loading: "Connecting to ledger API…", stale: "Connection lost", demo: "Demo data" }[source]}</strong>
            {source === "demo" && (
              <span>
                {API ? `The ledger API at ${API} could not be reached.` : "No Phase 3 API is connected (set VITE_API_URL)."} Figures below are sample data and actions only change this browser session.
              </span>
            )}
            {source === "stale" && <span>The ledger API stopped responding. Figures are the last copy received and may be out of date.</span>}
          </div>
        )}
        {error && (
          <div role="alert" className="mb-6 flex items-start justify-between gap-3 rounded-xl border border-potion/40 bg-potion-50 px-4 py-2 text-sm text-potion-600">
            <span>{error}</span>
            <button onClick={clearError} className="shrink-0 underline underline-offset-2">Dismiss</button>
          </div>
        )}
        {source === "loading" ? (
          <p className="py-16 text-center text-sm text-ink-50">Loading ledger data…</p>
        ) : (
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/campaigns/:id" element={<CampaignDetail />} />
          <Route path="/trace" element={<Trace />} />
          <Route path="/evidence" element={<EvidencePage />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/verify-delivery" element={<ProofChecker />} />
          <Route path="*" element={<p className="text-ink-70">Page not found.</p>} />
        </Routes>
        )}
      </main>
    </div>
  );
}

function Brand() {
  return (
    <NavLink to="/" className="flex items-center gap-2.5">
      <span aria-hidden className="relative grid h-8 w-8 place-items-center rounded-full bg-ink">
        <span className="h-3.5 w-3.5 rounded-full border-2 border-pepper" />
      </span>
      <span className="font-serif text-lg leading-none tracking-tight">
        Black Hole <span className="text-potion">Ledger</span>
      </span>
    </NavLink>
  );
}

export default function App() {
  return (
    <LedgerProvider>
      <Shell />
    </LedgerProvider>
  );
}
