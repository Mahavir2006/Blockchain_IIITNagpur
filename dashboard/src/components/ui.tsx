import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({ children, className = "", ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div data-reveal className={`rounded-2xl border border-cloud-300/70 bg-cloud-50 p-5 shadow-[0_1px_0_rgba(38,32,30,0.04)] ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4" data-reveal>
      <div>
        {eyebrow && <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-50">{eyebrow}</p>}
        <h1 className="mt-1 font-serif text-3xl font-medium tracking-tight text-ink md:text-4xl">{title}</h1>
      </div>
      {children}
    </div>
  );
}

const tones = {
  neutral: "bg-cloud-200 text-ink-70",
  ok: "bg-ok-100 text-ok",
  warn: "bg-pepper-100 text-pepper-600",
  danger: "bg-potion-100 text-potion-600",
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const v = {
    primary: "bg-potion text-cloud-50 hover:bg-potion-600",
    ghost: "border border-cloud-300 bg-transparent text-ink hover:bg-cloud-200",
    danger: "bg-pepper-600 text-white hover:bg-pepper-700",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${v} ${className}`}
      {...rest}
    />
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card>
      <p className="text-sm text-ink-50">{label}</p>
      <p className="tabular mt-2 font-serif text-3xl text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-50">{hint}</p>}
    </Card>
  );
}

/** Horizontal meter; colour shifts by threshold so status never relies on colour alone (label carries value). */
export function Meter({ value, max = 1, label, invert = false }: { value: number; max?: number; label?: string; invert?: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const good = invert ? pct < 35 : pct >= 75;
  const bad = invert ? pct >= 65 : pct < 50;
  const color = good ? "bg-ok" : bad ? "bg-potion" : "bg-pepper";
  return (
    <div>
      {label && (
        <div className="mb-1 flex justify-between text-xs text-ink-70">
          <span>{label}</span>
          <span className="tabular">{Math.round(pct)}%</span>
        </div>
      )}
      <div className="h-2 overflow-hidden rounded-full bg-cloud-200" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div data-bar className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function riskTone(score: number): Tone {
  return score >= 70 ? "danger" : score >= 40 ? "warn" : "ok";
}

export function riskLabel(score: number) {
  return score >= 70 ? "High risk" : score >= 40 ? "Watch" : "Low risk";
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-ink-70">{label}</span>
      {children}
    </label>
  );
}

export const inputCls = "w-full rounded-xl border border-cloud-300 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink-50 focus:border-pepper focus:outline-none";

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-cloud-300 p-6 text-center text-sm text-ink-50">{children}</p>;
}
