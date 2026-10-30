# Cadence

Paste a sales or business call transcript and get back a set of call notes: summary, key points, objections, action items, dated calendar events, and a next step.

Built for a hackathon.

- Demo: https://cadence.web.id
- Repo: https://github.com/qa5u/cadence

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
| `TURNSTILE_SECRET_KEY` | no | Turnstile secret. Local dev uses Cloudflare's always-pass test secret; production reads a Worker secret |

```bash
pnpm dev
```

Open http://localhost:3000. Drop a `.txt`, `.md`, `.vtt`, `.srt`, or `.csv` transcript into the box, or paste text directly. There's a "Try an example call" link if you don't have one handy.

Other scripts:

```bash
pnpm build   # production build
pnpm start   # serve the production build
pnpm lint    # eslint
pnpm run deploy  # build and deploy to Cloudflare Workers
```

## Deploy

The app runs on Cloudflare Workers with `@opennextjs/cloudflare` and is attached to the `cadence.web.id` custom domain.

```bash
pnpm exec wrangler login
pnpm exec wrangler secret put NEBIUS_API_KEY
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY
pnpm run deploy
```

`NEBIUS_MODEL` is a plain variable in `wrangler.jsonc`. `NEBIUS_API_KEY` and `TURNSTILE_SECRET_KEY` are Worker secrets, read at runtime by `app/api/analyze/route.ts`.

`pnpm run deploy` hides `.env.local` while it builds, so local secrets are not compiled into the Worker.

`next.config.ts` leaves out Next's experimental `cacheComponents` and `partialPrefetching` flags. With them on, the first request hangs in workerd because of its `setTimeout` implementation.

## Security

- `POST /api/analyze` requires a Cloudflare Turnstile token. The browser gets one per request; the server verifies it against `https://challenges.cloudflare.com/turnstile/v0/siteverify`.
- The route is limited to 10 requests per minute per IP with the Workers rate limiting binding in `wrangler.jsonc`.
- Requests from another origin are rejected, the body is capped at 120 KB, and the prompt is capped at 40,000 characters.
- Upstream errors are logged on the server and returned as a generic message.
- `next.config.ts` sets CSP, HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and `Permissions-Policy` headers.
- The Nebius key stays on the server. The public Turnstile site key is in `next.config.ts`; the secret is a Worker secret.

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
- There are no user accounts. Turnstile and the per-IP limit cut down abuse, but the endpoint still spends credits for anyone who passes the bot check.
- No automated tests yet; `pnpm lint` and `pnpm build` are the only checks.

## License

No license has been chosen yet. The code is not licensed for reuse until one is added.
