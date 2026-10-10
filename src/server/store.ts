import { readFile, writeFile, mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { Edit, Location, Target, TextResult, UndoResult, WriteResult } from "../shared/types.ts";
import { sameValue } from "../shared/selectors.ts";
import { fileFromDevId, region, type Region } from "./source.ts";
import { locate, splice, type Found } from "./locate.ts";
import { escapeFor, findText } from "./text.ts";

interface Batch {
  at: string;
  files: { file: string; before: string; after: string }[];
}

/** Finds and writes edits for one project, and remembers enough to undo them. */
export class Store {
  private undoStack: Batch[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  readonly root: string;
  readonly dir: string;

  constructor(root: string, dir: string) {
    this.root = root;
    this.dir = dir;
  }

  /** Run writes one at a time, so two quick edits to one file never read the same old text. */
  private serial<T>(job: () => Promise<T>): Promise<T> {
    const next = this.queue.then(job, job);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async find(target: Target): Promise<{ reg: Region; text: string; found: Found } | string> {
    const where = fileFromDevId(target.devId, this.root);
    if (typeof where === "string") return where;
    let text: string;
    try {
      text = await readFile(where.file, "utf8");
    } catch {
      return `cannot read ${path.relative(this.root, where.file)}`;
    }
    const reg = region(where.file, text, where.index);
    if (typeof reg === "string") return reg;
    const found = locate(reg, target);
    if (typeof found === "string") return found;
    return { reg, text, found };
  }

  async locate(targets: Target[]): Promise<Location[]> {
    return Promise.all(
      targets.map(async (t) => {
        const r = await this.find(t);
        if (typeof r === "string") return { ok: false as const, reason: r };
        return { ok: true as const, file: r.reg.file, line: r.found.line, declared: !!r.found.decl, value: r.found.value ?? undefined };
      }),
    );
  }

  write(edits: Edit[]): Promise<WriteResult> {
    return this.serial(() => this.writeNow(edits));
  }

  private async writeNow(edits: Edit[]): Promise<WriteResult> {
    const result: WriteResult = { ok: true, written: [], conflicts: [], errors: [] };
    const perFile = new Map<string, { text: string; splices: { start: number; end: number; text: string }[] }>();
    const log: object[] = [];

    for (const [index, edit] of edits.entries()) {
      const r = await this.find(edit);
      if (typeof r === "string") {
        result.errors.push({ index, reason: r });
        continue;
      }
      const { reg, found } = r;
      if (found.value !== null && edit.expect !== undefined && !edit.force && !sameValue(found.value, edit.expect)) {
        result.conflicts.push({ index, file: reg.file, line: found.line, source: found.value, expected: edit.expect });
        continue;
      }
      const s = splice(reg, found, edit.property, edit.value);
      const entry = perFile.get(reg.file) ?? { text: r.text, splices: [] };
      entry.splices.push({ start: s.start + reg.offset, end: s.end + reg.offset, text: s.text });
      perFile.set(reg.file, entry);
      result.written.push({ file: reg.file, line: found.line });
      log.push({
        at: new Date().toISOString(),
        file: path.relative(this.root, reg.file),
        line: found.line,
        selector: edit.path.map((p) => (p.kind === "at" ? `@${p.name} ${p.params}` : p.selector)).join(" › "),
        property: edit.property,
        before: found.value,
        after: edit.value,
      });
    }

    const batch: Batch = { at: new Date().toISOString(), files: [] };
    for (const [file, { text, splices }] of perFile) {
      // Apply from the end of the file backwards so earlier offsets stay valid.
      let after = text;
      for (const s of splices.sort((a, b) => b.start - a.start)) after = after.slice(0, s.start) + s.text + after.slice(s.end);
      if (after === text) continue;
      await writeFile(file, after);
      batch.files.push({ file, before: text, after });
    }
    if (batch.files.length) {
      this.undoStack.push(batch);
      await this.history(log);
    }
    result.ok = !result.conflicts.length && !result.errors.length;
    return result;
  }

  /**
   * Replace visible text where it is written in source. Text written in several places
   * comes back as candidates; the caller picks one and sends it as `choice`.
   */
  text(before: string, after: string, choice?: { file: string; start: number }): Promise<TextResult> {
    return this.serial(async () => {
      const hits = await findText(this.root, before);
      if (!hits.length) return { ok: false, reason: "this text isn't written anywhere in the project's source as it appears (it may be generated)" };
      const hit = choice ? hits.find((h) => h.file === choice.file && h.start === choice.start) : hits.length === 1 ? hits[0] : undefined;
      if (!hit) {
        if (choice) return { ok: false, reason: "that place has changed since; try again" };
        return { ok: false, candidates: hits.map(({ file, start, line, context }) => ({ file, start, line, context })) };
      }
      const old = await readFile(hit.file, "utf8");
      const next = old.slice(0, hit.start) + escapeFor(hit.file, old, hit.start, after) + old.slice(hit.end);
      await writeFile(hit.file, next);
      this.undoStack.push({ at: new Date().toISOString(), files: [{ file: hit.file, before: old, after: next }] });
      await this.history([{ at: new Date().toISOString(), file: path.relative(this.root, hit.file), line: hit.line, property: "text", before, after }]);
      return { ok: true, written: { file: hit.file, line: hit.line } };
    });
  }

  undo(): Promise<UndoResult> {
    return this.serial(async () => {
      const batch = this.undoStack.pop();
      if (!batch) return { ok: false, files: [], reason: "nothing to undo" };
      for (const { file, after } of batch.files) {
        const now = await readFile(file, "utf8").catch(() => null);
        if (now !== after) {
          this.undoStack.push(batch);
          return { ok: false, files: [], reason: `${path.relative(this.root, file)} has changed since, so undoing would overwrite that` };
        }
      }
      for (const { file, before } of batch.files) await writeFile(file, before);
      await this.history([{ at: new Date().toISOString(), undo: batch.at, files: batch.files.map((f) => path.relative(this.root, f.file)) }]);
      return { ok: true, files: batch.files.map((f) => f.file) };
    });
  }

  get canUndo(): number {
    return this.undoStack.length;
  }

  private async history(entries: object[]) {
    if (!entries.length) return;
    const dir = path.join(this.root, this.dir);
    await mkdir(dir, { recursive: true });
    await appendFile(path.join(dir, "history.jsonl"), entries.map((e) => JSON.stringify(e) + "\n").join(""));
  }
}
