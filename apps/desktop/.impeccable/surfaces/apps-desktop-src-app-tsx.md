---
version: 1
slug: "apps-desktop-src-app-tsx"
primary_target: "apps/desktop/src/App.tsx"
related_targets: []
---

Scope: the whole JARVIS desktop frontend (apps/desktop), Operate mode. All spec §6.1 screens plus voice command setup and the wake moment.

Audience/job: the PC owner checking health, talking to JARVIS by voice, setting their own wake phrase and commands. Agent not built yet: every data surface shows an honest "agent not connected" state.

## Direction contract

THESIS: A mission terminal for one PC, pinned by the user's reference (dense neon trading-terminal HUD with a particle torus). We take its material language but refuse its density: few panels, plain sentences, one live object.

OWN-WORLD: Near-black navy ground (#060B14 → #0B1322 panels), 1px cyan-blue hairline frames (#1E3A5F, active #3FA9FF), uppercase mono panel headers led by a small diamond marker, signal colours with fixed meanings (green ok, amber attention, red problem/live, cyan info/JARVIS). A red LIVE strip with a scrolling ticker of real app events at the top. Big mono numerals for measurements, a clean sans for sentences.

STORY: The user sees what JARVIS can and cannot see right now, sets up their voice, and trusts that JARVIS answers only them.

FIRST VIEWPORT: Home. Left rail of screens. Centre: the JARVIS Core, a canvas particle torus (~55% of the panel), with input nodes on its left (Voice, CPU, Memory, Disk, Network) wired to it by curved lines; unconnected inputs are dim dashed wires. Under it one plain status sentence and the primary action "Set up your voice". Right column: Voice panel (wake phrase, listening state, mic level) and Agent status panel.

FORM: User-pinned reference (Pinterest pin 1151514198506662633, KYROX terminal HUD); roll overridden by the pin. Seed key 2ba2b554.

SIGNATURE INTERACTION: Saying the wake phrase in the owner's voice makes the core contract then flare, the whole window enters the listening state (core enlarged, ring of command chips, spoken reply). Mic level drives the particle shimmer live.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
