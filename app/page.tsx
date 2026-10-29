"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import NoteView from "../components/NoteView";
import SavedNotes from "../components/SavedNotes";
import type { Note, LoaderType } from "../types";

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      size?: "normal" | "compact" | "flexible" | "invisible";
      execution?: "render" | "execute";
      callback?: (token: string) => void;
      "error-callback"?: () => void;
      "timeout-callback"?: () => void;
    }
  ) => string;
  execute: (id: string) => void;
  reset: (id: string) => void;
  remove: (id: string) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const EXAMPLE_CALL = `Maya (Northwind): Thanks for jumping on, Dan. Last time you said onboarding takes your reps six weeks.
Dan (Acme): Right, and pricing is the sticking point. $40 a seat is more than we pay now.
Maya: Fair. If you commit to 50 seats annually I can do $34. Would that work with your budget?
Dan: Probably, but I need sign-off from our VP, Priya. Can you send a one-pager by Thursday?
Maya: Absolutely. I'll also set up a pilot for the support team. Let's meet Friday the 8th to review.
Dan: Sounds good. Security review is my other worry.
Maya: I'll include our SOC 2 report.`;

interface State {
  text: string;
  wordCount: number;
  busy: boolean;
  status: { message: string; error: boolean; loader: LoaderType } | null;
  note: Note | null;
}

function todayContext(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  return `Today is ${weekday}, ${ymd}.`;
}

function cleanEvents(v: unknown): { date: string; time?: string; title: string; owner?: string }[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((e) => {
    if (!e || typeof e !== "object") return [];
    const o = e as Record<string, unknown>;
    const date = typeof o.date === "string" ? o.date.trim().slice(0, 10) : "";
    const title = typeof o.title === "string" ? o.title.trim() : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !title) return [];
    const time = typeof o.time === "string" && /^\d{2}:\d{2}$/.test(o.time.trim()) ? o.time.trim() : undefined;
    const owner = typeof o.owner === "string" && o.owner.trim() ? o.owner.trim() : undefined;
    return [{ date, time, title, owner }];
  });
}

function ck(name: string): string | null {
  const m = document.cookie.split("; ").find((r) => r.startsWith(name + "="));
  return m ? m.slice(name.length + 1) : null;
}

function loadNotes(): Note[] {
  try {
    let s = "", i = 0, v: string | null;
    while ((v = ck("cad" + i)) !== null) { s += v; i++; }
    if (s) return JSON.parse(decodeURIComponent(s));
  } catch { /* ignore */ }
  try { return JSON.parse(localStorage.getItem("cad") || "[]"); } catch { return []; }
}

function saveNoteToStorage(note: Note) {
  try {
    const notes = loadNotes();
    notes.unshift(note);
    localStorage.setItem("cad", JSON.stringify(notes));
  } catch { /* ignore */ }
}

