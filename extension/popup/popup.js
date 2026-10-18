(() => {
  'use strict';
  const S = window.ClaudeFoldersStore;
  const $ = (id) => document.getElementById(id);
  const isPopup = () => chrome.extension.getViews({ type: 'popup' }).includes(window);

  function show(state) {
    const count = (sp) => state.folders.filter((f) => f.space === sp).length;
    const chats = state.folders.reduce((n, f) => n + f.items.length, 0);
    $('stats').textContent =
      `${count('chat')} chat folder${count('chat') === 1 ? '' : 's'} · ` +
      `${count('code')} Code folder${count('code') === 1 ? '' : 's'} · ${chats} filed`;
    $('hideInRecents').checked = !!state.settings.hideInRecents;
  }

  function say(text) {
    $('message').textContent = text;
  }

  S.load().then(show);
  S.onChange(show);

  $('hideInRecents').addEventListener('change', (e) => {
    const on = e.target.checked;
    S.update((st) => {
      st.settings.hideInRecents = on;
    });
  });

  $('export').addEventListener('click', async () => {
    const state = await S.load();
    const data = { app: 'claude-folders', exportedAt: new Date().toISOString(), folders: state.folders, settings: state.settings };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `claude-folders-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    say('Exported.');
  });

  $('import').addEventListener('click', () => {
    // The file picker closes extension popups, so import from the full page.
    if (isPopup()) chrome.runtime.openOptionsPage();
    else $('importFile').click();
  });

  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (_) {
      say('That file is not valid JSON.');
      return;
    }
    const incoming = S.normalize({ folders: data.folders, settings: data.settings });
    if (!incoming.folders.length) {
      say('No folders found in that file.');
      return;
    }
    const replace = confirm(
      `Import ${incoming.folders.length} folders.\n\nOK = replace your current folders\nCancel = merge them in`
    );
    await S.update((st) => {
      if (replace) {
        st.folders = incoming.folders;
        st.pending = null;
      } else {
        const ids = new Set(st.folders.map((f) => f.id));
        for (const f of incoming.folders) {
          if (ids.has(f.id)) continue;
          // A chat lives in one folder; existing placement wins.
          f.items = f.items.filter((it) => !S.folderOfPath(st, it.path));
          st.folders.push(f);
        }
      }
      Object.assign(st.settings, incoming.settings);
    });
    say(replace ? 'Folders replaced.' : 'Folders merged.');
  });
})();
