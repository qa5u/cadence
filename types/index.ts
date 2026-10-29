export interface CalEvent {
  date: string;
  time?: string;
  title: string;
  owner?: string;
}

export interface Note {
  id: number;
  at: number;
  title: string;
  summary: string;
  who: string[];
  sentiment: string;
  key_points: string[];
  objections: string[];
  action_items: string[];
  events?: CalEvent[];
  next_step: string;
}

export type LoaderType = "dots" | "bar" | "grid" | null;