export default function Home() {
  const [state, setState] = useState<State>({
    text: "",
    wordCount: 0,
    busy: false,
    status: null,
    note: null,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<string | null>(null);
  const tsBoxRef = useRef<HTMLDivElement>(null);
  const tsWidgetRef = useRef<string | null>(null);
  const tsResolveRef = useRef<((token: string) => void) | null>(null);
  const tsRejectRef = useRef<((err: Error) => void) | null>(null);
  const [tsLoaded, setTsLoaded] = useState(false);

  const words = (s: string) => (s.trim().match(/\S+/g) || []).length;

  useEffect(() => {
    if (!tsLoaded || !TURNSTILE_SITE_KEY || tsWidgetRef.current) return;
    const el = tsBoxRef.current;
    const ts = window.turnstile;
    if (!el || !ts) return;
    const settle = (err: Error) => {
      const reject = tsRejectRef.current;
      tsResolveRef.current = null;
      tsRejectRef.current = null;
      reject?.(err);
    };
    tsWidgetRef.current = ts.render(el, {
      sitekey: TURNSTILE_SITE_KEY,
      size: "invisible",
      execution: "execute",
      callback: (token) => {
        const resolve = tsResolveRef.current;
        tsResolveRef.current = null;
        tsRejectRef.current = null;
        resolve?.(token);
      },
      "error-callback": () => settle(new Error("Verification failed. Reload and try again.")),
      "timeout-callback": () => settle(new Error("Verification timed out. Try again.")),
    });
  }, [tsLoaded]);

  function getTurnstileToken(): Promise<string> {
    if (!TURNSTILE_SITE_KEY) return Promise.resolve("");
    const ts = window.turnstile;
    const id = tsWidgetRef.current;
    if (!ts || !id) {
      return Promise.reject(new Error("Verification is still loading. Try again in a moment."));
    }
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        tsResolveRef.current = null;
        tsRejectRef.current = null;
        reject(new Error("Verification timed out. Try again."));
      }, 20000);
      tsResolveRef.current = (token) => {
        clearTimeout(timer);
        resolve(token);
      };
      tsRejectRef.current = (err) => {
        clearTimeout(timer);
        reject(err);
      };
      try {
        ts.reset(id);
        ts.execute(id);
      } catch {
        clearTimeout(timer);
        tsResolveRef.current = null;
        tsRejectRef.current = null;
        reject(new Error("Verification failed. Reload and try again."));
      }
    });
  }

  async function callModel(prompt: string): Promise<Record<string, unknown>> {
    const send = async (auth: Record<string, string>) => {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, ...auth }),
      });
      const next = res.headers.get("x-cadence-session");
      if (next) sessionRef.current = next;
      const data = await res.json();
      return { res, data };
    };

    let out = sessionRef.current
      ? await send({ sessionToken: sessionRef.current })
      : await send({ turnstileToken: await getTurnstileToken() });

    if (out.res.status === 403 && sessionRef.current) {
      sessionRef.current = null;
      out = await send({ turnstileToken: await getTurnstileToken() });
    }

    if (!out.res.ok) {
      throw new Error(out.data?.error || `API call failed (${out.res.status})`);
    }
    return out.data as Record<string, unknown>;
  }

  const run = async () => {
    const text = state.text;
    if (!text.trim() || state.busy) return;

    setState((s) => ({ ...s, busy: true }));
    setStatus("Checking this is a call", false, "dots");

    try {
      const g = await callModel(`Reply with ONLY JSON: {"is_call":boolean,"reason":"one short sentence"}. is_call is true only if the text below is a transcript (or near-verbatim notes) of a sales call or business call/meeting between two or more people. Emails, articles, code, stories and random text are false.\n\nTEXT:\n${text.slice(0, 6000)}`);

      if (!g || !g.is_call) {
        setState((s) => ({ ...s, busy: false }));
        setStatus("That doesn't look like a sales or business call. " + (g?.reason || "") + " Paste a transcript with the back-and-forth.", true);
        return;
      }

      setStatus("Sifting through the conversation…", false, "bar");
      setStatus("Finding key points and objections…", false, "dots");
      setStatus("Drafting your notes", false, "grid");

      const n = await callModel(`${todayContext()}
You turn a sales or business call transcript into notes. Reply with ONLY JSON: {"title":"short title","summary":"2-3 sentences","who":["people and companies"],"sentiment":"positive|neutral|negative|mixed","key_points":["..."],"objections":["..."],"action_items":["owner: task (due date if stated)"],"events":[{"date":"YYYY-MM-DD","time":"HH:MM","title":"what happens","owner":"who owns it"}],"next_step":"one sentence"}.

Rules for "events": extract every concrete meeting, deadline, follow-up, or dated commitment that the transcript states (e.g. "by Thursday", "Friday the 8th", "next week"). Resolve relative dates against TODAY above so they land on the correct upcoming calendar date. Work week by week: "Friday the 8th" means the next date that is BOTH a Friday AND the 8th — do not just take the next 8th; if no such date is near, search forward until both match. Never pick a date in the past. Use date-only "YYYY-MM-DD"; add "time" only when a time is stated (24-hour). If a dated item is also an action item, include it in both arrays. Skip anything with no resolvable date.
Example: Today is Wednesday, 2026-10-28. "Can you send it by Thursday?" → {"date":"2026-10-29"}. "Let's meet Friday the 8th" → the next Friday whose day-of-month is 8.
Use only what is in the transcript; use empty arrays when nothing applies.

TRANSCRIPT:
${text.slice(0, 30000)}`);

      const raw = n as Record<string, unknown>;
      const rec: Note = {
        id: Date.now(),
        at: Date.now(),
        title: typeof raw.title === "string" ? raw.title : "",
        summary: typeof raw.summary === "string" ? raw.summary : "",
        who: Array.isArray(raw.who) ? raw.who.map(String) : [],
        sentiment: typeof raw.sentiment === "string" ? raw.sentiment : "",
        key_points: Array.isArray(raw.key_points) ? raw.key_points.map(String) : [],
        objections: Array.isArray(raw.objections) ? raw.objections.map(String) : [],
        action_items: Array.isArray(raw.action_items) ? raw.action_items.map(String) : [],
        events: cleanEvents(raw.events),
        next_step: typeof raw.next_step === "string" ? raw.next_step : "",
      };
      saveNoteToStorage(rec);
      setState((s) => ({ ...s, busy: false, note: rec }));
      setStatus(null);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Something went wrong. Try again.";
      setState((s) => ({ ...s, busy: false }));
      setStatus(message, true);
    }
  };

  function setStatus(message: string | null, error = false, loader: LoaderType = null) {
    setState((s) => ({ ...s, status: message ? { message, error, loader } : null }));
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    const w = words(val);
    setState((s) => ({ ...s, text: val, wordCount: w }));
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, window.innerHeight * 0.28) + "px";
  };

  const readFile = async (file: File) => {
    if (!file) return;
    if (file.size > 2e6) { setStatus("That file is over 2 MB. Paste the relevant part instead.", true); return; }
    const text = await file.text();
    const w = words(text);
    setState((s) => ({ ...s, text, wordCount: w }));
    setStatus(null);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); (e.currentTarget as HTMLDivElement).classList.add("drag"); };
  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => { (e.currentTarget as HTMLDivElement).classList.remove("drag"); };
  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => { e.preventDefault(); (e.currentTarget as HTMLDivElement).classList.remove("drag"); readFile(e.dataTransfer.files[0]); };

  return (
    <>
      <main id="landing">
        <Doodles />
        <ClefMascot />
        <h1>
          Every sales call,<br />
          turned into <em>action.</em>
        </h1>
        <p className="sub">Paste or upload a sales or business call transcript. Cadence checks it, then writes the notes.</p>
        <div className="stage">
          <div className="box" id="box" onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
            <textarea
              id="t"
              placeholder="Paste your transcript here, or drop a .txt file…"
              aria-label="Transcript"
              value={state.text}
              onChange={handleTextChange}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !state.busy && state.wordCount >= 20) run(); }}
            />
            <div className="bar">
              <button className="chip" type="button" onClick={() => fileInputRef.current?.click()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                Upload file
              </button>
              <input ref={fileInputRef} type="file" accept=".txt,.md,.vtt,.srt,.csv,text/*" hidden onChange={(e) => readFile(e.target.files?.[0] ?? null as unknown as File)} />
              <span className="count">{state.wordCount.toLocaleString()} word{state.wordCount !== 1 ? "s" : ""}</span>
              <button
                id="go"
                type="button"
                disabled={state.busy || state.wordCount < 20}
                aria-label="Make notes"
                onClick={run}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
              </button>
            </div>
          </div>
          {state.status && (
            <div className={`status ${state.status.message ? "on" : ""} ${state.status.error ? "err" : ""}`} role="status">
              {state.status.message}
              <Loader type={state.status.loader} />
            </div>
          )}
        </div>
        <button className="try" type="button" onClick={() => { setState((s) => ({ ...s, text: EXAMPLE_CALL, wordCount: words(EXAMPLE_CALL) })); }}>Try an example call</button>
      </main>
      {state.note && <NoteView key={state.note.id} note={state.note} onClose={() => setState((s) => ({ ...s, note: null }))} />}
      <SavedNotes onNoteSelect={(note) => setState((s) => ({ ...s, note }))} />
      {TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={() => setTsLoaded(true)}
        />
      )}
      <div ref={tsBoxRef} />
    </>
  );
}

