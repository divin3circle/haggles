"use client";

/**
 * Theme-Aware Halftone Wordmark Footer (`@haggles/portal`).
 *
 * Renders an oversized halftone-dot wordmark ("haggles") cropped at the bottom edge.
 * Dots part around the pointer on springs and warm toward the Haggles accent color;
 * clicking sends a shock ring through the wordmark.
 *
 * Syncs automatically with `next-themes` (`light` / `dark`), uses the Haggles theme sans font
 * (`var(--font-sans), 'Space Grotesk', sans-serif` — no monospace), and `@tabler/icons-react`.
 */

import { IconArrowUp, IconArrowUpRight } from "@tabler/icons-react";
import { useTheme } from "next-themes";
import * as React from "react";
import { HagglesLogo } from "@/components/haggles/primitives";

/**
 * Color palette for the halftone wordmark canvas and footer links.
 */
export interface HalftonePalette {
  /** The footer background hex color (`#rrggbb`). */
  background: string;
  /** The dots at rest and text hex color (`#rrggbb`). */
  ink: string;
  /** The hex color a dot warms toward as it is displaced (`#rrggbb`). */
  warm: string;
}

/**
 * Built-in palette preset names.
 */
export type HalftonePreset = "night" | "paper" | "ember" | "cobalt";

/**
 * Single link item inside a footer navigation column.
 */
export interface FooterLink {
  label: string;
  href?: string | undefined;
  external?: boolean | undefined;
}

/**
 * Navigation column displayed along the top of the footer.
 */
export interface FooterColumn {
  title: string;
  links: FooterLink[];
}

/**
 * Props for {@link HalftoneWordmarkFooter}.
 */
export interface HalftoneWordmarkFooterProps {
  /** The giant word printed in halftone dots. Defaults to `"haggles"`. */
  wordmark?: string | undefined;
  /** Top-left brand line. Defaults to `"Haggles Protocol"`. */
  label?: string | undefined;
  /** Muted subtitle under the brand line. */
  meta?: string | undefined;
  /** Link columns along the top. */
  columns?: FooterColumn[] | undefined;
  /** Show the back-to-top button. Defaults to `true`. */
  backToTop?: boolean | undefined;
  /** Optional explicit preset; when omitted, follows `next-themes` (`night` in dark mode, `paper` in light mode). */
  preset?: HalftonePreset | undefined;
  /** Optional color overrides merged over the active preset. */
  palette?:
    | {
        background?: string | undefined;
        ink?: string | undefined;
        warm?: string | undefined;
      }
    | undefined;
  /** Distance between dot centers in CSS px. Defaults to `6`. */
  dotGap?: number | undefined;
  /** Pointer push radius in CSS px. Defaults to `80`. */
  radius?: number | undefined;
  /** Fraction of cap height hanging below the bottom edge (`0`–`0.6`). Defaults to `0.2`. */
  crop?: number | undefined;
  /** Subtle print grain intensity (`0`–`1`). Defaults to `0.45`. */
  grain?: number | undefined;
  /** Enable pointer and click shockwave interaction. Defaults to `true`. */
  interactive?: boolean | undefined;
  /** Font family for the wordmark and footer text (theme sans, no monospace). */
  fontFamily?: string | undefined;
  /** Font weight of the wordmark. Defaults to `700`. */
  fontWeight?: number | undefined;
  /** Root height CSS value. Defaults to `"520px"`. */
  height?: string | undefined;
  /** Extra root class names. */
  className?: string | undefined;
}

const PRESETS: Record<HalftonePreset, HalftonePalette> = {
  night: { background: "#111110", ink: "#F1EFEA", warm: "#f45b8c" },
  paper: { background: "#EBE9E5", ink: "#151514", warm: "#d92662" },
  ember: { background: "#160a06", ink: "#f2c48c", warm: "#ff5a1f" },
  cobalt: { background: "#0d1b4d", ink: "#dfe7ff", warm: "#ffcd3c" },
};

