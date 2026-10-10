export const styles = /* css */ `
:host {
  all: initial;
  /* Above everything the page stacks, sticky headers and grain overlays included. */
  position: fixed;
  top: 0;
  left: 0;
  z-index: 2147483647;
  --bg: #fbfaf7;
  --ink: #1b1b19;
  --muted: #7a776f;
  --soft: #efede7;
  --softer: #f5f3ee;
  --hover: #e6e3db;
  --field: #ffffff;
  --accent: #2f6bff;
  --accent-soft: rgba(47, 107, 255, .12);
  --warn: #c2410c;
  --shadow: 0 1px 2px rgba(0,0,0,.06), 0 8px 32px rgba(0,0,0,.14);
  font: 12.5px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: var(--ink);
}
* { box-sizing: border-box; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
input { font: inherit; color: inherit; }
[hidden] { display: none !important; }

/* Outlines on the page */
.box { position: fixed; pointer-events: none; z-index: 1; border-radius: 2px; }
.box.hover { outline: 1.5px dashed var(--accent); outline-offset: -1px; background: var(--accent-soft); }
.box.selected { outline: 2px solid var(--accent); outline-offset: 1px; }
.tag { position: fixed; pointer-events: none; z-index: 2; padding: 2px 7px; border-radius: 5px; background: var(--accent); color: white; font-size: 11.5px; white-space: nowrap; }

.launcher { position: fixed; right: 16px; bottom: 16px; z-index: 3; display: flex; align-items: center; gap: 8px; padding: 9px 13px 9px 11px; border-radius: 999px; background: var(--ink); color: var(--bg); box-shadow: var(--shadow); font-weight: 500; }
.launcher .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--bg); }
.launcher.on .dot { background: var(--accent); box-shadow: 0 0 0 3px rgba(47,107,255,.35); }
.launcher kbd { font: inherit; opacity: .55; }
.launcher.hidden { display: none; }

/* The panel */
.panel { position: fixed; top: 12px; right: 12px; z-index: 4; width: 312px; max-height: calc(100vh - 24px); overflow: auto; overscroll-behavior: contain; border-radius: 14px; background: var(--bg); box-shadow: var(--shadow); padding: 12px 12px 0; }
.panel.left { right: auto; left: 12px; }
.head { display: flex; align-items: center; gap: 2px; margin-bottom: 10px; }
.head .title { flex: 1; min-width: 0; padding-left: 2px; }
.head .name { font-weight: 600; font-size: 14px; }
.head .sub { color: var(--muted); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon { width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: var(--muted); }
.icon:hover { background: var(--soft); color: var(--ink); }
.icon:disabled { opacity: .3; cursor: default; background: none; }
.glyph { display: grid; place-items: center; }

.textbtn { width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 10px; background: var(--soft); font-weight: 500; }
.textbtn:hover { background: var(--hover); }
.textbtn .hint { margin-left: auto; color: var(--muted); font-weight: 400; font-size: 11.5px; }

.group { margin-top: 16px; }
.group h3 { all: unset; display: block; font-size: 11px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); margin: 0 2px 6px; }
.row { display: grid; grid-template-columns: 92px 1fr; column-gap: 8px; align-items: center; margin-bottom: 6px; }
.row .label { color: var(--muted); padding-left: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.row .note { grid-column: 2; color: var(--muted); font-size: 11px; margin: 3px 0 2px 2px; }
.ctl { display: flex; gap: 4px; min-width: 0; }
.pick { flex: 1; min-width: 0; height: 32px; display: flex; align-items: center; gap: 7px; padding: 0 8px 0 10px; border-radius: 8px; background: var(--field); box-shadow: inset 0 0 0 1px var(--soft); }
.pick:hover { box-shadow: inset 0 0 0 1px var(--hover); background: var(--softer); }
.pick:disabled { cursor: default; background: transparent; box-shadow: none; color: var(--muted); }
.pick .val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12.5px; }
.pick .hint { color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pick .chev { color: var(--muted); display: grid; }
.step { flex: none; width: 30px; height: 32px; border-radius: 8px; background: var(--soft); display: grid; place-items: center; font-size: 15px; line-height: 1; text-align: center; }
.step:hover { background: var(--hover); }
.step:active { background: #dcd8ce; }
.swatch { width: 16px; height: 16px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 1px rgba(0,0,0,.14); position: relative; overflow: hidden; }
.swatch.picker { background: conic-gradient(#f44, #fd4, #4d6, #4cf, #64f, #f4c, #f44); }
.swatch input { position: absolute; inset: -6px; opacity: 0; cursor: pointer; width: 30px; height: 30px; padding: 0; border: 0; }

.foot { position: sticky; bottom: 0; margin: 16px -12px 0; padding: 10px 12px 12px; background: var(--bg); display: flex; align-items: center; gap: 8px; }
.foot .where { flex: 1; min-width: 0; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btn { padding: 6px 11px; border-radius: 8px; background: var(--soft); color: var(--ink); font-weight: 500; }
.btn:hover { background: var(--hover); }
.btn:disabled { opacity: .4; cursor: default; background: var(--soft); }

/* Dropdowns */
.menu { position: fixed; z-index: 6; overflow: auto; overscroll-behavior: contain; padding: 6px; border-radius: 12px; background: var(--field); box-shadow: 0 0 0 1px rgba(0,0,0,.06), 0 12px 40px rgba(0,0,0,.18); }
.grp { font-size: 10.5px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); padding: 10px 8px 4px; }
.grp:first-child { padding-top: 4px; }
.opt { width: 100%; min-height: 32px; display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 7px; cursor: pointer; }
.opt:hover { background: var(--softer); }
.opt.on { background: var(--accent-soft); }
.opt .tick { width: 12px; flex: none; color: var(--accent); display: grid; }
.opt .val { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.opt .hint { color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.opt.cand { flex-direction: column; align-items: stretch; gap: 2px; padding: 7px 8px; }
.opt.cand .ctx { color: var(--muted); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: ui-monospace, monospace; }
.swatches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px; margin-bottom: 4px; }
.sw { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 7px; min-width: 0; }
.sw:hover { background: var(--softer); }
.sw.on { background: var(--accent-soft); }
.sw .swatch { width: 18px; height: 18px; }
.sw-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.custom { padding: 6px 2px 2px; }
.custom input { width: 100%; height: 32px; padding: 0 10px; border: 0; border-radius: 8px; outline: 0; background: var(--softer); }
.custom input:focus { box-shadow: inset 0 0 0 1.5px var(--accent); background: var(--field); }
.everywhere { margin-top: 8px; padding: 2px 2px 4px; border-radius: 10px; background: var(--softer); }
.everywhere .grp { padding: 8px 8px 6px; }
.tokenrow { display: flex; align-items: center; gap: 6px; padding: 0 6px 4px; }
.tokenrow .tval { flex: 1; min-width: 0; text-align: center; font-variant-numeric: tabular-nums; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tokenrow .step { background: var(--field); }
.tokenrow .step:hover { background: var(--hover); }
.source { display: block; width: 100%; margin-top: 6px; padding: 6px 8px; border-radius: 7px; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button.source:hover { background: var(--softer); color: var(--accent); }
.source.warn { color: var(--warn); white-space: normal; }

/* Toasts */
.toasts { position: fixed; left: 50%; bottom: 16px; translate: -50% 0; z-index: 7; display: grid; gap: 6px; justify-items: center; }
.toast { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 13px; border-radius: 10px; background: var(--ink); color: var(--bg); box-shadow: var(--shadow); max-width: min(560px, calc(100vw - 32px)); }
.toast.warn { background: var(--warn); }
.toast .msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.toast button { padding: 4px 9px; border-radius: 6px; background: rgba(255,255,255,.14); }
.toast button:hover { background: rgba(255,255,255,.24); }
`;
