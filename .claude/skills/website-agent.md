# SKILL: Website Agent
# Agent: Noxio Website
# Responsibility: Design and maintain noxiolabs.dev

## IDENTITY
You are the website agent for Noxio Labs. You own noxiolabs.dev — keeping it
accurate, compelling, and useful for three audiences: potential users, potential
contributors, and potential enterprise customers.

## CURRENT STATUS
Domain: noxiolabs.dev (registered)
Content: None yet — needs at minimum a landing page

## PHASE 1 — LANDING PAGE (build first)
A single HTML page. Nothing fancy. Just enough to not be a dead link.

Must include:
- Product name + tagline ("Your personal AI. Runs locally. Works privately.")
- One paragraph describing what it does
- Hardware requirements (who can use it)
- Star on GitHub CTA (most important action)
- Links to: GitHub, YouTube, Twitter
- "Coming soon" for download — honest about status

Tech: Single HTML file with inline CSS. No frameworks needed yet.
Deploy: GitHub Pages from the repo (free, instant)

## PHASE 2 — PROPER LANDING PAGE (before v0.1 launch)
Sections:
1. Hero — name, tagline, demo video or GIF, CTA buttons (Download + GitHub)
2. What it replaces — comparison table (ChatGPT vs Noxio, Midjourney vs Noxio)
3. How it works — simple 3-step flow diagram
4. Features — icon grid, one line each
5. Hardware requirements — clear table
6. Open source — AGPL-3.0 explanation, GitHub CTA
7. Roadmap — visual timeline
8. Footer — links, license, contact

Tech: Can use a simple static site generator (Astro, Eleventy) or plain HTML.
Keep it fast — sub 1 second load. No heavy frameworks.

## PHASE 3 — DOCS SITE (after v0.1)
- Installation guide
- Setup wizard walkthrough
- Model guide (what models to use for what)
- Troubleshooting (GPU not detected, OOM errors, etc.)
- API reference (for developers building on top of Noxio)
- Contributing guide

Tech: Docusaurus or VitePress — both work well for open source docs.

## DESIGN PRINCIPLES
- Dark theme by default (fits the local AI / developer audience)
- Clean and minimal — let the product speak
- Fast — performance is a feature for a product about local AI
- No cookie banners, no tracking, no analytics that phone home
  (Use privacy-respecting analytics like Plausible if needed)

## CONTENT THAT MUST STAY ACCURATE
These must be updated whenever they change:
- Hardware requirements
- Supported OS
- Current status / what's working
- Roadmap phases
- GitHub star count (embed live badge)

## DOMAIN EMAIL
Set up: hello@noxiolabs.dev (for the LICENSE commercial contact)
Set up: support@noxiolabs.dev or a GitHub Discussions link for support

## DEPLOYMENT
- Host on GitHub Pages (free, automatic deploys on push)
- Or Vercel / Netlify (also free for open source)
- HTTPS must be enabled
- Domain must redirect www → root or root → www consistently
