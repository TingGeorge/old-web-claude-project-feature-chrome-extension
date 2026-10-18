// Right-click "Add to folder" menu on chat links inside claude.ai. The menu
// mirrors the folder tree and is rebuilt whenever the folders change.
importScripts('src/store.js');

const S = self.ClaudeFoldersStore;
const PATTERNS = ['https://claude.ai/chat/*', 'https://claude.ai/code/*'];
const SPACE_LABEL = { code: 'Claude Code', chat: 'Chats' };

let building = Promise.resolve();

function create(props) {
  return new Promise((resolve) => chrome.contextMenus.create(props, () => {
    void chrome.runtime.lastError; // ignore duplicate-id races
    resolve();
  }));
}

function rebuild() {
  building = building.then(async () => {
    await chrome.contextMenus.removeAll();
    const state = await S.load();
    const base = { contexts: ['link'], documentUrlPatterns: ['https://claude.ai/*'], targetUrlPatterns: PATTERNS };
    await create({ ...base, id: 'cf-root', title: 'Add to folder' });
    await create({ ...base, id: 'cf-new', parentId: 'cf-root', title: 'New folder…' });
    const spaces = S.SPACES.filter((sp) => state.folders.some((f) => f.space === sp));
    if (spaces.length) await create({ ...base, id: 'cf-sep', parentId: 'cf-root', type: 'separator' });
    for (const sp of spaces) {
      if (spaces.length > 1) {
        await create({ ...base, id: 'cf-space-' + sp, parentId: 'cf-root', title: SPACE_LABEL[sp], enabled: false });
      }
      const walk = async (parentId, depth) => {
        for (const f of S.children(state, parentId, sp)) {
          await create({
            ...base,
            id: 'cf-add:' + f.id,
            parentId: 'cf-root',
            title: ' '.repeat(depth + (spaces.length > 1 ? 1 : 0)) + f.name,
          });
          await walk(f.id, depth + 1);
        }
      };
      await walk(null, 0);
    }
  }).catch(() => {});
  return building;
}

let timer = 0;
function scheduleRebuild() {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 200);
}

chrome.runtime.onInstalled.addListener(rebuild);
chrome.runtime.onStartup.addListener(rebuild);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[S.KEY]) scheduleRebuild();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id === undefined || !info.linkUrl) return;
  const id = String(info.menuItemId);
  if (id === 'cf-new') {
    chrome.tabs.sendMessage(tab.id, { type: 'cf-new-folder-with-link', url: info.linkUrl }).catch(() => {});
  } else if (id.startsWith('cf-add:')) {
    chrome.tabs.sendMessage(tab.id, { type: 'cf-add-link', folderId: id.slice(7), url: info.linkUrl }).catch(() => {});
  }
});
