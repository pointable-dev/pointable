import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Store } from "./store.ts";
import { PROTOCOL } from "../shared/types.ts";

type Next = (err?: unknown) => void;

export const PREFIX = "/__pointable/";
const MARKER = "data-pointable";

async function body(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(data));
}

/** Requests that write files must come from the page itself, not from another site the developer has open. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return req.headers["sec-fetch-site"] !== "cross-site";
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Add the overlay's script to every HTML page the dev server sends, whatever framework renders it.
 * Content-Length is dropped so the extra bytes fit; the response goes out chunked instead.
 */
function injectInto(res: ServerResponse, tag: string) {
  const write = res.write.bind(res) as (...a: any[]) => boolean;
  const end = res.end.bind(res) as (...a: any[]) => ServerResponse;
  const setHeader = res.setHeader.bind(res);
  const writeHead = res.writeHead.bind(res) as (...a: any[]) => ServerResponse;
  let done = false;
  const seen = (chunk: unknown) => {
    if (!done && chunk && typeof chunk !== "function" && String(chunk).includes(MARKER)) done = true;
  };
  const isHtml = () => String(res.getHeader("content-type") ?? "").includes("text/html");

  res.setHeader = (name: string, value: any) => (name.toLowerCase() === "content-length" ? res : setHeader(name, value));
  res.writeHead = (status: number, ...rest: any[]) => {
    const headers = rest.find((r) => r && typeof r === "object");
    if (Array.isArray(headers)) {
      for (let i = 0; i < headers.length; i += 2) if (String(headers[i]).toLowerCase() === "content-length") headers.splice(i, 2);
    } else if (headers) {
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === "content-length") delete headers[k];
        else if (k.toLowerCase() === "content-type" && !res.getHeader("content-type")) setHeader("content-type", headers[k]);
      }
    }
    return writeHead(status, ...rest);
  };
  res.write = ((chunk: any, ...rest: any[]) => {
    seen(chunk);
    return write(chunk, ...rest);
  }) as typeof res.write;
  res.end = ((chunk?: any, ...rest: any[]) => {
    seen(chunk);
    if (done || !isHtml() || res.statusCode >= 300) return end(chunk, ...rest);
    done = true;
    if (typeof chunk === "function") return write(tag), end(chunk);
    const encoding = typeof rest[0] === "string" ? rest.shift() : undefined;
    if (chunk != null) write(chunk, encoding);
    write(tag);
    return end(...rest);
  }) as typeof res.end;
}

export function middleware(opts: { root: string; base: string; dir: string; clientUrl: URL }) {
  const store = new Store(opts.root, opts.dir);
  const base = opts.base.endsWith("/") ? opts.base : opts.base + "/";
  const prefix = base.replace(/\/$/, "") + PREFIX;
  const tag = `<script type="module" src="${prefix}client.js" ${MARKER}></script>`;

  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const url = (req.url ?? "/").split("?")[0];
    if (!url.startsWith(prefix)) {
      if (req.method === "GET" && String(req.headers.accept ?? "").includes("text/html")) injectInto(res, tag);
      return next();
    }

    const route = url.slice(prefix.length);
    try {
      if (req.method === "GET" && (route === "client.js" || route === "client.js.map")) {
        const file = route === "client.js" ? opts.clientUrl : new URL("client.js.map", opts.clientUrl);
        res.setHeader("content-type", route.endsWith(".map") ? "application/json" : "text/javascript");
        res.setHeader("cache-control", "no-store");
        return res.end(await readFile(file));
      }
      if (req.method === "GET" && route === "status") return json(res, 200, { root: opts.root, undo: store.canUndo, protocol: PROTOCOL });
      if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
      if (!sameOrigin(req)) return json(res, 403, { error: "cross-origin request refused" });

      const data = await body(req);
      if (route === "locate") return json(res, 200, await store.locate(data.targets ?? []));
      if (route === "write") return json(res, 200, await store.write(data.edits ?? []));
      if (route === "undo") return json(res, 200, await store.undo());
      if (route === "text") return json(res, 200, await store.text(String(data.before ?? ""), String(data.after ?? ""), data.choice));
      return json(res, 404, { error: "unknown route" });
    } catch (e) {
      return json(res, 500, { error: (e as Error).message });
    }
  };
}
