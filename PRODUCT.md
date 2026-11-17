# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(The UI is a React web frontend that will be wrapped in a Tauri 2 desktop shell for Windows 11. It is designed for a desktop window first, and must still work at narrow widths.)

## Stack

React + TypeScript + Vite, in `apps/desktop/`, as set by the JARVIS spec (§7.4, §17.1). The Tauri 2 shell (`src-tauri/`) and the Python FastAPI agent (`apps/agent/`) are not built yet.

## Users

The owner of the PC, using JARVIS on their own Windows 11 laptop (built for them first, kept licence-clean and understandable so it can be shared with other people later). Jobs: understand why the PC is slow or broken, check its health, talk to it by voice or chat, and launch routine workflows.

## Product Purpose

JARVIS is a local-first Windows 11 companion that collects real evidence from the PC, explains findings in plain language, proposes bounded fixes, and only changes the system with explicit approval. Success: the user understands what is happening on their PC and trusts what JARVIS says and does.

## Positioning

Evidence before explanation. Every claim links to a measurement, event or rule; unknown is a valid answer; the AI picks from named tools and never runs arbitrary commands. Local by default; cloud AI is off until the user opts in.

## Operating Context

- Source spec: `JARVIS_PC_Intelligence_Implementation_Specification.docx` v1.0 (31 Oct 2026).
- Screens (spec §6.1): Home, Diagnostics, Finding detail, Assistant, Monitor, Automation, Activity & safety, Settings, plus a tray.
- Voice: push-to-talk and an optional wake phrase. The user records their own wake phrase and a few command phrases mapped to fixed in-app actions. JARVIS must respond only to the enrolled user's voice, not to other people.
- Hardware of the first PC: i5-9300H, 8 GB RAM, GTX 1650 4 GB.

## Capabilities and Constraints

- Until the agent exists, screens show honest "agent not connected" states. No sample or fabricated readings (spec FR-002).
- Wake listening is off by default, needs explicit microphone permission, and shows a visible mic indicator with mute (spec §13.3).
- Voice matching runs on the device; no raw audio is stored or sent anywhere. The voice match is a convenience gate, not a security lock.
- Risk classes R0–R3 and per-action approval bound to an argument hash (spec §12).
- Undecided: final local model, Ollama bundling, cloud provider.

## Brand Commitments

Name: JARVIS. User asked for a UI that is simple, easy to understand and futuristic.

## Evidence on Hand

No real telemetry yet. Do not fabricate metrics, findings, testimonials or device names.

## Product Principles

1. Evidence before explanation; show source and freshness.
2. Calm by default; alarm only when the rules say so.
3. Nothing changes without the user seeing exactly what will happen.
4. Local and private unless the user decides otherwise.
5. Plain sentence first, technical detail on demand.

## Accessibility & Inclusion

Keyboard navigable, screen-reader labels, sufficient contrast, scalable text, and a typed alternative to every voice action (spec NFR-008).