function Loader({ type }: { type: LoaderType }) {
  if (type === "dots") return <span className="ld ld-dots"><i></i><i></i><i></i></span>;
  if (type === "bar") return <span className="ld ld-bar" />;
  if (type === "grid") return <span className="ld ld-grid"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>;
  return null;
}

function ClefMascot() {
  return (
    <div className="clef-wrap" aria-label="Clef, the Cadence mascot" role="img">
      <img className="clef-gif wave" src="/mascot_wave.gif" alt="Waving mascot" /* eslint-disable-line @next/next/no-img-element */ />
      <img className="clef-gif congrats" src="/mascot_congratulations.gif" alt="Congratulations mascot" /* eslint-disable-line @next/next/no-img-element */ />
    </div>
  );
}

const DOODLE_SHAPES = [
  <>
    <path className="y" d="M20 30Q20 18 34 18H86Q100 18 100 30V62Q100 74 86 74H60L40 94V74H34Q20 74 20 62Z" />
    <path d="M36 38H84M36 50H72" />
    <path stroke="none" fill="#F6C744" d="M104 8l3 8 8 3-8 3-3 8-3-8-8-3 8-3z" />
  </>,
  <>
    <path className="m" d="M28 42C26 32 34 26 41 30L50 40C53 44 51 49 46 51C50 61 58 69 70 75C72 71 76 69 80 71L90 79C95 83 91 93 80 93C48 93 22 68 28 42Z" />
    <path d="M70 34Q88 36 90 54M72 18Q102 22 104 56" />
  </>,
  <>
    <rect className="b" x="20" y="14" width="66" height="84" rx="9" />
    <path d="M32 38l5 6 9-11M32 62l5 6 9-11M58 40H74M58 64H74M32 86H70" />
    <path className="y" d="M84 78l22-22 8 8-22 22-11 3z" />
  </>,
];

