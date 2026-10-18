// Shared data layer for Claude Folders, loaded by the content script, the
// popup and the background worker. All state lives in chrome.storage.local
// under one key so every tab and surface sees the same folders.
//
// Shape:
// {
//   version: 2,
//   collapsed: { code: false, chat: false },      // whole "Folders" section
//   folders: [{ id, name, space, parentId, color, collapsed, items: [...] }],
//   settings: { hideInRecents: true },
//   pending: { folderId, space, known: [paths], at } | null
// }
// Folders are a flat list; nesting comes from parentId and sibling order is
// the order in the array. A chat lives in at most one folder.
(function (global) {
  'use strict';

  const KEY = 'claudeFolders';
  const SPACES = ['code', 'chat'];
  const COLORS = ['', '#d97757', '#e0a43a', '#5fae6e', '#4f97d9', '#8b78e0', '#d26aa3', '#8e959e'];

  function defaultState() {
    return {
      version: 2,
      collapsed: { code: false, chat: false },
      folders: [],
      settings: { hideInRecents: true },
      pending: null,
    };
  }

  function uid() {
    return 'f_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function normalize(raw) {
    const s = defaultState();
    if (!raw || typeof raw !== 'object') return s;
    if (raw.collapsed && typeof raw.collapsed === 'object') {
      for (const sp of SPACES) s.collapsed[sp] = !!raw.collapsed[sp];
    }
    Object.assign(s.settings, raw.settings || {});
    const seen = new Set();
    s.folders = (Array.isArray(raw.folders) ? raw.folders : [])
      .filter((f) => f && typeof f.name === 'string')
      .map((f) => {
        let id = typeof f.id === 'string' && f.id ? f.id : uid();
        if (seen.has(id)) id = uid();
        seen.add(id);
        return {
          id,
          name: f.name,
          space: SPACES.includes(f.space) ? f.space : 'code',
          parentId: typeof f.parentId === 'string' ? f.parentId : null,
          color: typeof f.color === 'string' ? f.color : '',
          collapsed: !!f.collapsed,
          items: (Array.isArray(f.items) ? f.items : [])
            .filter((it) => it && typeof it.path === 'string' && it.path)
            .map((it) => ({
              path: it.path,
              title: typeof it.title === 'string' ? it.title : '',
              renamed: !!it.renamed,
              addedAt: typeof it.addedAt === 'number' ? it.addedAt : Date.now(),
            })),
        };
      });
    // Drop dangling parents and parent cycles so the tree always renders.
    const byId = new Map(s.folders.map((f) => [f.id, f]));
    for (const f of s.folders) {
      const parent = f.parentId && byId.get(f.parentId);
      if (!parent || parent.space !== f.space) f.parentId = null;
    }
    for (const f of s.folders) {
      const chain = new Set([f.id]);
      let p = f.parentId && byId.get(f.parentId);
      while (p) {
        if (chain.has(p.id)) {
          f.parentId = null;
          break;
        }
        chain.add(p.id);
        p = p.parentId && byId.get(p.parentId);
      }
    }
    const p = raw.pending;
    if (p && typeof p.folderId === 'string' && byId.has(p.folderId)) {
      s.pending = {
        folderId: p.folderId,
        space: byId.get(p.folderId).space,
        known: Array.isArray(p.known) ? p.known.filter((x) => typeof x === 'string') : [],
        at: typeof p.at === 'number' ? p.at : Date.now(),
        oneShot: !!p.oneShot, // filing a dragged row that had no readable link
      };
    }
    return s;
  }

  async function load() {
    const res = await chrome.storage.local.get(KEY);
    return normalize(res[KEY]);
  }

  async function save(state) {
    await chrome.storage.local.set({ [KEY]: state });
  }

  // Serialized load -> mutate -> save. The mutator may return false to skip
  // the write. Calls are chained so rapid edits in one tab never interleave.
  let chain = Promise.resolve();
  function update(mutator) {
    const run = chain.then(async () => {
      const state = await load();
      if (mutator(state) === false) return state;
      await save(state);
      return state;
    });
    chain = run.catch(() => {});
    return run;
  }

  function onChange(cb) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[KEY]) cb(normalize(changes[KEY].newValue));
    });
  }

  // Which sidebar a path belongs to.
  function spaceOf(pathname) {
    return /^\/code(\/|$)/.test(pathname) ? 'code' : 'chat';
  }

  // Reduce a claude.ai URL (absolute or relative) to the path items are keyed
  // by. Returns null for anything that is not a single chat/session page.
  function toPath(href) {
    let url;
    try {
      url = new URL(href, 'https://claude.ai');
    } catch (_) {
      return null;
    }
    if (url.hostname !== 'claude.ai') return null;
    const seg = url.pathname.split('/').filter(Boolean);
    if (seg.length !== 2) return null;
    // Only real chats: /code/session_<id> and /chat/<uuid>, not nav pages
    // such as /code/projects or /code/artifacts.
    if (seg[0] === 'code' && /^session_[\w-]+$/.test(seg[1])) return '/' + seg.join('/');
    if (seg[0] === 'chat' && /^[0-9a-f][0-9a-f-]{7,}$/i.test(seg[1])) return '/' + seg.join('/');
    return null;
  }

  // --- pure helpers that mutate a state object in place ---

  function findFolder(state, id) {
    return state.folders.find((f) => f.id === id) || null;
  }

  function children(state, parentId, space) {
    return state.folders.filter((f) => f.parentId === parentId && f.space === space);
  }

  function descendantIds(state, id) {
    const out = new Set();
    const walk = (pid) => {
      for (const f of state.folders) {
        if (f.parentId === pid && !out.has(f.id)) {
          out.add(f.id);
          walk(f.id);
        }
      }
    };
    walk(id);
    return out;
  }

  function folderOfPath(state, path) {
    return state.folders.find((f) => f.items.some((it) => it.path === path)) || null;
  }

  function addFolder(state, { name, space, parentId = null, color = '' }) {
    const folder = { id: uid(), name: name || 'New folder', space, parentId, color, collapsed: false, items: [] };
    state.folders.push(folder);
    if (parentId) {
      const parent = findFolder(state, parentId);
      if (parent) parent.collapsed = false;
    }
    return folder;
  }

  function deleteFolder(state, id) {
    const doomed = descendantIds(state, id);
    doomed.add(id);
    state.folders = state.folders.filter((f) => !doomed.has(f.id));
    if (state.pending && doomed.has(state.pending.folderId)) state.pending = null;
  }

  function expandTo(state, folder) {
    let f = folder;
    while (f) {
      f.collapsed = false;
      f = f.parentId ? findFolder(state, f.parentId) : null;
    }
  }

  // Put a chat into a folder (moving it out of any other folder), optionally
  // before another chat. Keeps the stored title/rename of an existing item.
  function fileItem(state, folderId, path, title, beforePath) {
    const target = findFolder(state, folderId);
    if (!target || !path) return false;
    let item = null;
    for (const f of state.folders) {
      const idx = f.items.findIndex((it) => it.path === path);
      if (idx >= 0) item = f.items.splice(idx, 1)[0];
    }
    if (!item) item = { path, title: '', renamed: false, addedAt: Date.now() };
    if (title && !item.renamed) item.title = title;
    const idx = beforePath && beforePath !== path ? target.items.findIndex((it) => it.path === beforePath) : -1;
    if (idx >= 0) target.items.splice(idx, 0, item);
    else target.items.push(item);
    expandTo(state, target);
    return true;
  }

  function removeItem(state, path) {
    for (const f of state.folders) {
      const idx = f.items.findIndex((it) => it.path === path);
      if (idx >= 0) f.items.splice(idx, 1);
    }
  }

  // Move a folder before a sibling (where = 'before') or inside another
  // folder (where = 'into'); targetId null with 'into' means top level.
  function moveFolder(state, id, targetId, where) {
    const folder = findFolder(state, id);
    if (!folder || id === targetId) return false;
    const target = targetId ? findFolder(state, targetId) : null;
    if (targetId && (!target || target.space !== folder.space)) return false;
    if (target && descendantIds(state, id).has(target.id)) return false;
    state.folders.splice(state.folders.indexOf(folder), 1);
    if (where === 'before' && target) {
      folder.parentId = target.parentId;
      state.folders.splice(state.folders.indexOf(target), 0, folder);
    } else {
      folder.parentId = target ? target.id : null;
      state.folders.push(folder);
      if (target) target.collapsed = false;
    }
    return true;
  }

  global.ClaudeFoldersStore = {
    KEY,
    SPACES,
    COLORS,
    defaultState,
    normalize,
    load,
    save,
    update,
    onChange,
    spaceOf,
    toPath,
    findFolder,
    children,
    descendantIds,
    folderOfPath,
    addFolder,
    deleteFolder,
    fileItem,
    removeItem,
    moveFolder,
  };
})(typeof self !== 'undefined' ? self : window);