const DEFAULT_COLUMNS: FooterColumn[] = [
  {
    title: "Platform",
    links: [
      { label: "Buyer Wallet", href: "/buy" },
      { label: "Seller Studio", href: "/sell" },
      { label: "Sign in with PayPal", href: "/login" },
      { label: "Account Settings", href: "/account" },
    ],
  },
  {
    title: "Protocol",
    links: [
      { label: "About Haggles", href: "#about" },
      { label: "How It Works", href: "#how-it-works" },
      { label: "TypeScript SDKs", href: "#sdks" },
    ],
  },
  {
    title: "Resources",
    links: [
      {
        label: "Documentation",
        href: "https://github.com/haggles/haggles",
        external: true,
      },
      {
        label: "GitHub Repository",
        href: "https://github.com/haggles/haggles",
        external: true,
      },
      { label: "MIT License", href: "https://opensource.org/licenses/MIT", external: true },
    ],
  },
];

const THEME_SANS_STACK =
  '"Space Grotesk", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/**
 * Converts a `#rgb` or `#rrggbb` hex string into `[r, g, b]` in `0..255`, or `null` if invalid.
 *
 * @param hex - Hex color string
 * @returns RGB tuple or `null`
 *
 * @example
 * ```ts
 * hwfHex("#111110"); // [17, 17, 16]
 * ```
 */
export function hwfHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || "").trim());
  if (!m) return null;
  const raw = m[1]!;
  const h =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Computes the area-true dot radius for a cell coverage in `[0, 1]`.
 *
 * @param coverage - Cell alpha coverage in `[0, 1]`
 * @param gap - Distance between dot centers in CSS px
 * @returns Dot radius in CSS px
 *
 * @example
 * ```ts
 * hwfRadius(1, 6);
 * ```
 */
export function hwfRadius(coverage: number, gap: number): number {
  const c = coverage < 0 ? 0 : coverage > 1 ? 1 : coverage;
  return Math.sqrt(c) * gap * 0.56;
}

/**
 * Advances a single dot's spring physics back toward `(hx, hy)` while applying pointer repulsion from `(px, py)`.
 *
 * @returns Updated `[x, y, vx, vy]` tuple
 *
 * @example
 * ```ts
 * const [nx, ny, nvx, nvy] = hwfStep(10, 10, 0, 0, 10, 10, 50, 50, 80);
 * ```
 */
export function hwfStep(
  x: number,
  y: number,
  vx: number,
  vy: number,
  hx: number,
  hy: number,
  px: number,
  py: number,
  r: number,
): [number, number, number, number] {
  const dx = x - px;
  const dy = y - py;
  const d2 = dx * dx + dy * dy;
  let nextVx = vx;
  let nextVy = vy;
  if (r > 0 && d2 < r * r) {
    const d = Math.sqrt(d2) + 0.001;
    const f = (1 - d / r) * 2.6;
    nextVx += (dx / d) * f;
    nextVy += (dy / d) * f;
  }
  nextVx = (nextVx + (hx - x) * 0.05) * 0.84;
  nextVy = (nextVy + (hy - y) * 0.05) * 0.84;
  return [x + nextVx, y + nextVy, nextVx, nextVy];
}

/**
 * Computes how warm a dot is drawn (`0` at home, `1` once displaced by `span` px or more).
 *
 * @example
 * ```ts
 * hwfWarmth(12, 10, 10, 10, 28);
 * ```
 */
export function hwfWarmth(
  x: number,
  y: number,
  hx: number,
  hy: number,
  span: number,
): number {
  const d = Math.hypot(x - hx, y - hy);
  return span > 0 ? Math.min(1, d / span) : 0;
}

/**
 * Computes the font size in px that scales `measured` (width at 100px) to fill `width`.
 *
 * @example
 * ```ts
 * hwfFitSize(400, 1200); // 300
 * ```
 */
export function hwfFitSize(measured: number, width: number): number {
  return measured > 0 ? (width / measured) * 100 : 0;
}