type DoodleBox = { x: number; y: number; w: number; h: number };

function Doodles() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const svgs = Array.from(host.querySelectorAll<SVGSVGElement>(".dd"));
    const groupA = svgs.slice(0, svgs.length / 2);
    const groupB = svgs.slice(svgs.length / 2);
    let timer: ReturnType<typeof setTimeout>;

    const place = () => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const edge = 8;
      const gap = 18;

      const rects = Array.from(
        document.querySelectorAll<HTMLElement>("#landing h1, #landing .sub, #landing .stage, #landing .try, #landing .clef-wrap")
      )
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && r.height > 0);

      const content = rects.length
        ? {
            left: Math.min(...rects.map((r) => r.left)),
            top: Math.min(...rects.map((r) => r.top)),
            right: Math.max(...rects.map((r) => r.right)),
            bottom: Math.max(...rects.map((r) => r.bottom)),
          }
        : { left: W / 2 - 340, top: H / 2 - 260, right: W / 2 + 340, bottom: H / 2 + 260 };

      const placed: DoodleBox[] = [];
      const overlap = (a: DoodleBox, b: DoodleBox, pad = 0) =>
        a.x < b.x + b.w + pad &&
        a.x + a.w + pad > b.x &&
        a.y < b.y + b.h + pad &&
        a.y + a.h + pad > b.y;

      const free = (box: DoodleBox) => {
        if (box.x < edge || box.y < edge || box.x + box.w > W - edge || box.y + box.h > H - edge) return false;
        if (overlap(box, { x: content.left - 4, y: content.top - 4, w: content.right - content.left + 8, h: content.bottom - content.top + 8 })) return false;
        return !placed.some((p) => overlap(box, p, 10));
      };

      const attempt = (size: number, baseX: number, baseY: number) => {
        for (let t = 0; t < 30; t++) {
          const box = {
            x: baseX + (t ? rnd(-14, 14) : 0),
            y: baseY + (t ? rnd(-14, 14) : 0),
            w: size,
            h: size,
          };
          if (!free(box)) continue;
          placed.push(box);
          return box;
        }
        return null;
      };

      const paint = (d: SVGSVGElement, box: DoodleBox, order: number) => {
        d.style.display = "";
        d.style.left = `${box.x}px`;
        d.style.top = `${box.y}px`;
        d.style.width = `${box.w}px`;
        d.style.rotate = `${rnd(-22, 22)}deg`;
        d.style.setProperty("--o", String(W < 560 ? rnd(0.4, 0.62) : rnd(0.55, 0.95)));
        d.style.animationDelay = `${(0.5 + order * 0.13).toFixed(2)}s, ${(-rnd(0, 7)).toFixed(2)}s`;
      };

      const leftRoom = content.left - gap - edge;
      const rightRoom = W - content.right - gap - edge;
      const sideMode = leftRoom >= 40 && rightRoom >= 40;

      const columns = sideMode
        ? [
            { els: groupA, side: "l" as const, room: leftRoom },
            { els: groupB, side: "r" as const, room: rightRoom },
          ]
        : [
            { els: groupA, side: "l" as const, room: content.top - gap - edge },
            { els: groupB, side: "r" as const, room: H - content.bottom - gap - edge },
          ];

      let order = 0;
      columns.forEach((col) => {
        const els = [...col.els].sort(() => Math.random() - 0.5);
        els.forEach((d, i) => {
          let size = sideMode ? (W < 900 ? rnd(52, 78) : rnd(68, 104)) : rnd(36, 56);
          size = Math.min(size, col.room - 4);
          if (size < 28) {
            d.style.display = "none";
            return;
          }

          let x: number;
          let y: number;

          const outward = rnd(0, Math.max(0, col.room - size));

          if (sideMode) {
            const cy = content.top + (content.bottom - content.top) * ([0.14, 0.5, 0.86][i] + rnd(-0.09, 0.09));
            x = col.side === "l" ? content.left - gap - size - outward : content.right + gap + outward;
            y = cy - size / 2;
          } else {
            const cx = W * [0.16, 0.5, 0.84][i] + rnd(-26, 26);
            x = cx - size / 2;
            y = col.side === "l" ? content.top - gap - size - outward : content.bottom + gap + outward;
          }

          const box = attempt(size, x, y);
          if (!box) {
            d.style.display = "none";
            return;
          }
          paint(d, box, order++);
        });
      });
    };

    const run = () => {
      clearTimeout(timer);
      timer = setTimeout(place, 120);
    };

    place();
    window.addEventListener("resize", run);
    return () => {
      window.removeEventListener("resize", run);
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="doodles" aria-hidden="true" ref={hostRef}>
      {DOODLE_SHAPES.map((shape, i) => (
        <svg key={`a-${i}`} className={`dd d${i + 1}`} viewBox="0 0 120 120">{shape}</svg>
      ))}
      {DOODLE_SHAPES.map((shape, i) => (
        <svg key={`b-${i}`} className={`dd d${i + 1}`} viewBox="0 0 120 120">{shape}</svg>
      ))}
    </div>
  );
}
