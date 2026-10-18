// Claude Folders: adds a "Folders" section to the claude.ai sidebar (both
// Claude Code at /code and regular chats) that works like the old Projects:
// group chats into folders, nest folders, color them, search them, and start
// a new chat that is filed straight into a folder.
(() => {
  'use strict';
  if (window.__claudeFoldersLoaded) return;
  window.__claudeFoldersLoaded = true;

  const S = window.ClaudeFoldersStore;
  const LABELS = ['Pinned', 'Starred', 'Recents'];
  const SIDEBAR_PAGES = /^\/(code|chat|new|recents)(\/|$)/;
  const PENDING_TTL = 60 * 60 * 1000;

  let state = S.defaultState();
  let space = S.spaceOf(location.pathname);
  let host = null;
  let shadow = null;
  // The folder menu renders in its own body-level layer so the sidebar's
  // scroll container (overflow/transform) can never clip it.
  let overlay = null;
  let overlayShadow = null;
  let mode = null; // 'inline' | 'floating'
  let ctx = null; // cached sidebar location
  let lastFullWalk = 0;
  let lastSeen = 0;
  const startedAt = Date.now();

  // UI-only state (not persisted)
  let editing = null; // { kind: 'folder', id } | { kind: 'item', path }
  let menu = null; // { folderId, x, y }
  let searchOpen = false;
  let query = '';
  let drag = null; // { kind: 'link'|'item'|'folder', path?, title?, id? }
  let floatingOpen = false;
  let lastHref = location.href;

  // ---------------------------------------------------------------- icons

  const ICONS = {
    chevron: '<path d="m6 9 6 6 6-6"/>',
    folder:
      '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    folderPlus:
      '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
    newChat:
      '<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.4 2.6a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4Z"/>',
    pencil: '<path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    trash:
      '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    up: '<path d="m9 14-5-5 5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    pin: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
  };

  function icon(name, size = 16, extraClass = '') {
    const tpl = document.createElement('template');
    tpl.innerHTML =
      `<svg class="${extraClass}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
      `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `${ICONS[name]}</svg>`;
    return tpl.content.firstChild;
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style') el.style.cssText = v;
      else if (k.startsWith('data-')) el.setAttribute(k, v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid) el.append(kid);
    return el;
  }

  // ---------------------------------------------------------- page helpers

  function currentPath() {
    return S.toPath(location.href);
  }

  function isOurs(node) {
    return !!host && (node === host || host.contains(node));
  }

  function textOf(a) {
    const attr = a.getAttribute('title') || a.getAttribute('aria-label');
    const walker = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const t = n.nodeValue.trim();
      if (t) return t;
    }
    return (attr || '').trim();
  }

  function nativeLinks(root) {
    const out = [];
    for (const a of (root || document).querySelectorAll('a[href]')) {
      if (isOurs(a)) continue;
      const p = S.toPath(a.href);
      if (p) out.push([a, p]);
    }
    return out;
  }

  function findNativeLink(path) {
    const roots = ctx && ctx.root ? [ctx.root, document] : [document];
    for (const r of roots) {
      for (const [a, p] of nativeLinks(r)) if (p === path) return a;
    }
    return null;
  }

  function cleanDocTitle() {
    const t = (document.title || '').replace(/\s*[-|–—]\s*Claude( Code)?\s*$/i, '').trim();
    return /^claude( code)?$/i.test(t) ? '' : t;
  }

  function titleFor(path) {
    const a = findNativeLink(path);
    const t = a && textOf(a);
    if (t) return t;
    return path === currentPath() ? cleanDocTitle() : '';
  }

  function displayTitle(item) {
    return item.title || 'Untitled ' + (item.path.startsWith('/code/') ? 'session' : 'chat');
  }

  function navigate(path) {
    const a = findNativeLink(path);
    if (a) a.click();
    else location.assign(path);
  }

  function newChatPath() {
    return space === 'code' ? '/code' : '/new';
  }

  function openNewChat() {
    const target = newChatPath();
    for (const a of document.querySelectorAll('a[href]')) {
      if (isOurs(a)) continue;
      try {
        const u = new URL(a.href);
        if (u.origin === location.origin && u.pathname === target) {
          a.click();
          return;
        }
      } catch (_) {}
    }
    if (location.pathname !== target) location.assign(target);
  }

  function luminance(color) {
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (!m) return 0.5;
    const [r, g, b] = m[1].split(/[ ,/]+/).map(Number);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function effectiveBg(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      const m = bg.match(/rgba?\(([^)]+)\)/);
      if (m) {
        const parts = m[1].split(/[ ,/]+/).map(Number);
        if (parts.length < 4 || parts[3] > 0.5) return bg;
      }
    }
    return luminance(getComputedStyle(document.body).color) > 0.5 ? 'rgb(31, 30, 29)' : 'rgb(250, 249, 245)';
  }

  // -------------------------------------------------- locating the sidebar

  function looksLikeSidebar(el) {
    if (el.closest('main, [contenteditable="true"], textarea, .ProseMirror')) return false;
    if (el.closest('nav, aside, [role="navigation"]')) return true;
    const r = el.getBoundingClientRect();
    return r.left < 420;
  }

  // The highest ancestor that still starts with the heading text: that is the
  // section block (heading + its list) we insert in front of.
  function sectionBlock(heading, label) {
    let block = heading;
    for (let i = 0; i < 6; i++) {
      const parent = block.parentElement;
      if (!parent || parent === document.body) break;
      if (!parent.textContent.trim().startsWith(label)) break;
      block = parent;
    }
    return block;
  }

  function cacheValid() {
    return (
      ctx &&
      ctx.heading.isConnected &&
      ctx.block.isConnected &&
      (!ctx.recents || ctx.recents.isConnected) &&
      LABELS.includes(ctx.heading.textContent.trim())
    );
  }

  function locateSidebar() {
    const now = Date.now();
    if (cacheValid() && now - lastFullWalk < 3000) return ctx;
    lastFullWalk = now;
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (LABELS.includes(n.nodeValue.trim()) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
    });
    let n;
    while ((n = walker.nextNode())) {
      const el = n.parentElement;
      if (!el || isOurs(el) || el.textContent.trim() !== n.nodeValue.trim()) continue;
      if (!looksLikeSidebar(el)) continue;
      hits.push({ el, label: n.nodeValue.trim() });
    }
    if (!hits.length) {
      ctx = null;
      return null;
    }
    const first = hits[0];
    const recentsHit = hits.find((x) => x.label === 'Recents');
    const block = sectionBlock(first.el, first.label);
    const root =
      first.el.closest('nav, aside, [role="navigation"]') ||
      (recentsHit && commonAncestor(block, recentsHit.el)) ||
      block.parentElement;
    ctx = { heading: first.el, label: first.label, block, recents: recentsHit ? recentsHit.el : null, root };
    return ctx;
  }

  function commonAncestor(a, b) {
    for (let n = a; n; n = n.parentElement) if (n.contains(b)) return n;
    return null;
  }

  // ---------------------------------------------------------------- mount

  function ensureHost() {
    if (host) return;
    host = document.createElement('claude-folders');
    host.id = 'claude-folders-root';
    shadow = host.attachShadow({ mode: 'open' });
    overlay = document.createElement('claude-folders-menu');
    overlay.id = 'claude-folders-menu';
    overlayShadow = overlay.attachShadow({ mode: 'open' });
    overlayShadow.addEventListener('click', onClick);
    overlayShadow.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closeMenu();
    });
    bindEvents();
  }

  function mountInline(c) {
    ensureHost();
    const parent = c.block.parentElement;
    if (host.parentElement !== parent || host.nextElementSibling !== c.block) {
      parent.insertBefore(host, c.block);
    }
    if (mode !== 'inline') {
      mode = 'inline';
      host.setAttribute('data-mode', 'inline');
      render();
    }
    adoptTheme(c);
  }

  function mountFloating() {
    ensureHost();
    if (host.parentElement !== document.body) document.body.appendChild(host);
    if (mode !== 'floating') {
      mode = 'floating';
      host.setAttribute('data-mode', 'floating');
      render();
    }
    adoptTheme(null);
  }

  function unmount() {
    if (host && host.isConnected) host.remove();
    if (overlay && overlay.isConnected) overlay.remove();
    mode = null;
  }

  let themeKey = '';
  function adoptTheme(c) {
    let vars;
    if (c) {
      const hs = getComputedStyle(c.heading);
      const sample = nativeLinks(c.root).map(([a]) => a).find((a) => a.offsetParent);
      const ls = getComputedStyle(sample || c.root);
      vars = {
        '--cf-muted': hs.color,
        '--cf-head-size': hs.fontSize,
        '--cf-text': ls.color,
        '--cf-size': ls.fontSize,
        '--cf-font': ls.fontFamily,
        '--cf-bg': effectiveBg(c.root),
      };
    } else {
      const bs = getComputedStyle(document.body);
      vars = {
        '--cf-text': bs.color,
        '--cf-muted': `color-mix(in srgb, ${bs.color} 60%, transparent)`,
        '--cf-font': bs.fontFamily,
        '--cf-size': '14px',
        '--cf-head-size': '13px',
        '--cf-bg': effectiveBg(document.body),
      };
    }
    const key = JSON.stringify(vars);
    if (key === themeKey) return;
    themeKey = key;
    for (const [k, v] of Object.entries(vars)) {
      if (!v) continue;
      host.style.setProperty(k, v);
      overlay.style.setProperty(k, v);
    }
  }

  // ------------------------------------------------- page-level side effects

  function ensurePageStyle() {
    if (document.getElementById('claude-folders-page-style')) return;
    const style = document.createElement('style');
    style.id = 'claude-folders-page-style';
    style.textContent = '[data-cf-hidden]{display:none!important}';
    (document.head || document.documentElement).appendChild(style);
  }

  // Wrapper of a Recents row: climb while the parent adds no text of its own
  // (e.g. <li> with an icon-only menu button), so the whole row is hidden.
  function rowWrapper(a, c) {
    let el = a;
    const text = a.textContent.trim();
    for (let i = 0; i < 4; i++) {
      const p = el.parentElement;
      if (!p || p === c.root || p.contains(c.recents) || isOurs(p)) break;
      if (p.textContent.trim() !== text) break;
      el = p;
    }
    return el;
  }

  function applyHiding(c) {
    const keep = new Set();
    if (state.settings.hideInRecents && c && c.recents) {
      const filed = new Set();
      for (const f of state.folders) for (const it of f.items) filed.add(it.path);
      if (filed.size) {
        for (const [a, p] of nativeLinks(c.root)) {
          if (!filed.has(p)) continue;
          if (!(c.recents.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
          const w = rowWrapper(a, c);
          keep.add(w);
          if (!w.hasAttribute('data-cf-hidden')) w.setAttribute('data-cf-hidden', '');
        }
      }
    }
    for (const el of document.querySelectorAll('[data-cf-hidden]')) {
      if (!keep.has(el)) el.removeAttribute('data-cf-hidden');
    }
  }

  // Keep stored titles in sync with what Claude shows (chats get auto-titled
  // after the first message), unless the user renamed the item.
  function refreshTitles(c) {
    if (!c) return;
    const titles = new Map();
    for (const [a, p] of nativeLinks(c.root)) {
      if (!titles.has(p)) {
        const t = textOf(a);
        if (t) titles.set(p, t);
      }
    }
    const changes = [];
    for (const f of state.folders) {
      for (const it of f.items) {
        const t = titles.get(it.path);
        if (t && !it.renamed && t !== it.title) changes.push([it.path, t]);
      }
    }
    if (!changes.length) return;
    S.update((st) => {
      let changed = false;
      for (const [path, t] of changes) {
        for (const f of st.folders) {
          for (const it of f.items) {
            if (it.path === path && !it.renamed && it.title !== t) {
              it.title = t;
              changed = true;
            }
          }
        }
      }
      return changed;
    });
  }

  // "New chat in folder": once the URL turns into a chat we have not seen
  // before, file it into the pending folder.
  function checkPending() {
    const p = state.pending;
    if (!p || p.space !== S.spaceOf(location.pathname)) return;
    if (Date.now() - p.at > PENDING_TTL) {
      S.update((st) => {
        st.pending = null;
      });
      return;
    }
    const path = currentPath();
    if (!path) return;
    if (p.known.includes(path)) {
      // Navigated to an existing chat instead of starting a new one.
      S.update((st) => {
        st.pending = null;
      });
      return;
    }
    const title = titleFor(path);
    S.update((st) => {
      if (!st.pending || st.pending.folderId !== p.folderId) return false;
      S.fileItem(st, p.folderId, path, title);
      st.pending = null;
    });
  }

  function startNewChatIn(folderId) {
    const known = new Set(nativeLinks(document).map(([, p]) => p));
    for (const f of state.folders) for (const it of f.items) known.add(it.path);
    const cur = currentPath();
    if (cur) known.add(cur);
    S.update((st) => {
      const f = S.findFolder(st, folderId);
      if (!f) return false;
      st.pending = { folderId, space: f.space, known: [...known], at: Date.now() };
    }).then(openNewChat);
  }

  // ---------------------------------------------------------------- scan

  let scanTimer = 0;
  function scheduleScan(delay = 150) {
    if (scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      scan();
    }, delay);
  }

  function scan() {
    if (!document.body) return;
    ensurePageStyle();
    const c = locateSidebar();
    const now = Date.now();
    if (c) {
      lastSeen = now;
      mountInline(c);
    } else if (!SIDEBAR_PAGES.test(location.pathname)) {
      unmount();
    } else if (now - lastSeen > 1500 && now - startedAt > 2500) {
      mountFloating();
    }
    applyHiding(c);
    refreshTitles(c);
  }

  function onRouteChange() {
    const newSpace = S.spaceOf(location.pathname);
    if (newSpace !== space) {
      space = newSpace;
      editing = null;
      menu = null;
    }
    checkPending();
    render();
    scheduleScan(0);
  }

  // ---------------------------------------------------------------- render

  function spaceFolders() {
    return state.folders.filter((f) => f.space === space);
  }

  function totalCount(folder) {
    let n = folder.items.length;
    for (const id of S.descendantIds(state, folder.id)) {
      const f = S.findFolder(state, id);
      if (f) n += f.items.length;
    }
    return n;
  }

  // For search: which folders/items stay visible.
  function computeVisibility() {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const folders = new Set();
    const items = new Set();
    const showAll = new Set();
    const byId = new Map(state.folders.map((f) => [f.id, f]));
    const markUp = (f) => {
      for (let p = f; p; p = p.parentId ? byId.get(p.parentId) : null) folders.add(p.id);
    };
    for (const f of spaceFolders()) {
      if (f.name.toLowerCase().includes(q)) {
        markUp(f);
        showAll.add(f.id);
        for (const d of S.descendantIds(state, f.id)) showAll.add(d);
      }
      for (const it of f.items) {
        if (displayTitle(it).toLowerCase().includes(q)) {
          items.add(it.path);
          markUp(f);
        }
      }
    }
    for (const id of showAll) {
      const f = byId.get(id);
      if (!f) continue;
      folders.add(id);
      for (const it of f.items) items.add(it.path);
    }
    return { folders, items };
  }

  function render() {
    if (!shadow) return;
    const active = shadow.activeElement;
    let focusSnap = null;
    if (active && (active.classList.contains('cf-edit') || active.classList.contains('cf-search'))) {
      focusSnap = {
        cls: active.classList.contains('cf-edit') ? 'cf-edit' : 'cf-search',
        value: active.value,
        start: active.selectionStart,
        end: active.selectionEnd,
      };
    }

    const style = h('style', { text: window.ClaudeFoldersCSS });
    const section = renderSection();
    let content;
    if (mode === 'floating') {
      content = h(
        'div',
        {},
        h('button', { class: 'cf-fab', 'data-action': 'fab', title: 'Folders', 'aria-label': 'Folders' }, icon('folder', 20)),
        floatingOpen ? h('div', { class: 'cf-panel' }, section) : null
      );
    } else {
      content = section;
    }
    shadow.replaceChildren(style, content);
    renderOverlay();
    const edit = shadow.querySelector('.cf-edit');
    if (edit) {
      if (focusSnap && focusSnap.cls === 'cf-edit') {
        edit.value = focusSnap.value;
        edit.focus();
        edit.setSelectionRange(focusSnap.start, focusSnap.end);
      } else {
        edit.focus();
        edit.select();
      }
    } else if (focusSnap && focusSnap.cls === 'cf-search') {
      const s = shadow.querySelector('.cf-search');
      if (s) {
        s.focus();
        s.setSelectionRange(focusSnap.start, focusSnap.end);
      }
    }
  }

  function renderSection() {
    const collapsed = !!state.collapsed[space];
    const head = h(
      'div',
      { class: 'cf-head', 'data-drop': 'head' },
      h(
        'button',
        { class: 'cf-head-toggle', 'data-action': 'toggle-section', 'aria-expanded': String(!collapsed) },
        h('span', { text: 'Folders' }),
        icon('chevron', 12, 'cf-chev' + (collapsed ? ' cf-closed' : ''))
      ),
      h(
        'button',
        {
          class: 'cf-icon-btn',
          'data-action': 'toggle-search',
          title: 'Search folders',
          'aria-label': 'Search folders',
          'aria-pressed': String(searchOpen),
        },
        icon('search', 15)
      ),
      h(
        'button',
        { class: 'cf-icon-btn', 'data-action': 'new-folder', title: 'New folder', 'aria-label': 'New folder' },
        icon('folderPlus', 16)
      )
    );
    const root = h('div', { class: 'cf' }, head);
    if (collapsed) return root;

    if (searchOpen || query) {
      root.append(
        h(
          'div',
          { class: 'cf-search-wrap' },
          h('input', {
            class: 'cf-search',
            type: 'search',
            placeholder: 'Search folders and chats',
            value: query,
            'aria-label': 'Search folders and chats',
          })
        )
      );
    }

    const p = state.pending;
    const pendingFolder = p && p.space === space ? S.findFolder(state, p.folderId) : null;
    if (pendingFolder) {
      root.append(
        h(
          'div',
          { class: 'cf-pending' },
          icon('newChat', 13),
          h('span', {}, 'Next new chat goes to ', h('b', { text: pendingFolder.name })),
          h(
            'button',
            { class: 'cf-icon-btn', 'data-action': 'cancel-pending', title: 'Cancel', 'aria-label': 'Cancel' },
            icon('x', 13)
          )
        )
      );
    }

    const vis = computeVisibility();
    const rootFolders = S.children(state, null, space);
    if (!rootFolders.length) {
      root.append(
        h('div', {
          class: 'cf-hint',
          'data-drop': 'hint',
          text: 'Drag a chat here to start a folder, or use the folder + button above.',
        })
      );
      return root;
    }
    const tree = h('div', { class: 'cf-tree', role: 'tree' });
    for (const f of rootFolders) renderFolder(tree, f, 0, vis);
    if (vis && !tree.childElementCount) tree.append(h('div', { class: 'cf-empty', text: 'No matches' }));
    root.append(tree);
    return root;
  }

  function renderFolder(parentEl, folder, depth, vis) {
    if (vis && !vis.folders.has(folder.id)) return;
    const open = vis ? true : !folder.collapsed;
    const isEditing = editing && editing.kind === 'folder' && editing.id === folder.id;
    const pad = 4 + depth * 14;
    const isPendingTarget = state.pending && state.pending.folderId === folder.id;
    const row = h(
      'div',
      {
        class:
          'cf-row cf-folder-row' +
          (menu && menu.folderId === folder.id ? ' cf-menu-open' : '') +
          (isPendingTarget ? ' cf-pending-target' : ''),
        role: 'treeitem',
        'aria-expanded': String(open),
        draggable: isEditing ? 'false' : 'true',
        'data-drop': 'folder',
        'data-id': folder.id,
        'data-action': 'toggle-folder',
        style: `padding-left:${pad}px;${folder.color ? `--cf-folder:${folder.color}` : ''}`,
        title: folder.name,
      },
      h(
        'span',
        { class: 'cf-chev-btn' },
        icon('chevron', 13, 'cf-chev' + (open ? '' : ' cf-closed'))
      ),
      icon('folder', 16, 'cf-folder-icon'),
      isEditing
        ? h('input', { class: 'cf-edit', value: folder.name, 'aria-label': 'Folder name', maxlength: '120' })
        : h('span', { class: 'cf-name', text: folder.name }),
      isEditing ? null : h('span', { class: 'cf-count', text: String(totalCount(folder) || '') }),
      isEditing
        ? null
        : h(
            'span',
            { class: 'cf-actions' },
            h(
              'button',
              {
                class: 'cf-icon-btn',
                'data-action': 'new-chat-in',
                'data-id': folder.id,
                title: 'New chat in this folder',
                'aria-label': 'New chat in this folder',
              },
              icon('newChat', 14)
            ),
            h(
              'button',
              {
                class: 'cf-icon-btn',
                'data-action': 'folder-menu',
                'data-id': folder.id,
                title: 'More',
                'aria-label': 'Folder options',
              },
              icon('more', 16)
            )
          )
    );
    parentEl.append(row);
    if (!open) return;

    const subs = S.children(state, folder.id, space);
    for (const sub of subs) renderFolder(parentEl, sub, depth + 1, vis);

    const here = currentPath();
    const items = vis ? folder.items.filter((it) => vis.items.has(it.path)) : folder.items;
    for (const it of items) {
      const itemEditing = editing && editing.kind === 'item' && editing.path === it.path;
      parentEl.append(
        h(
          'a',
          {
            class: 'cf-row cf-item' + (it.path === here ? ' cf-active' : ''),
            href: it.path,
            draggable: itemEditing ? 'false' : 'true',
            'data-drop': 'item',
            'data-path': it.path,
            'data-folder': folder.id,
            'data-action': 'open-item',
            style: `padding-left:${pad + 18}px`,
            title: displayTitle(it),
            role: 'treeitem',
          },
          h('span', { class: 'cf-dot' }, icon('chat', 13)),
          itemEditing
            ? h('input', { class: 'cf-edit', value: displayTitle(it), 'aria-label': 'Chat name', maxlength: '200' })
            : h('span', { class: 'cf-name', text: displayTitle(it) }),
          itemEditing
            ? null
            : h(
                'span',
                { class: 'cf-actions' },
                h(
                  'button',
                  {
                    class: 'cf-icon-btn',
                    'data-action': 'remove-item',
                    'data-path': it.path,
                    title: 'Remove from folder',
                    'aria-label': 'Remove from folder',
                  },
                  icon('x', 14)
                )
              )
        )
      );
    }
    if (!subs.length && !folder.items.length && !vis) {
      parentEl.append(
        h('div', {
          class: 'cf-empty',
          'data-drop': 'empty',
          'data-folder': folder.id,
          style: `padding-left:${pad + 26}px`,
          text: 'Empty — drag chats here',
        })
      );
    }
  }

  function renderMenu() {
    const f = S.findFolder(state, menu.folderId);
    if (!f) return '';
    const here = currentPath();
    const inThis = here && f.items.some((it) => it.path === here);
    const item = (action, iconName, label, opts = {}) =>
      h(
        'button',
        {
          class: 'cf-menu-item' + (opts.danger ? ' cf-danger' : ''),
          'data-action': action,
          'data-id': f.id,
          disabled: opts.disabled || false,
          role: 'menuitem',
        },
        icon(iconName, 15),
        h('span', { text: label })
      );
    const swatches = h(
      'div',
      { class: 'cf-swatches', role: 'radiogroup', 'aria-label': 'Folder color' },
      S.COLORS.map((c) =>
        h(
          'button',
          {
            class: 'cf-swatch',
            role: 'radio',
            'aria-checked': String((f.color || '') === c),
            'aria-label': c || 'Default color',
            title: c || 'Default',
            'data-action': 'set-color',
            'data-id': f.id,
            'data-color': c,
            style: c ? `background:${c}` : 'background:transparent',
          },
          c ? null : icon('x', 10)
        )
      )
    );
    return h(
      'div',
      { class: 'cf-menu', role: 'menu' },
      item('new-chat-in', 'newChat', 'New chat in folder'),
      item('add-current', 'pin', inThis ? 'Current chat is in this folder' : 'Add current chat', {
        disabled: !here || inThis || S.spaceOf(here) !== f.space,
      }),
      item('new-subfolder', 'folderPlus', 'New subfolder'),
      item('rename-folder', 'pencil', 'Rename'),
      f.parentId ? item('move-top', 'up', 'Move to top level') : null,
      h('div', { class: 'cf-menu-label', text: 'Color' }),
      swatches,
      h('div', { class: 'cf-menu-sep' }),
      item('delete-folder', 'trash', 'Delete folder', { danger: true })
    );
  }

  function renderOverlay() {
    const el = menu && renderMenu();
    if (!el) {
      if (overlay.isConnected) overlay.remove();
      overlayShadow.replaceChildren();
      return;
    }
    if (overlay.parentElement !== document.body) document.body.appendChild(overlay);
    overlayShadow.replaceChildren(h('style', { text: window.ClaudeFoldersCSS }), el);
    positionMenu();
  }

  function positionMenu() {
    const el = overlayShadow.querySelector('.cf-menu');
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x = menu.x;
    let y = menu.y;
    if (x + r.width > innerWidth - 8) x = innerWidth - r.width - 8;
    if (y + r.height > innerHeight - 8) y = Math.max(8, innerHeight - r.height - 8);
    x = Math.max(8, x);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }

  // ---------------------------------------------------------------- actions

  function closeMenu() {
    if (!menu) return;
    menu = null;
    render();
  }

  function newFolder(parentId, withLink) {
    S.update((st) => {
      const f = S.addFolder(st, { name: 'New folder', space, parentId });
      if (withLink) S.fileItem(st, f.id, withLink.path, withLink.title);
      st.collapsed[space] = false;
      editing = { kind: 'folder', id: f.id };
    });
  }

  function commitEdit(cancel) {
    const e = editing;
    if (!e) return;
    editing = null;
    const input = shadow.querySelector('.cf-edit');
    const value = input ? input.value.trim() : '';
    if (cancel || !input) {
      render();
      return;
    }
    S.update((st) => {
      if (e.kind === 'folder') {
        const f = S.findFolder(st, e.id);
        if (!f || !value || value === f.name) return false;
        f.name = value;
      } else {
        for (const f of st.folders) {
          for (const it of f.items) {
            if (it.path !== e.path) continue;
            if (value && value !== it.title) {
              it.title = value;
              it.renamed = true;
            } else if (!value) {
              it.renamed = false;
              it.title = titleFor(it.path) || it.title;
            }
          }
        }
      }
    }).then(render);
  }

  function handleAction(action, el, ev) {
    const id = el.getAttribute('data-id');
    switch (action) {
      case 'fab':
        floatingOpen = !floatingOpen;
        render();
        break;
      case 'toggle-section':
        S.update((st) => {
          st.collapsed[space] = !st.collapsed[space];
        });
        break;
      case 'toggle-search':
        searchOpen = !searchOpen;
        if (!searchOpen) query = '';
        render();
        if (searchOpen) shadow.querySelector('.cf-search')?.focus();
        break;
      case 'new-folder':
        newFolder(null);
        break;
      case 'toggle-folder':
        if (editing && editing.kind === 'folder' && editing.id === id) return;
        S.update((st) => {
          const f = S.findFolder(st, id);
          if (!f) return false;
          f.collapsed = !f.collapsed;
        });
        break;
      case 'folder-menu': {
        const r = el.getBoundingClientRect();
        menu = menu && menu.folderId === id ? null : { folderId: id, x: r.left, y: r.bottom + 4 };
        render();
        break;
      }
      case 'new-chat-in':
        menu = null;
        startNewChatIn(id);
        break;
      case 'add-current': {
        const path = currentPath();
        menu = null;
        if (!path) return render();
        const title = titleFor(path);
        S.update((st) => S.fileItem(st, id, path, title));
        break;
      }
      case 'new-subfolder':
        menu = null;
        newFolder(id);
        break;
      case 'rename-folder':
        menu = null;
        editing = { kind: 'folder', id };
        render();
        break;
      case 'move-top':
        menu = null;
        S.update((st) => S.moveFolder(st, id, null, 'into'));
        break;
      case 'set-color': {
        const color = el.getAttribute('data-color') || '';
        S.update((st) => {
          const f = S.findFolder(st, id);
          if (!f) return false;
          f.color = color;
        });
        break;
      }
      case 'delete-folder': {
        const f = S.findFolder(state, id);
        menu = null;
        if (!f) return render();
        const subs = S.descendantIds(state, id).size;
        const chats = totalCount(f);
        const detail = [subs ? `${subs} subfolder${subs > 1 ? 's' : ''}` : '', chats ? `${chats} chat link${chats > 1 ? 's' : ''}` : '']
          .filter(Boolean)
          .join(' and ');
        const msg =
          `Delete folder "${f.name}"` +
          (detail ? ` with ${detail}` : '') +
          '?\n\nYour chats are not deleted — they go back to Recents.';
        if (!confirm(msg)) return render();
        S.update((st) => S.deleteFolder(st, id));
        break;
      }
      case 'remove-item': {
        ev.preventDefault();
        const path = el.getAttribute('data-path');
        S.update((st) => S.removeItem(st, path));
        break;
      }
      case 'cancel-pending':
        S.update((st) => {
          st.pending = null;
        });
        break;
      case 'open-item': {
        if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
        if (editing && editing.kind === 'item' && editing.path === el.getAttribute('data-path')) {
          ev.preventDefault();
          return;
        }
        ev.preventDefault();
        if (mode === 'floating') floatingOpen = false;
        navigate(el.getAttribute('data-path'));
        break;
      }
    }
  }

  // ---------------------------------------------------------------- dnd

  function dropEffectFor(dt) {
    const allowed = dt.effectAllowed;
    if (!allowed || allowed === 'all' || allowed === 'uninitialized' || allowed.toLowerCase().includes('move')) return 'move';
    if (allowed.toLowerCase().includes('copy')) return 'copy';
    return 'link';
  }

  function currentDrag(ev) {
    if (drag) return drag;
    const types = ev.dataTransfer ? [...ev.dataTransfer.types] : [];
    if (types.includes('text/uri-list')) return { kind: 'link', path: null, title: '' };
    return null;
  }

  function dropTarget(ev) {
    const el = ev.composedPath().find((n) => n instanceof Element && n.hasAttribute && n.hasAttribute('data-drop'));
    if (!el || !shadow.contains(el)) return null;
    const d = currentDrag(ev);
    if (!d) return null;
    const kind = el.getAttribute('data-drop');
    const isChat = d.kind === 'link' || d.kind === 'item';
    if (isChat && d.path && S.spaceOf(d.path) !== space) return null;

    if (kind === 'folder') {
      const id = el.getAttribute('data-id');
      if (isChat) return { el, where: 'into', folderId: id };
      if (d.kind === 'folder') {
        if (d.id === id || S.descendantIds(state, d.id).has(id)) return null;
        const r = el.getBoundingClientRect();
        const where = ev.clientY < r.top + r.height * 0.3 ? 'before' : 'into';
        return { el, where, folderId: id };
      }
    }
    if (kind === 'item') {
      const folderId = el.getAttribute('data-folder');
      const path = el.getAttribute('data-path');
      if (isChat) return d.path === path ? null : { el, where: 'before', folderId, beforePath: path };
      return null;
    }
    if (kind === 'empty') {
      const folderId = el.getAttribute('data-folder');
      if (d.kind === 'folder' && (d.id === folderId || S.descendantIds(state, d.id).has(folderId))) return null;
      return { el, where: 'into', folderId };
    }
    if (kind === 'head' || kind === 'hint') {
      if (d.kind === 'folder') return { el, where: 'root' };
      if (d.kind === 'link') return { el, where: 'new-folder' };
      return null;
    }
    return null;
  }

  let marked = null;
  function markDrop(t) {
    if (marked && (!t || marked.el !== t.el || marked.cls !== cls(t))) {
      marked.el.classList.remove(marked.cls);
      marked = null;
    }
    if (t && !marked) {
      marked = { el: t.el, cls: cls(t) };
      t.el.classList.add(marked.cls);
    }
    function cls(x) {
      return x.where === 'before' ? 'cf-drop-before' : 'cf-drop-into';
    }
  }

  function performDrop(t, d, ev) {
    if (d.kind === 'link' && !d.path) {
      const uri = (ev.dataTransfer.getData('text/uri-list') || ev.dataTransfer.getData('text/plain') || '')
        .split('\n')
        .find((l) => l && !l.startsWith('#'));
      d = { kind: 'link', path: uri ? S.toPath(uri.trim()) : null, title: '' };
      if (!d.path || S.spaceOf(d.path) !== space) return;
      d.title = titleFor(d.path);
    }
    if (d.kind === 'folder') {
      if (t.where === 'root') S.update((st) => S.moveFolder(st, d.id, null, 'into'));
      else S.update((st) => S.moveFolder(st, d.id, t.folderId, t.where));
      return;
    }
    if (t.where === 'new-folder') {
      newFolder(null, d);
      return;
    }
    S.update((st) => S.fileItem(st, t.folderId, d.path, d.title, t.beforePath));
  }

  // ---------------------------------------------------------------- events

  function onClick(ev) {
    const el = ev.composedPath().find((n) => n instanceof Element && n.hasAttribute('data-action'));
    if (!el) return;
    if (ev.target.classList && ev.target.classList.contains('cf-edit')) {
      ev.preventDefault(); // the input may sit inside an item <a>
      return;
    }
    handleAction(el.getAttribute('data-action'), el, ev);
  }

  function bindEvents() {
    shadow.addEventListener('click', onClick);

    shadow.addEventListener('dblclick', (ev) => {
      const name = ev.composedPath().find((n) => n instanceof Element && n.classList.contains('cf-name'));
      if (!name) return;
      const row = name.closest('.cf-row');
      ev.preventDefault();
      if (row.classList.contains('cf-folder-row')) {
        // The two clicks of the double-click toggled the folder twice, so
        // it is back where it was.
        editing = { kind: 'folder', id: row.getAttribute('data-id') };
      } else {
        editing = { kind: 'item', path: row.getAttribute('data-path') };
      }
      render();
    });

    shadow.addEventListener('keydown', (ev) => {
      const t = ev.target;
      if (t.classList.contains('cf-edit')) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commitEdit(false);
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          commitEdit(true);
        }
        ev.stopPropagation();
      } else if (t.classList.contains('cf-search')) {
        if (ev.key === 'Escape') {
          query = '';
          searchOpen = false;
          render();
        }
        ev.stopPropagation();
      } else if (ev.key === 'Escape' && menu) {
        closeMenu();
      }
    });

    shadow.addEventListener('input', (ev) => {
      if (ev.target.classList.contains('cf-search')) {
        query = ev.target.value;
        render();
      }
    });

    shadow.addEventListener('focusout', (ev) => {
      if (ev.target.classList.contains('cf-edit')) {
        // Defer so a click that re-renders does not race the commit.
        setTimeout(() => {
          if (editing && shadow.activeElement !== shadow.querySelector('.cf-edit')) commitEdit(false);
        }, 0);
      }
    });

    shadow.addEventListener('mousedown', (ev) => {
      // Keep clicks inside the edit field from bubbling into row toggles.
      if (ev.target.classList && ev.target.classList.contains('cf-edit')) ev.stopPropagation();
    });

    shadow.addEventListener('dragstart', (ev) => {
      const row = ev.composedPath().find((n) => n instanceof Element && n.classList.contains('cf-row'));
      if (!row) return;
      if (row.classList.contains('cf-folder-row')) {
        const id = row.getAttribute('data-id');
        drag = { kind: 'folder', id };
        ev.dataTransfer.effectAllowed = 'move';
        ev.dataTransfer.setData('text/plain', S.findFolder(state, id)?.name || '');
      } else {
        const path = row.getAttribute('data-path');
        drag = { kind: 'item', path, folderId: row.getAttribute('data-folder'), title: '' };
        ev.dataTransfer.effectAllowed = 'copyMove';
        ev.dataTransfer.setData('text/uri-list', location.origin + path);
        ev.dataTransfer.setData('text/plain', location.origin + path);
      }
      menu = null;
      requestAnimationFrame(() => row.classList.add('cf-dragging'));
    });

    shadow.addEventListener('dragover', (ev) => {
      const t = dropTarget(ev);
      markDrop(t);
      if (!t) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = dropEffectFor(ev.dataTransfer);
    });

    shadow.addEventListener('dragleave', (ev) => {
      if (!ev.relatedTarget || !host.contains(ev.relatedTarget)) markDrop(null);
    });

    shadow.addEventListener('drop', (ev) => {
      const t = dropTarget(ev);
      const d = currentDrag(ev);
      markDrop(null);
      if (!t || !d) return;
      ev.preventDefault();
      performDrop(t, d, ev);
      drag = null;
    });
  }

  // Native sidebar links dragged toward our section.
  document.addEventListener(
    'dragstart',
    (ev) => {
      if (host && ev.composedPath().includes(host)) return;
      const a = ev.composedPath().find((n) => n instanceof Element && n.tagName === 'A' && n.href);
      const path = a && S.toPath(a.href);
      drag = path ? { kind: 'link', path, title: textOf(a) } : null;
    },
    true
  );
  document.addEventListener(
    'dragend',
    () => {
      drag = null;
      markDrop(null);
      shadow?.querySelectorAll('.cf-dragging').forEach((el) => el.classList.remove('cf-dragging'));
    },
    true
  );

  document.addEventListener(
    'mousedown',
    (ev) => {
      if (!menu) return;
      const inMenu = ev.composedPath().some((n) => n instanceof Element && n.classList?.contains('cf-menu'));
      const onToggle = ev.composedPath().some((n) => n instanceof Element && n.getAttribute?.('data-action') === 'folder-menu');
      if (!inMenu && !onToggle) closeMenu();
    },
    true
  );
  window.addEventListener('resize', () => menu && closeMenu());
  document.addEventListener(
    'scroll',
    (ev) => {
      // Only when the sidebar itself scrolls, not when a reply streams in.
      const t = ev.target;
      if (menu && host && (t === document || (t instanceof Element && t.contains(host)))) closeMenu();
    },
    true
  );

  // Context-menu "Add to folder" from the background worker.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || typeof msg !== 'object') return;
    const path = msg.url && S.toPath(msg.url);
    if (!path) return;
    const title = titleFor(path);
    if (msg.type === 'cf-add-link') {
      S.update((st) => S.fileItem(st, msg.folderId, path, title));
    } else if (msg.type === 'cf-new-folder-with-link') {
      space = S.spaceOf(location.pathname);
      newFolder(null, { path, title });
    }
  });

  // ---------------------------------------------------------------- boot

  S.onChange((next) => {
    state = next;
    if (editing && editing.kind === 'folder' && !S.findFolder(state, editing.id)) editing = null;
    if (menu && !S.findFolder(state, menu.folderId)) menu = null;
    render();
    scheduleScan(0);
  });

  S.load().then((s) => {
    state = s;
    render();
    scan();
    checkPending();
  });

  new MutationObserver(() => scheduleScan()).observe(document.documentElement, { childList: true, subtree: true });

  let ticks = 0;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      onRouteChange();
    }
    // A quiet page produces no mutations, so re-check now and then while
    // the section is not sitting in the sidebar (e.g. sidebar collapsed).
    if (++ticks % 5 === 0 && (mode !== 'inline' || !cacheValid())) scheduleScan(0);
  }, 400);
  window.addEventListener('popstate', () => scheduleScan(0));
})();