const HWF_CSS = `
.hwf-root {
  position: relative; width: 100%; overflow: hidden; isolation: isolate;
  background: var(--hwf-bg); color: var(--hwf-ink); -webkit-font-smoothing: antialiased;
  font-family: var(--hwf-sans);
  border-top: 1px solid color-mix(in srgb, var(--hwf-ink) 12%, transparent);
  transition: background-color .45s ease, color .45s ease;
}
.hwf-root canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; max-width: none; }
.hwf-top {
  position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0, 1.35fr) repeat(3, minmax(0, 1fr));
  gap: 28px; padding: clamp(28px, 3.6vw, 44px) clamp(20px, 3.4vw, 48px) 0;
  font-family: var(--hwf-sans); font-size: 13px; letter-spacing: -.005em; line-height: 1.85;
}
.hwf-brand-row { display: inline-flex; align-items: center; gap: 9px; font-weight: 600; font-size: 15px; letter-spacing: -.02em; }
.hwf-brand span.hwf-meta { display: block; margin-top: 4px; font-size: 12.5px; opacity: .58; }
.hwf-col h3 { margin: 0 0 6px; font-size: 11.5px; letter-spacing: .06em; text-transform: uppercase; opacity: .48; font-weight: 600; }
.hwf-col ul { list-style: none; margin: 0; padding: 0; }
.hwf-col a, .hwf-up {
  color: inherit; text-decoration: none; opacity: .78; background: none; border: 0; padding: 0;
  font: inherit; letter-spacing: inherit; cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  background-image: linear-gradient(currentColor, currentColor); background-size: 0% 1px;
  background-repeat: no-repeat; background-position: 0 100%; transition: opacity .25s ease, background-size .35s cubic-bezier(.2,.7,.1,1);
}
.hwf-col a:hover, .hwf-up:hover { opacity: 1; background-size: 100% 1px; }
.hwf-col a:focus-visible, .hwf-up:focus-visible { outline: 1px solid currentColor; outline-offset: 3px; opacity: 1; }
.hwf-rule {
  position: relative; z-index: 1; display: flex; justify-content: flex-end; align-items: center; gap: 16px;
  margin: clamp(20px, 2.8vw, 32px) clamp(20px, 3.4vw, 48px) 0; padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--hwf-ink) 14%, transparent);
  font-family: var(--hwf-sans); font-size: 12px; opacity: .75;
}
.hwf-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 720px) {
  .hwf-top { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); row-gap: 20px; }
  .hwf-brand { grid-column: 1 / -1; }
}
@media (prefers-reduced-motion: reduce) {
  .hwf-col a, .hwf-up { transition: none; }
}
`;

/**
 * Interactive Halftone Wordmark Footer synced with the portal's light/dark theme and Space Grotesk font.
 *
 * @example
 * ```tsx
 * <HalftoneWordmarkFooter wordmark="haggles" />
 * ```
 */
