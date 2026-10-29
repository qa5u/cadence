# Cadence

Paste a sales or business call transcript and get back a set of call notes: summary, key points, objections, action items, dated calendar events, and a next step.

Built for [TODO: hackathon track, e.g. "Best Apps & Agents"].

- Demo: [TODO: demo URL]
- Video: [TODO: video URL]
- Repo: [TODO: repo URL]

## What it does

Most call notes are written after the fact, badly, or not at all. Cadence reads the transcript you already have and pulls out the parts a rep needs the next morning: what was agreed, what the buyer pushed back on, who owes what, and when the next meeting is.

The awkward part of transcript tooling is that people paste the wrong thing. So the first thing Cadence does is check whether the text is actually a call with back-and-forth between two or more people. An email, a blog post, or a block of code gets rejected with a short reason instead of being turned into fake notes.

## How it works

The app is a Next.js App Router project. The browser holds the transcript and the note UI; the model never runs in the browser.

1. You paste or drop a transcript into the landing page (`app/page.tsx`).
2. The page sends two prompts, in order, to our own route at `/api/analyze`.
3. That route (`app/api/analyze/route.ts`) is the only thing that talks to Nebius Token Factory. It forwards the prompt, requests JSON, and returns the parsed object.
4. The first prompt is a pass/fail check (`is_call`). If it fails, the flow stops. If it passes, the second prompt extracts the notes and resolves relative dates ("by Thursday", "Friday the 8th") against today's date.
5. The result opens in a notebook-style overlay, with draggable calendar and to-do widgets when there are events or action items. Notes are kept in the browser (localStorage, with a cookie fallback).

```
browser (page.tsx)
   │  POST { prompt }
   ▼
/api/analyze (route.ts)
   │  POST /v1/chat/completions
   ▼
Nebius Token Factory  →  nvidia/nemotron-3-super-120b-a12b
```

One thing to know if you touch the route: with JSON mode on and thinking left enabled, the model can spend the whole token budget in its reasoning field and return `content: null`. We set `chat_template_kwargs: { enable_thinking: false }` so the JSON lands in `content` directly.

## NVIDIA model and Nebius

We use one model: `nvidia/nemotron-3-super-120b-a12b`, served through Nebius Token Factory's OpenAI-compatible endpoint at `https://api.tokenfactory.nebius.com/v1`.

It's a mixture-of-experts model with roughly 12B parameters active per token, out of 120B total, and a 256K context window. That active-parameter count is the reason we picked it: it stays fast and cheap per call while still being a large model, and the long context means a full transcript fits without chunking. We compared it against the smaller NVIDIA Nemotron Nano variant, which was cheaper but less reliable at the relative-date rules, so we went with the Super.

Both model calls go through `/api/analyze`, which uses the standard `chat/completions` endpoint with `response_format: { type: "json_object" }`. No SDK, no other Nebius services. The API key stays on the server; it is never sent to the browser.

## Setup

You need Node 20+ and pnpm. The repo pins pnpm 10.33.2.

```bash
pnpm install
```

Create `.env.local` in the project root (it's gitignored):

| Variable | Required | What it is |
| --- | --- | --- |
| `NEBIUS_API_KEY` | yes | Nebius Token Factory API key, used only by the server route |
| `NEBIUS_MODEL` | no | Overrides the model ID. Defaults to `nvidia/nemotron-3-super-120b-a12b` |

```bash
pnpm dev
```

Open http://localhost:3000. Drop a `.txt`, `.md`, `.vtt`, `.srt`, or `.csv` transcript into the box, or paste text directly. There's a "Try an example call" link if you don't have one handy.

Other scripts:

```bash
pnpm build   # production build
pnpm start   # serve the production build
pnpm lint    # eslint
```

## Example

Input (shortened):

```
Maya (Northwind): If you commit to 50 seats annually I can do $34.
Dan (Acme): Probably, but I need sign-off from our VP, Priya. Can you send a one-pager by Thursday?
Maya: Sure. Let's meet Friday the 8th to review.
```

Output is a note with a title and summary, the people and companies involved, a sentiment label, key points, the objections raised ($40 vs $34, the sign-off, the security review), action items, calendar events resolved to real dates, and a one-line next step.

## Layout

- `app/page.tsx`: landing page, transcript input, the two-call analysis flow, note/save wiring.
- `app/api/analyze/route.ts`: server route that calls Nebius Token Factory.
- `components/NoteView.tsx`: the notebook note plus the draggable calendar and to-do widgets.
- `components/SavedNotes.tsx`: the saved-notes drawer.
- `types/index.ts`: the `Note` and `CalEvent` shapes.
- `app/globals.css`: styles.

## Known issues

- Notes live only in your browser (localStorage, falling back to cookies). There are no accounts and no server storage, so clearing site data loses them, and they don't sync across devices.
- The transcript sent to the model is capped at 30,000 characters for extraction and 6,000 for the call check, and uploads are limited to 2 MB. Long calls get truncated.
- There's no auth. Anyone with the URL can spend your Nebius credits, so don't leave a funded key on a public deploy.
- No automated tests yet; `pnpm lint` and `pnpm build` are the only checks.

## License

[TODO: add a LICENSE file and name the license here]
