/** One step on the way from a stylesheet down to a rule: an at-rule that wraps it, or the rule itself. */
export type PathSeg =
  | { kind: "at"; name: string; params: string }
  | { kind: "rule"; selector: string };

/**
 * A declaration in a stylesheet, as the browser sees it.
 * `devId` is the sheet's Vite module id (or its URL path), `path` leads from the sheet to the rule,
 * and `nth` says which rule it is when the same path occurs more than once in the sheet.
 */
export interface Target {
  devId: string;
  path: PathSeg[];
  nth: number;
  property: string;
}

export interface Edit extends Target {
  value: string;
  /** The value the page was showing before the edit. A differing source value is a conflict. */
  expect?: string;
  /** Write even when the source no longer holds `expect`. */
  force?: boolean;
}

export interface Located {
  ok: true;
  file: string;
  line: number;
  /** The rule already declares the property; otherwise an edit adds it to the end of the rule. */
  declared: boolean;
  value?: string;
}

export interface NotLocated {
  ok: false;
  reason: string;
}

export type Location = Located | NotLocated;

export interface WriteResult {
  ok: boolean;
  written: { file: string; line: number }[];
  conflicts: { index: number; file: string; line: number; source: string; expected: string }[];
  errors: { index: number; reason: string }[];
}

export interface UndoResult {
  ok: boolean;
  files: string[];
  reason?: string;
}

export interface TextCandidate {
  file: string;
  start: number;
  line: number;
  context: string;
}

export interface TextResult {
  ok: boolean;
  written?: { file: string; line: number };
  /** The text is written in more than one place: pick one and send it back as `choice`. */
  candidates?: TextCandidate[];
  reason?: string;
}
