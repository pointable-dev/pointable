import type { Edit, Location, Target, TextResult, UndoResult, WriteResult } from "../shared/types.ts";

const base = new URL(".", import.meta.url).pathname;

async function post<T>(route: string, data: unknown): Promise<T> {
  const res = await fetch(base + route, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  locate: (targets: Target[]) => post<Location[]>("locate", { targets }),
  write: (edits: Edit[]) => post<WriteResult>("write", { edits }),
  undo: () => post<UndoResult>("undo", {}),
  text: (before: string, after: string, choice?: { file: string; start: number }) => post<TextResult>("text", { before, after, choice }),
  status: async (): Promise<{ root: string; undo: number }> => (await fetch(base + "status")).json(),
  /** Vite's own endpoint for opening a file at a line in the developer's editor. */
  open: (file: string, line: number) => fetch(`/__open-in-editor?file=${encodeURIComponent(`${file}:${line}`)}`),
};
