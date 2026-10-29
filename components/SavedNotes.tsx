"use client";

import { useEffect, useState } from "react";
import type { Note } from "@/types";

const CH = 3400;
const MAX_C = 12;

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

function saveNotes(notes: Note[]) {
  try { localStorage.setItem("cad", JSON.stringify(notes)); } catch { /* cookie fallback */ }
  try {
    let s: string;
    while ((s = encodeURIComponent(JSON.stringify(notes))).length > CH * MAX_C && notes.length > 1) notes.pop();
    for (let i = 0; i < MAX_C; i++) {
      const p = s.slice(i * CH, (i + 1) * CH);
      document.cookie = `cad${i}=${p};max-age=${p ? 31536000 : 0};path=/;SameSite=Lax`;
    }
  } catch { /* ignore */ }
}

interface Props {
  onNoteSelect?: (note: Note) => void;
}

export default function SavedNotes({ onNoteSelect }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNotes(loadNotes()); }, []);

  const openDrawer = () => {
    setDrawerOpen(true);
    document.body.classList.add("drawer");
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    document.body.classList.remove("drawer");
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") closeDrawer(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <>
      <button id="fab" type="button" aria-label="Open saved notes" onClick={openDrawer}>
        Saved notes <b>{notes.length}</b>
      </button>
      <div
        id="veil"
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", opacity: drawerOpen ? 1 : 0, pointerEvents: drawerOpen ? "auto" : "none", transition: "opacity .4s", zIndex: 6 }}
        onClick={closeDrawer}
      />
      <aside
        id="dr"
        aria-label="Saved notes"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "min(400px,92vw)",
          background: "var(--paper)", zIndex: 7,
          translate: drawerOpen ? "0 0" : "100% 0",
          transition: "translate .55s cubic-bezier(.2,.8,.2,1)",
          padding: "calc(22px + env(safe-area-inset-top,0px)) 20px 20px",
          overflow: "auto", borderLeft: "1px solid var(--line)",
        }}
      >
        <h2>Saved notes</h2>
        <small>Kept in this browser&apos;s local storage.</small>
        <div>
          {notes.length === 0 && <p className="empty-drawer">No notes yet.</p>}
          {notes.map((r) => (
            <div key={r.id} className="item">
              <button
                type="button"
                className="o"
                onClick={() => { closeDrawer(); onNoteSelect?.(r); }}
              >
                {r.title || "Call notes"}
              </button>
              <button
                type="button"
                aria-label="Delete"
                onClick={() => {
                  const next = loadNotes().filter((n) => n.id !== r.id);
                  saveNotes(next);
                  setNotes(next);
                }}
                className="x"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
