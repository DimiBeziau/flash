# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project: "flash" — VLC (Visible Light Communication) PWA

React + Vite + TypeScript + Tailwind. Two devices exchange a text message via
light pulses: the emitter flashes its screen (or torch), the receiver decodes
the camera feed.

### Commands
- `npm run dev` — dev server
- `npm run build` — typecheck + production build
- `npm run test:proto` — **offline end-to-end protocol test** (simulated camera
  with auto-exposure, jitter, noise). MUST pass before any hardware testing.
- `docker compose up --build` — production (nginx, port 80)

### Architecture
- `src/lib/vlc-protocol.ts` — ALL signal logic, pure functions, fully testable:
  encode (preamble + sync + length + data + checksum, bit-stuffed),
  decode (delta-latch binarization → timestamped runs → autobaud → frame parse)
- `src/components/EmitterMode.tsx` — absolute-deadline bit scheduling, full-screen flash
- `src/components/ReceiverMode.tsx` — rAF sampling loop, real timestamps, UI only
- `scripts/test-protocol.mjs` — channel simulator (the source of truth for decoder changes)

### Hard-won constraints (see tasks/lessons.md)
- Never decode by sample counts — only by real timestamps (autobaud absorbs drift)
- Never use absolute/noise-based luminosity thresholds — camera auto-exposure
  decays constant levels; threshold must scale with recent signal amplitude
- Max 3 identical consecutive bits on the wire (bit stuffing) or auto-exposure
  erases the signal
- Emitter must schedule bits on absolute deadlines, not relative sleeps

## Workflow

1. Read `tasks/lessons.md` — apply all lessons before touching anything
2. Read `tasks/todo.md` — understand current state
3. If neither exists, create them before starting

Follow the full workflow defined in `~/.claude/CLAUDE.md` (plan → implement → verify → learn).
