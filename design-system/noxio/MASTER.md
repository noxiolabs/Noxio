# Noxio Design System — MASTER

> Global Source of Truth. Page-specific overrides live in `pages/[page].md`.
> Generated: 2026-04-17 | Stack: React + Tailwind CSS | Style: Dark Navy + Ice Blue

---

## Color Palette

| Token | Hex | Tailwind Class | Usage |
|-------|-----|----------------|-------|
| Background | `#090E19` | `bg-zinc-950` | App background, deepest layer |
| Surface 1 | `#0D1525` | `bg-zinc-900` | Sidebar, nav panels |
| Surface 2 | `#131E30` | `bg-zinc-800` | Cards, inputs, conversation list |
| Border subtle | `#1C2D42` | `border-zinc-700` | Dividers, input borders |
| Border emphasis | `#263D57` | `border-zinc-600` | Focused inputs, active borders |
| Muted text | `#3D607E` | `text-zinc-500` | Placeholders, disabled states |
| Secondary text | `#6E95B4` | `text-zinc-400` | Timestamps, secondary labels |
| Dimmed text | `#9DBDD6` | `text-zinc-300` | Supporting text |
| Primary text | `#E0F0FA` | `text-zinc-100` | Main content, message text |
| Accent | `#0EA5E9` | `bg-violet-600` | Buttons, active states, send button |
| Accent hover | `#38BDF8` | `bg-violet-500` | Hover on accent elements |
| Accent light | `#7DD3FC` | `text-violet-400` | Icons, active nav items, links |

### Status Colors (unchanged)
- **Amber** — web search in progress, SearXNG starting, warnings
- **Green** — service healthy, success states, game mode active
- **Red** — errors, service down

---

## Typography

- **Font**: Inter (all weights — loaded via `@fontsource/inter`)
- **Scale**:
  - `text-xs` (11px) — timestamps, badges, meta
  - `text-sm` (13px) — body text, messages, labels
  - `text-base` (14px) — input fields
  - `text-lg` / `text-xl` — section headings
- **Line height**: `leading-relaxed` (1.6) for message content
- **Weight**: 400 body, 500 labels/buttons, 600 headings
- **Letter spacing**: default — no tracking adjustments needed

---

## Style Principles

- **Dark, not black** — Background is `#090E19` (navy-black), not pure `#000000`
- **Ice blue hierarchy** — Navy surfaces from `950 → 900 → 800` as layers stack; accent is sky blue
- **Calm over dramatic** — No neon glow, no heavy gradients; subtle transparency only
- **Breathing room** — Generous padding (`p-4`, `p-6`), gaps (`gap-3`, `gap-4`)
- **Border-first depth** — Use `border-zinc-700/40` for separation instead of heavy shadows
- **Transitions**: `150–200ms` for micro-interactions, `transition-colors` preferred
- **Reference aesthetic**: Clean three-panel layout (icon nav | list | main), rounded corners, spacious

---

## Component Patterns

### Input / Textarea
```
bg-zinc-800 border border-zinc-700/60 rounded-xl
focus-within:border-zinc-600 transition-colors
```

### Button (accent — ice blue)
```
bg-violet-600 hover:bg-violet-500 text-white rounded-lg
transition-colors disabled:opacity-30
```

### Message bubble (user)
```
bg-violet-600/20 border border-violet-600/30 rounded-2xl
```

### Message bubble (assistant)
```
No bg — text on transparent, avatar dot in violet-500
```

### Sidebar item (active)
```
bg-violet-600/15 text-zinc-100
```

### Badge / chip
```
bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs rounded-md px-2 py-1
```

### Thinking block
```
border border-zinc-700/50 bg-zinc-900/60 rounded-lg overflow-hidden
```

---

## Interaction Standards

| State | Treatment |
|-------|-----------|
| Hover | `hover:bg-zinc-800` or `hover:text-zinc-300` — never scale/shift layout |
| Active | `bg-zinc-700` or `bg-violet-600/20` |
| Focus | `ring-1 ring-zinc-600` or border color shift |
| Disabled | `opacity-30 cursor-not-allowed` |
| Loading | Amber spinner (`animate-spin`) or `animate-pulse` text |

---

## Icons

- **Source**: Lucide React (already in project via inline SVGs)
- **Size**: `w-4 h-4` (16px) for inline icons, `w-5 h-5` for standalone
- **No emojis as icons** — SVG only
- **Stroke width**: `2` standard, `1.8` for decorative
- **Color**: inherits from parent `text-*` class

---

## Spacing Scale

| Use | Value |
|-----|-------|
| Component padding | `p-3` or `p-4` |
| Section gaps | `gap-3` or `gap-4` |
| Page padding | `px-4 py-3` |
| Border radius | `rounded-lg` (8px) for items, `rounded-xl` (12px) for containers |

---

## Scrollbars

```css
::-webkit-scrollbar { width: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: #1C2D42; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #3D607E; }
```

---

## Pre-Delivery Checklist

- [ ] No emojis used as icons (SVG only)
- [ ] All clickable elements have `cursor-pointer`
- [ ] Hover states use `transition-colors duration-150`
- [ ] Focus states visible for keyboard navigation
- [ ] Text contrast minimum 4.5:1 against background
- [ ] `disabled:opacity-30 disabled:cursor-not-allowed` on all disabled elements
- [ ] No layout shift on hover (no scale transforms on containers)
- [ ] `animate-pulse` or spinner for all loading states
- [ ] No hardcoded hex values — use `bg-zinc-*` / `text-violet-*` classes only
