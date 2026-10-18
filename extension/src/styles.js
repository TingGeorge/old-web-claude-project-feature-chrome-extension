// Styles for the Folders section. They live inside a shadow root so
// claude.ai's CSS cannot leak in and ours cannot leak out. Colors and font
// are read from the native sidebar at mount time (see adoptTheme) and fed
// in through the --cf-* custom properties on the host.
window.ClaudeFoldersCSS = `
:host {
  all: initial;
  display: block;
  --cf-text: #e8e6e3;
  --cf-muted: #9a9893;
  --cf-size: 14px;
  --cf-head-size: 13px;
  --cf-font: inherit;
  --cf-bg: #1f1e1d;
  --cf-hover: color-mix(in srgb, var(--cf-text) 8%, transparent);
  --cf-active: color-mix(in srgb, var(--cf-text) 13%, transparent);
  --cf-line: color-mix(in srgb, var(--cf-text) 14%, transparent);
  --cf-accent: #d97757;
  font-family: var(--cf-font);
  font-size: var(--cf-size);
  color: var(--cf-text);
  line-height: 1.35;
}
* { box-sizing: border-box; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
svg { display: block; flex: none; }

.cf { padding: 4px 0 8px; position: relative; }

.cf-head {
  display: flex; align-items: center; gap: 2px;
  padding: 6px 8px 4px 10px; min-height: 30px; border-radius: 8px;
}
.cf-head-toggle {
  display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0;
  color: var(--cf-muted); font-size: var(--cf-head-size); text-align: left;
}
.cf-head-toggle .cf-chev { opacity: 0; transition: opacity .12s, transform .12s; }
.cf-head:hover .cf-head-toggle .cf-chev { opacity: 1; }
.cf-head.cf-drop-into { background: var(--cf-hover); box-shadow: inset 0 0 0 1px var(--cf-accent); }

.cf-icon-btn {
  width: 24px; height: 24px; border-radius: 6px; display: grid; place-items: center;
  color: var(--cf-muted); flex: none;
}
.cf-icon-btn:hover { background: var(--cf-hover); color: var(--cf-text); }
.cf-icon-btn[aria-pressed="true"] { color: var(--cf-text); }

.cf-chev { transition: transform .12s; }
.cf-chev.cf-closed { transform: rotate(-90deg); }

.cf-search-wrap { padding: 2px 6px 6px; }
.cf-search {
  width: 100%; height: 30px; border-radius: 8px; padding: 0 10px;
  border: 1px solid var(--cf-line); background: transparent; color: var(--cf-text);
  font: inherit; font-size: 13px; outline: none;
}
.cf-search:focus { border-color: color-mix(in srgb, var(--cf-text) 35%, transparent); }
.cf-search::placeholder { color: var(--cf-muted); }

.cf-pending {
  margin: 0 6px 6px; padding: 6px 8px 6px 10px; border-radius: 8px; font-size: 12px;
  display: flex; align-items: center; gap: 6px; color: var(--cf-muted);
  background: color-mix(in srgb, var(--cf-accent) 14%, transparent);
}
.cf-pending b { color: var(--cf-text); font-weight: 500; }
.cf-pending span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.cf-row {
  position: relative; display: flex; align-items: center; gap: 6px;
  min-height: 32px; margin: 0 6px; padding-right: 4px; border-radius: 8px;
  color: var(--cf-text); text-decoration: none; cursor: pointer; user-select: none;
}
.cf-row:hover { background: var(--cf-hover); }
.cf-row.cf-active { background: var(--cf-active); }
.cf-row.cf-pending-target { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cf-accent) 60%, transparent); }
.cf-row.cf-drop-into { background: var(--cf-hover); box-shadow: inset 0 0 0 1px var(--cf-accent); }
.cf-row.cf-drop-before::before {
  content: ""; position: absolute; left: 6px; right: 6px; top: -1px; height: 2px;
  border-radius: 2px; background: var(--cf-accent);
}
.cf-row.cf-dragging { opacity: .4; }

.cf-folder-row .cf-chev-btn {
  width: 18px; height: 18px; display: grid; place-items: center; color: var(--cf-muted); border-radius: 4px;
}
.cf-folder-icon { color: var(--cf-folder, var(--cf-muted)); }
.cf-name {
  flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.cf-count { color: var(--cf-muted); font-size: 12px; padding: 0 4px; }
.cf-actions { display: none; align-items: center; gap: 0; }
.cf-row:hover .cf-actions, .cf-row.cf-menu-open .cf-actions { display: flex; }
.cf-row:hover .cf-count, .cf-row.cf-menu-open .cf-count { display: none; }
.cf-actions .cf-icon-btn { width: 22px; height: 22px; }

.cf-item .cf-dot { width: 18px; display: grid; place-items: center; color: var(--cf-muted); }
.cf-item .cf-name { color: var(--cf-text); }

.cf-edit {
  flex: 1; min-width: 0; height: 24px; padding: 0 6px; border-radius: 6px;
  border: 1px solid var(--cf-accent); background: var(--cf-bg); color: var(--cf-text);
  font: inherit; outline: none;
}

.cf-empty {
  margin: 0 6px; padding: 4px 8px 6px; font-size: 12px; color: var(--cf-muted); border-radius: 8px;
}
.cf-empty.cf-drop-into { box-shadow: inset 0 0 0 1px var(--cf-accent); background: var(--cf-hover); }
.cf-hint { margin: 2px 6px 4px; padding: 10px; font-size: 12px; color: var(--cf-muted);
  border: 1px dashed var(--cf-line); border-radius: 8px; text-align: center; }
.cf-hint.cf-drop-into { border-color: var(--cf-accent); color: var(--cf-text); }

/* Popover menu */
.cf-menu {
  position: fixed; z-index: 2147483647; min-width: 200px; padding: 4px;
  border-radius: 10px; border: 1px solid var(--cf-line); background: var(--cf-bg);
  box-shadow: 0 8px 28px rgba(0,0,0,.28); font-size: 13px; color: var(--cf-text);
}
.cf-menu-item {
  display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 8px;
  border-radius: 6px; text-align: left;
}
.cf-menu-item:hover:not(:disabled) { background: var(--cf-hover); }
.cf-menu-item:disabled { opacity: .45; cursor: default; }
.cf-menu-item.cf-danger { color: #e5665c; }
.cf-menu-sep { height: 1px; margin: 4px 2px; background: var(--cf-line); }
.cf-menu-label { padding: 6px 8px 2px; font-size: 11px; color: var(--cf-muted); }
.cf-swatches { display: flex; gap: 6px; padding: 4px 8px 8px; }
.cf-swatch {
  width: 18px; height: 18px; border-radius: 50%; border: 1px solid var(--cf-line);
  display: grid; place-items: center;
}
.cf-swatch[aria-checked="true"] { box-shadow: 0 0 0 2px var(--cf-bg), 0 0 0 3.5px var(--cf-text); }

/* Floating fallback when the sidebar cannot be found or is collapsed */
:host([data-mode="floating"]) {
  position: fixed; left: 12px; bottom: 84px; z-index: 2147483000;
}
.cf-fab {
  width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center;
  background: var(--cf-bg); border: 1px solid var(--cf-line); color: var(--cf-text);
  box-shadow: 0 4px 16px rgba(0,0,0,.25);
}
.cf-panel {
  position: absolute; left: 0; bottom: 48px; width: 280px; max-height: 70vh; overflow: auto;
  background: var(--cf-bg); border: 1px solid var(--cf-line); border-radius: 12px;
  box-shadow: 0 8px 28px rgba(0,0,0,.3);
}
`;