export default function HalftoneWordmarkFooter({
  wordmark = "haggles",
  label = "Haggles",
  meta = "©2026 · HTTP 402 Agentic Commerce on PayPal Rails",
  columns = DEFAULT_COLUMNS,
  backToTop = true,
  preset,
  palette,
  dotGap = 6,
  radius = 85,
  crop = 0.2,
  grain = 0.45,
  interactive = true,
  fontFamily = THEME_SANS_STACK,
  fontWeight = 700,
  height = "520px",
  className = "",
}: HalftoneWordmarkFooterProps) {
  const { resolvedTheme } = useTheme();
  const activePreset: HalftonePreset =
    preset ?? (resolvedTheme === "light" ? "paper" : "night");
  const colors: HalftonePalette = {
    ...(PRESETS[activePreset] ?? PRESETS.night),
    ...(palette ?? {}),
  };

  const rootRef = React.useRef<HTMLElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const opts = React.useRef({
    colors,
    dotGap,
    radius,
    crop,
    grain,
    interactive,
    fontFamily,
    fontWeight,
    wordmark,
  });
  opts.current = {
    colors,
    dotGap,
    radius,
    crop,
    grain,
    interactive,
    fontFamily,
    fontWeight,
    wordmark,
  };
  const key = [
    wordmark,
    dotGap,
    crop,
    grain,
    fontFamily,
    fontWeight,
    colors.background,
    colors.ink,
    colors.warm,
  ].join("|");

  React.useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let px = -1e5;
    let py = -1e5;
    let raf = 0;
    let visible = true;
    let awake = true;
    let ring = { x: 0, y: 0, t: -1 };
    let dots = new Float32Array(0);
    let count = 0;
    let grainTile: HTMLCanvasElement | null = null;
    const ink = hwfHex(opts.current.colors.ink) ?? [241, 239, 234];
    const warm = hwfHex(opts.current.colors.warm) ?? [244, 91, 140];

    const layout = () => {
      const o = opts.current;
      const rect = root.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      const mask = document.createElement("canvas");
      mask.width = w;
      mask.height = h;
      const m = mask.getContext("2d", { willReadFrequently: true });
      if (!m) return;
      const face = `${o.fontWeight} 100px ${o.fontFamily}`;
      m.font = face;
      const word = o.wordmark || " ";
      const fit = hwfFitSize(m.measureText(word).width, w * 0.96);
      m.font = `${o.fontWeight} ${fit}px ${o.fontFamily}`;
      const box = m.measureText(word);
      const cap = box.actualBoundingBoxAscent || fit * 0.72;
      const c = Math.max(0, Math.min(0.6, o.crop));
      m.fillStyle = "#000";
      m.textBaseline = "alphabetic";
      m.fillText(word, (w - box.width) / 2, h + cap * c);
      const img = m.getImageData(0, 0, w, h).data;

      const gap = Math.max(3, o.dotGap);
      const cols = Math.ceil(w / gap);
      const rows = Math.ceil(h / gap);
      const tmp: number[] = [];
      for (let gy = 0; gy < rows; gy++) {
        for (let gx = 0; gx < cols; gx++) {
          let sum = 0;
          for (let sy = 0; sy < 3; sy++) {
            for (let sx = 0; sx < 3; sx++) {
              const x = Math.min(
                w - 1,
                Math.floor(gx * gap + ((sx + 0.5) * gap) / 3),
              );
              const y = Math.min(
                h - 1,
                Math.floor(gy * gap + ((sy + 0.5) * gap) / 3),
              );
              sum += img[(y * w + x) * 4 + 3] ?? 0;
            }
          }
          const cov = sum / (9 * 255);
          if (cov < 0.06) continue;
          const hx = gx * gap + gap / 2;
          const hy = gy * gap + gap / 2;
          tmp.push(hx, hy, 0, 0, hx, hy, hwfRadius(cov, gap));
        }
      }
      dots = new Float32Array(tmp);
      count = tmp.length / 7;

      grainTile = document.createElement("canvas");
      grainTile.width = 256;
      grainTile.height = 256;
      const g = grainTile.getContext("2d");
      if (g) {
        const id = g.createImageData(256, 256);
        for (let i = 0; i < id.data.length; i += 4) {
          const v = Math.random() * 255;
          id.data[i] = id.data[i + 1] = id.data[i + 2] = v;
          id.data[i + 3] = Math.random() < 0.5 ? 0 : 255;
        }
        g.putImageData(id, 0, 0);
      }
      awake = true;
    };

    const draw = (now: number) => {
      const o = opts.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = o.colors.background;
      ctx.fillRect(0, 0, w, h);

      const r = o.interactive && !reduced ? Math.max(0, o.radius) : 0;
      const ringAge = ring.t < 0 ? 1e9 : now - ring.t;
      const ringR = ringAge * 0.9;
      let moving = false;
      for (let i = 0; i < count; i++) {
        const j = i * 7;
        let x = dots[j]!;
        let y = dots[j + 1]!;
        let vx = dots[j + 2]!;
        let vy = dots[j + 3]!;
        const hx = dots[j + 4]!;
        const hy = dots[j + 5]!;
        if (!reduced) {
          if (ringAge < 900) {
            const dx = hx - ring.x;
            const dy = hy - ring.y;
            const d = Math.sqrt(dx * dx + dy * dy) + 0.001;
            const band = 1 - Math.min(1, Math.abs(d - ringR) / 26);
            if (band > 0) {
              const f = band * 3.2 * (1 - ringAge / 900);
              vx += (dx / d) * f;
              vy += (dy / d) * f;
            }
          }
          const s = hwfStep(x, y, vx, vy, hx, hy, px, py, r);
          x = s[0];
          y = s[1];
          vx = s[2];
          vy = s[3];
          if (
            Math.abs(vx) + Math.abs(vy) > 0.02 ||
            Math.abs(x - hx) + Math.abs(y - hy) > 0.05
          ) {
            moving = true;
          } else {
            x = hx;
            y = hy;
            vx = 0;
            vy = 0;
          }
          dots[j] = x;
          dots[j + 1] = y;
          dots[j + 2] = vx;
          dots[j + 3] = vy;
        }
        const k = hwfWarmth(x, y, hx, hy, 28);
        ctx.fillStyle =
          k > 0.02
            ? `rgb(${Math.round(ink[0] + (warm[0] - ink[0]) * k)},${Math.round(
                ink[1] + (warm[1] - ink[1]) * k,
              )},${Math.round(ink[2] + (warm[2] - ink[2]) * k)})`
            : o.colors.ink;
        ctx.beginPath();
        ctx.arc(x, y, dots[j + 6]!, 0, 6.2832);
        ctx.fill();
      }

      if (grainTile && o.grain > 0) {
        ctx.globalAlpha = Math.min(1, o.grain) * 0.08;
        ctx.globalCompositeOperation = "overlay";
        const pattern = ctx.createPattern(grainTile, "repeat");
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      awake = moving || ringAge < 900 || px > -1e4;
    };

    const loop = (now: number) => {
      raf = 0;
      if (!visible) return;
      draw(now);
      if (awake) raf = requestAnimationFrame(loop);
    };
    const wake = () => {
      awake = true;
      if (!raf && visible) raf = requestAnimationFrame(loop);
    };

    const toLocal = (e: PointerEvent): [number, number] => {
      const b = canvas.getBoundingClientRect();
      return [e.clientX - b.left, e.clientY - b.top];
    };
    const onMove = (e: PointerEvent) => {
      if (!opts.current.interactive) return;
      const p = toLocal(e);
      px = p[0];
      py = p[1];
      wake();
    };
    const onLeave = () => {
      px = -1e5;
      py = -1e5;
      wake();
    };
    const onDown = (e: PointerEvent) => {
      if (!opts.current.interactive || reduced) return;
      if ((e.target as HTMLElement).closest("a,button")) return;
      const p = toLocal(e);
      ring = { x: p[0], y: p[1], t: performance.now() };
      wake();
    };

    layout();
    draw(performance.now());
    wake();

    root.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    root.addEventListener("pointerdown", onDown);
    const ro = new ResizeObserver(() => {
      layout();
      wake();
    });
    ro.observe(root);
    const io = new IntersectionObserver((entries) => {
      visible = entries[0] ? entries[0].isIntersecting : true;
      if (visible) wake();
    });
    io.observe(root);

    let alive = true;
    if (document.fonts && document.fonts.ready) {
      void document.fonts.ready.then(() => {
        if (!alive) return;
        layout();
        wake();
      });
    }

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      root.removeEventListener("pointermove", onMove);
      root.removeEventListener("pointerleave", onLeave);
      root.removeEventListener("pointerdown", onDown);
    };
  }, [key]);

  const toTop = () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <footer
      ref={rootRef}
      className={`hwf-root ${className}`.trim()}
      style={
        {
          height,
          "--hwf-bg": colors.background,
          "--hwf-ink": colors.ink,
          "--hwf-sans": `var(--font-sans), ${fontFamily}`,
        } as React.CSSProperties
      }
    >
      <style>{HWF_CSS}</style>
      <canvas ref={canvasRef} aria-hidden="true" />
      <span className="hwf-sr">{wordmark}</span>
      <div className="hwf-top">
        <div className="hwf-brand">
          <div className="hwf-brand-row">
            <HagglesLogo className="h-5" />
            <strong>{label}</strong>
          </div>
          <span className="hwf-meta">{meta}</span>
        </div>
        {columns.map((col) => (
          <nav className="hwf-col" key={col.title} aria-label={col.title}>
            <h3>{col.title}</h3>
            <ul>
              {col.links.map((l) => (
                <li key={l.label}>
                  <a
                    href={l.href || "#"}
                    target={l.external ? "_blank" : undefined}
                    rel={l.external ? "noreferrer" : undefined}
                  >
                    <span>{l.label}</span>
                    {l.external ? (
                      <IconArrowUpRight className="size-3.5 opacity-70" />
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="hwf-rule">
        {backToTop ? (
          <button type="button" className="hwf-up" onClick={toTop}>
            <span>Back to top</span>
            <IconArrowUp className="size-3.5" />
          </button>
        ) : null}
      </div>
    </footer>
  );
}
