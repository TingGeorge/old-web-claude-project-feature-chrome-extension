# Claude Folders

A Chrome extension that brings back simple **folders** for organizing your
chats on claude.ai, like the old Projects feature, without using the new
Projects. It adds a **Folders** section to the left sidebar, above
Pinned/Starred and Recents, in both:

- **Claude Code** (`claude.ai/code`): sessions
- **Claude chats** (`claude.ai/chat`): regular conversations

Each sidebar has its own folder tree.

## Features

- **Folders and subfolders.** Create, rename, nest, reorder and collapse them.
- **Drag and drop.** Drag a chat from Recents onto a folder. Drag chats
  between folders, or drag a folder onto another folder to nest it (drop on
  the top edge of a folder to put it *before* that folder instead).
- **New chat in folder.** Hover a folder and click the pencil icon, or use
  ⋯ → *New chat in folder*. The next chat you start is filed into that folder
  automatically, like starting a chat inside an old Project.
- **Filed chats are hidden from Recents**, so Recents only shows what isn't
  organized yet. You can turn this off in the extension popup.
- **Folder colors.** ⋯ → *Color*.
- **Search.** The 🔍 button next to *Folders* filters folders and chats by name.
- **Right-click a chat → Add to folder.** Works on any chat link on claude.ai.
- **Add current chat.** ⋯ → *Add current chat* files the chat you have open.
- **Export / import** your folders as JSON from the extension popup.

Chat titles update on their own when Claude renames a chat. Double-click a
chat or folder name to set your own name (clear the name to go back to
Claude's title). Deleting a folder never deletes chats. They go back to
Recents.

## Install (developer mode)

1. Download or clone this repository.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder (the one containing
   `manifest.json`).
4. Open or reload <https://claude.ai/code> or <https://claude.ai>.

To update after pulling changes, click the reload ↻ icon on the extension
card in `chrome://extensions`, then reload the claude.ai tab.

## How it works and privacy

- Folders are stored only in your browser (`chrome.storage.local`). Nothing
  is sent anywhere, and the extension makes no network requests.
- The extension only stores which chat URL is in which folder, plus a title
  for display. It never reads your messages.
- It finds the sidebar by its *Pinned* / *Starred* / *Recents* headings and
  inserts its section above them. If the sidebar can't be found (e.g. it's
  collapsed), a small floating folder button appears at the bottom-left
  instead.
- Permissions: `storage` (save folders) and `contextMenus` (the right-click
  *Add to folder* menu). The content script runs only on `https://claude.ai/*`.

Because claude.ai can change its page layout at any time, a future redesign
may need a small update to how the sidebar is detected (`locateSidebar` in
`src/content.js`).

## Files

| Path | Purpose |
| --- | --- |
| `manifest.json` | Extension manifest (MV3) |
| `src/store.js` | Folder data model and storage, shared by every part |
| `src/content.js` | Sidebar UI injected into claude.ai |
| `src/styles.js` | Styles for the sidebar UI (inside a shadow root) |
| `background.js` | Right-click *Add to folder* menu |
| `popup/` | Toolbar popup / options page: settings, export, import |
| `icons/` | Extension icons |
