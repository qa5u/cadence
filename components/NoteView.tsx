"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CalEvent, Note } from "@/types";

interface TodoItem {
  id: number;
  text: string;
  done: boolean;
}

interface Vec {
  x: number;
  y: number;
}

export default function NoteView({ note, onClose }: { note: Note; onClose: () => void }) {
  const [calPos, setCalPos] = useState<Vec | null>(null);
  const [todoPos, setTodoPos] = useState<Vec | null>(null);
  const [todoItems, setTodoItems] = useState<TodoItem[]>(() =>
    parseActions(note.action_items).map((a, i) => ({ id: i + 1, text: a.task, done: false })),
  );
  const [newTask, setNewTask] = useState("");
  const nextIdRef = useRef(todoItems.length + 1);
  const _initId = () => { nextIdRef.current += 1; return nextIdRef.current; };
  const showWidgets = note.action_items?.length > 0 || (note.events?.length ?? 0) > 0;

  useEffect(() => {
    document.body.classList.add("show");
    return () => document.body.classList.remove("show");
  }, []);

  // Spawn both widgets in random, non-overlapping spots on the right side of the notebook.
  useLayoutEffect(() => {
    if (!showWidgets) return;
    const cal = document.getElementById("cal");
    const todo = document.getElementById("todo");
    if (!cal || !todo) return;
    const placed = placeWidgets(cal, todo);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCalPos(placed.cal);
    setTodoPos(placed.todo);
  }, [showWidgets]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const addTask = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const t = newTask.trim();
    if (!t) return;
    setTodoItems((prev) => [{ id: _initId(), text: t, done: false }, ...prev]);
    setNewTask("");
  }, [newTask]);

  const toggleTask = useCallback((id: number) => {
    setTodoItems((prev) => prev.map((i) => i.id === id ? { ...i, done: !i.done } : i));
  }, []);

  const deleteTask = useCallback((id: number) => {
    setTodoItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const doneCount = todoItems.filter((i) => i.done).length;

  return (
    <>
      <div id="note-view" className="open" aria-live="polite">
        <button className="note-close" type="button" onClick={onClose}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          Back
        </button>
        <div className="sheet">
          <div className="note-sheet">
            <h1>{note.title || "Call notes"}</h1>
            <div className="gap" />
            {note.summary && (
              <div className="callout"><p>{note.summary}</p></div>
            )}
            <div className="gap" />
            {note.key_points?.length > 0 && (
              <>
                <h2>Key Points</h2>
                <ul>
                  {note.key_points.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </>
            )}
            {note.objections?.length > 0 && (
              <>
                <h2>Objections</h2>
                <ul>
                  {note.objections.map((x, i) => <li key={i}>{x}</li>)}
                </ul>
              </>
            )}
            {note.action_items?.length > 0 && (
              <>
                <h2>Action Items</h2>
                <ul className="check">
                  {todoItems.map((item) => (
                    <li key={item.id} className={item.done ? "on" : ""} onClick={() => toggleTask(item.id)}>
                      <CheckIcon checked={item.done} />
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {note.next_step && (
              <>
                <hr />
                <h3>Next Step</h3>
                <blockquote>{note.next_step}</blockquote>
              </>
            )}
          </div>
        </div>
      </div>

      {showWidgets && (
        <>
          <DraggableWidget
            id="cal"
            pos={calPos}
            onPosChange={setCalPos}
            title={`Calendar${note.events?.length ? `  ${note.events.length}` : ""}`}
          >
            <CalendarBody events={note.events ?? []} />
          </DraggableWidget>
          <DraggableWidget
            id="todo"
            pos={todoPos}
            onPosChange={setTodoPos}
            title={`To-do  ${todoItems.length - doneCount} left`}
          >
            <TodoBody
              items={todoItems}
              newTask={newTask}
              onTaskChange={setNewTask}
              onAdd={addTask}
              onToggle={toggleTask}
              onDelete={deleteTask}
            />
          </DraggableWidget>
        </>
      )}
    </>
  );
}

/* ---- Check icon ---- */
function CheckIcon({ checked }: { checked: boolean }) {
  if (!checked) {
    return <span className="circle-empty" />;
  }
  return (
    <span className="circle-checked">
      <svg viewBox="0 0 12 10" width={10} height={8}>
        <path d="M1 5L4 8L11 1" stroke="currentColor" strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

/* ---- Calendar body ---- */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${pad2(m + 1)}-${pad2(d)}`;
}

function parseDateKey(v: string): Date | null {
  const [y, m, d] = v.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function CalendarBody({ events }: { events: CalEvent[] }) {
  const today = new Date();
  const firstEvent = events
    .map((e) => parseDateKey(e.date))
    .filter((d): d is Date => d !== null)
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const [vm, setVm] = useState(firstEvent?.getMonth() ?? today.getMonth());
  const [vy, setVy] = useState(firstEvent?.getFullYear() ?? today.getFullYear());
  const [sel, setSel] = useState<Date | null>(firstEvent);

  const byDay = events.reduce<Record<string, CalEvent[]>>((acc, e) => {
    (acc[e.date] ||= []).push(e);
    return acc;
  }, {});

  const first = new Date(vy, vm, 1);
  const fd = first.getDay();
  const dim = new Date(vy, vm + 1, 0).getDate();
  const mName = first.toLocaleString("en", { month: "long", year: "numeric" });
  const isToday = (d: number) => d === today.getDate() && vm === today.getMonth() && vy === today.getFullYear();

  const selKey = sel ? dateKey(sel.getFullYear(), sel.getMonth(), sel.getDate()) : "";
  const selEvents = selKey ? [...(byDay[selKey] ?? [])].sort((a, b) => (a.time ?? "").localeCompare(b.time ?? "")) : [];

  const prev = () => { let m = vm - 1; let y = vy; if (m < 0) { m = 11; y--; } setVm(m); setVy(y); };
  const next = () => { let m = vm + 1; let y = vy; if (m > 11) { m = 0; y++; } setVm(m); setVy(y); };

  return (
    <>
      <div className="cn">
        <button type="button" onClick={prev} aria-label="Previous month">‹</button>
        <b style={{ fontSize: 14 }}>{mName}</b>
        <button type="button" onClick={next} aria-label="Next month">›</button>
      </div>
      <div className="cg">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, idx) => (
          <div key={idx} className="d">{d}</div>
        ))}
        {Array.from({ length: fd }, (_, i) => (
          <button key={`p${i}`} type="button" className="o" disabled>&nbsp;</button>
        ))}
        {Array.from({ length: dim }, (_, i) => {
          const d = i + 1;
          const cls: string[] = [];
          if (isToday(d)) cls.push("t");
          if (byDay[dateKey(vy, vm, d)]) cls.push("ev");
          return (
            <button key={d} type="button" className={cls.join(" ")} onClick={() => setSel(new Date(vy, vm, d))}>
              {d}
            </button>
          );
        })}
        {Array.from({ length: (7 - ((fd + dim) % 7)) % 7 }, (_, i) => (
          <button key={`e${i}`} type="button" className="o" disabled>&nbsp;</button>
        ))}
      </div>
      <div id="sel">
        {sel ? (
          <>
            <b>{sel.toLocaleDateString("en", { weekday: "long", day: "numeric", month: "long" })}</b>
            {selEvents.length > 0 ? (
              <ul className="evl">
                {selEvents.map((e, i) => (
                  <li key={i}>
                    {e.time && <time>{e.time}</time>}
                    <span>{e.title}{e.owner ? ` — ${e.owner}` : ""}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <span> — no events</span>
            )}
          </>
        ) : "Pick a date"}
      </div>
    </>
  );
}

/* ---- Todo body ---- */
function TodoBody({ items, newTask, onTaskChange, onAdd, onToggle, onDelete }: {
  items: TodoItem[];
  newTask: string;
  onTaskChange: (v: string) => void;
  onAdd: (e: React.FormEvent) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <>
      <form onSubmit={onAdd}>
        <input
          type="text"
          placeholder="Add a task"
          aria-label="New task"
          value={newTask}
          onChange={(e) => onTaskChange(e.target.value)}
          autoComplete="off"
        />
        <button type="submit">Add</button>
      </form>
      <ul id="tl">
        {items.length === 0 && <li className="empty">Nothing to do. Add a task above.</li>}
        {items.map((it) => (
          <li key={it.id} className={it.done ? "done" : ""}>
            <input
              type="checkbox"
              checked={it.done}
              aria-label="Done"
              onChange={() => onToggle(it.id)}
            />
            <span onClick={() => onToggle(it.id)}>{it.text}</span>
            <button className="x" aria-label="Delete task" onClick={() => onDelete(it.id)}>×</button>
          </li>
        ))}
      </ul>
    </>
  );
}

/* ---- Draggable widget — pointer-events based, no refs needed for state ---- */
function DraggableWidget({
  id, pos, onPosChange, title, children,
}: {
  id: string;
  pos: Vec | null;
  onPosChange: (p: Vec) => void;
  title: string;
  children: React.ReactNode;
}) {
  const dragState = useRef<{ active: boolean; startX: number; startY: number; origX: number; origY: number; el: HTMLElement | null }>({
    active: false, startX: 0, startY: 0, origX: 0, origY: 0, el: null,
  });

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only drag from header
    const el = (e.currentTarget as HTMLElement).closest(".w") as HTMLElement | null;
    if (!el) return;

    dragState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      origX: el.offsetLeft,
      origY: el.offsetTop,
      el,
    };

    el.setPointerCapture?.(e.pointerId);
    el.classList.add("drag");

    // Bring the grabbed widget above its sibling, but always above #note-view (z-index 100).
    document.querySelectorAll<HTMLElement>(".w").forEach((w) => {
      w.style.zIndex = w === el ? "160" : "150";
    });
  }, []);

  const handlePointerMove = useCallback((e: PointerEvent) => {
    const state = dragState.current;
    if (!state.active || !state.el) return;

    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    // Require small movement to count as drag (prevents click-from-header becoming drag)
    if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;

    const el = state.el;
    const nx = Math.max(0, Math.min(window.innerWidth - el.offsetWidth, state.origX + dx));
    const ny = Math.max(0, Math.min(window.innerHeight - el.offsetHeight, state.origY + dy));
    el.style.left = nx + "px";
    el.style.top = ny + "px";
    onPosChange({ x: nx, y: ny });
  }, [onPosChange]);

  const handlePointerUp = useCallback((e: PointerEvent) => {
    const state = dragState.current;
    state.active = false;
    const el = state.el;
    state.el = null;
    if (!el) return;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    el.classList.remove("drag");
  }, []);

  useEffect(() => {
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  return (
    <div
      id={id}
      className="w"
      style={{
        position: "fixed",
        left: pos?.x ?? 0,
        top: pos?.y ?? 0,
        visibility: pos ? "visible" : "hidden",
      }}
      role="complementary"
      aria-label={title}
    >
      <div className="wh" onPointerDown={handlePointerDown}>
        <span className="grip" />
        <b>{title}</b>
      </div>
      <div className="wb">{children}</div>
    </div>
  );
}

/* Place two widgets randomly in the free right-hand area, guaranteed not to overlap. */
function placeWidgets(calEl: HTMLElement, todoEl: HTMLElement) {
  const margin = 16;
  const gap = 24;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const calW = calEl.offsetWidth;
  const calH = calEl.offsetHeight;
  const todoW = todoEl.offsetWidth;
  const todoH = todoEl.offsetHeight;

  // Keep both widgets over the right side of the notebook, never further left than needed.
  const bandRight = vw - margin;
  const widest = Math.max(calW, todoW);
  let bandLeft = Math.round(vw * 0.6);
  if (bandRight - bandLeft < widest) bandLeft = Math.max(margin, bandRight - widest);

  const randX = (w: number) => {
    const hi = Math.max(bandLeft, bandRight - w);
    return Math.round(bandLeft + Math.random() * (hi - bandLeft));
  };

  const usableH = vh - margin * 2;
  const total = calH + gap + todoH;
  let calY: number;
  let todoY: number;

  if (total <= usableH) {
    const slack = usableH - total;
    const start = margin + Math.random() * slack;
    const extra = Math.random() * (gap / 2);
    if (Math.random() < 0.5) {
      calY = start;
      todoY = Math.min(vh - margin - todoH, start + calH + gap + extra);
    } else {
      todoY = start;
      calY = Math.min(vh - margin - calH, start + todoH + gap + extra);
    }
  } else {
    // Very short viewport: pin them to opposite ends so they still don't overlap.
    calY = margin;
    todoY = Math.max(margin, vh - margin - todoH);
  }

  return {
    cal: { x: randX(calW), y: Math.round(calY) },
    todo: { x: randX(todoW), y: Math.round(todoY) },
  };
}

function parseActions(arr?: string[]) {
  if (!arr) return [];
  return arr.map((a) => {
    const m = a.match(/^([^:]+?):\s*(.+)$/);
    return m ? { owner: m[1].trim(), task: m[2].trim(), text: a } : { owner: "", task: a, text: a };
  }).filter((x) => x.task);
}
