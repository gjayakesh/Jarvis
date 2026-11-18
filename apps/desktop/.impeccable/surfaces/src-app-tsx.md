---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

Scope: the whole JARVIS desktop frontend (apps/desktop), Operate mode. All spec §6.1 screens, voice setup, the wake moment, Settings → About you.

Audience/job: the PC owner checking health, talking to JARVIS by voice (Alexa-style requests), setting their wake phrase and commands. Agent not built yet: every data surface stays an honest "no data" state. Density: calm, same content per screen as before (owner's answer).

## Direction contract

THESIS: JARVIS as a flight controller's console for one PC: every screen is a console station, white on black, and the only living thing is a gold flaming sun that is JARVIS. Refuses the neon-cyan sci-fi HUD and the grid of soft cards.

OWN-WORLD: Pure black ground; panels are bracketed frames (white hairline at low strength, brighter 8px corner brackets) with mono station headers; ruler tick strips on the frame edges on the 8px grid. Monochrome text in three steps. Gold is JARVIS alone: the sun, primary action, selected-item ring, live wire. Status is a bracketed mono word with a tone square: GO / HOLD / NO DATA / FAULT, red only for a live mic.

STORY: the owner sees which stations have data (none yet, said plainly), watches the sun breathe with their voice, says "Hey Jarvis", the sun flares and greets them by name.

FIRST VIEWPORT: Home. Top bar: small live sun mark, ticker, mic state, clock. Left rail of stations. Centre panel: the sun at ~55% of the stage, labelled station lines entering from the left (Voice gold when live, others dashed grey NO DATA); greeting headline and primary action under it. Right column: Voice and Agent stations. Below: heard log as a console event log.

FORM: owner-pinned mission-control HUD + JARVIS sun pins; reading 3 of 7 (flight controller console). Seed key 29d1aa73. Raises: star atlas (importance by a fixed size ramp, selected item ringed in gold); Crouwel grid (the tick grid is the real layout grid); acetate manual (UI state changes snap in two 90ms steps; only the sun moves organically).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
