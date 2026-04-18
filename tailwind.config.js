/** @type {import('tailwindcss').Config} */
export default {
  content: ['./renderer/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Primitive scale (keep for any remaining one-off uses) ─────────
        // Components should prefer semantic tokens below.
        zinc: {
          950: 'rgb(var(--zinc-950) / <alpha-value>)',
          900: 'rgb(var(--zinc-900) / <alpha-value>)',
          800: 'rgb(var(--zinc-800) / <alpha-value>)',
          700: 'rgb(var(--zinc-700) / <alpha-value>)',
          600: 'rgb(var(--zinc-600) / <alpha-value>)',
          500: 'rgb(var(--zinc-500) / <alpha-value>)',
          400: 'rgb(var(--zinc-400) / <alpha-value>)',
          300: 'rgb(var(--zinc-300) / <alpha-value>)',
          200: 'rgb(var(--zinc-200) / <alpha-value>)',
          100: 'rgb(var(--zinc-100) / <alpha-value>)',
          50:  'rgb(var(--zinc-50)  / <alpha-value>)',
        },

        // ── Semantic surface tokens ───────────────────────────────────────
        // Use these for backgrounds. They auto-flip with the theme via the
        // zinc cascade — no per-component dark: variants needed.
        canvas: 'rgb(var(--canvas) / <alpha-value>)', // overall app bg
        panel:  'rgb(var(--panel)  / <alpha-value>)', // sidebar, settings pane
        card:   'rgb(var(--card)   / <alpha-value>)', // cards, inputs, list items
        raise:  'rgb(var(--raise)  / <alpha-value>)', // hover highlights, overlays

        // ── Semantic text tokens ──────────────────────────────────────────
        // Use these for all foreground text.
        fg: {
          DEFAULT: 'rgb(var(--fg)       / <alpha-value>)', // primary text
          dim:     'rgb(var(--fg-dim)   / <alpha-value>)', // secondary text
          muted:   'rgb(var(--fg-muted) / <alpha-value>)', // muted labels
          faint:   'rgb(var(--fg-faint) / <alpha-value>)', // hints, placeholders
        },

        // ── Semantic border tokens ────────────────────────────────────────
        // These are the ONLY tokens with explicit light-mode overrides because
        // contrast direction flips (dark bg = lighter border, light bg = darker).
        stroke: {
          DEFAULT: 'rgb(var(--stroke)     / <alpha-value>)', // visible border
          dim:     'rgb(var(--stroke-dim) / <alpha-value>)', // hairline / divider
        },

        // ── Accent ───────────────────────────────────────────────────────
        // Ice-blue #0DA5E9 — same in both themes.
        accent: {
          DEFAULT: 'rgb(var(--accent)       / <alpha-value>)',
          hover:   'rgb(var(--accent-hover) / <alpha-value>)',
        },

        // ── Legacy aliases (will be removed once migration is complete) ───
        violet: {
          600: 'rgb(var(--violet-600) / <alpha-value>)',
          500: 'rgb(var(--violet-500) / <alpha-value>)',
          400: 'rgb(var(--violet-400) / <alpha-value>)',
          300: 'rgb(var(--violet-300) / <alpha-value>)',
          200: 'rgb(var(--violet-200) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
