// Unit tests for the folder data model (extension/src/store.js).
// Run: node tests/test_store.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";

globalThis.window = globalThis;
createRequire(import.meta.url)("../extension/src/store.js");
const S = globalThis.ClaudeFoldersStore;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

test("toPath accepts real chats and sessions only", () => {
  const cases = [
    ["/code/session_01GnhfywNuweez6NNdGGFBmR", "/code/session_01GnhfywNuweez6NNdGGFBmR"],
    ["https://claude.ai/code/session_abc?x=1#y", "/code/session_abc"],
    ["/chat/3f2a9c1e-1111-2222-3333-444455556666", "/chat/3f2a9c1e-1111-2222-3333-444455556666"],
    ["/code", null],
    ["/code/projects", null],
    ["/code/artifacts", null],
    ["/new", null],
    ["/chat/new", null],
    ["/code/session_abc/extra", null],
    ["https://example.com/code/session_abc", null],
    ["not a url ::", null],
  ];
  for (const [input, want] of cases) assert.equal(S.toPath(input), want, input);
});

test("spaceOf separates Claude Code from chats", () => {
  assert.equal(S.spaceOf("/code"), "code");
  assert.equal(S.spaceOf("/code/session_x"), "code");
  assert.equal(S.spaceOf("/chat/abc"), "chat");
  assert.equal(S.spaceOf("/new"), "chat");
  assert.equal(S.spaceOf("/codex"), "chat");
});

test("normalize repairs bad data", () => {
  const s = S.normalize({
    folders: [
      { id: "a", name: "A", space: "code", parentId: "b" },
      { id: "b", name: "B", space: "code", parentId: "a" }, // cycle
      { id: "c", name: "C", space: "chat", parentId: "a" }, // parent in other space
      { id: "d", name: "D", space: "code", parentId: "missing" },
      { id: "a", name: "Duplicate id", space: "code" },
      { name: 42 }, // invalid, dropped
      { id: "e", name: "E", items: [{ path: "/code/session_1", title: "One" }, { title: "no path" }] },
    ],
    pending: { folderId: "nope" },
  });
  assert.equal(s.folders.length, 6);
  const ids = s.folders.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  // No folder can reach itself through its parents.
  const byId = new Map(s.folders.map((f) => [f.id, f]));
  for (const f of s.folders) {
    const seen = new Set();
    for (let p = f; p; p = p.parentId ? byId.get(p.parentId) : null) {
      assert.ok(!seen.has(p.id), `cycle through ${f.id}`);
      seen.add(p.id);
    }
  }
  assert.equal(byId.get("c").parentId, null);
  assert.equal(byId.get("d").parentId, null);
  assert.equal(byId.get("e").items.length, 1);
  assert.equal(s.pending, null);
  assert.equal(s.settings.hideInRecents, true);
});

test("a chat lives in exactly one folder", () => {
  const s = S.defaultState();
  const a = S.addFolder(s, { name: "A", space: "code" });
  const b = S.addFolder(s, { name: "B", space: "code" });
  S.fileItem(s, a.id, "/code/session_1", "One");
  S.fileItem(s, a.id, "/code/session_2", "Two");
  S.fileItem(s, b.id, "/code/session_1", "One again");
  assert.deepEqual(a.items.map((i) => i.path), ["/code/session_2"]);
  assert.deepEqual(b.items.map((i) => i.path), ["/code/session_1"]);
  assert.equal(S.folderOfPath(s, "/code/session_1").id, b.id);
});

test("fileItem inserts before another chat and keeps custom names", () => {
  const s = S.defaultState();
  const a = S.addFolder(s, { name: "A", space: "code" });
  S.fileItem(s, a.id, "/code/session_1", "One");
  S.fileItem(s, a.id, "/code/session_2", "Two");
  S.fileItem(s, a.id, "/code/session_3", "Three", "/code/session_1");
  assert.deepEqual(a.items.map((i) => i.path), ["/code/session_3", "/code/session_1", "/code/session_2"]);
  a.items[0].title = "Renamed";
  a.items[0].renamed = true;
  S.fileItem(s, a.id, "/code/session_3", "Claude's title");
  assert.equal(a.items.at(-1).title, "Renamed");
});

test("filing into a collapsed subfolder expands its parents", () => {
  const s = S.defaultState();
  const top = S.addFolder(s, { name: "Top", space: "code" });
  const sub = S.addFolder(s, { name: "Sub", space: "code", parentId: top.id });
  top.collapsed = true;
  sub.collapsed = true;
  S.fileItem(s, sub.id, "/code/session_1", "One");
  assert.equal(top.collapsed, false);
  assert.equal(sub.collapsed, false);
});

test("moveFolder nests, reorders and refuses cycles", () => {
  const s = S.defaultState();
  const a = S.addFolder(s, { name: "A", space: "code" });
  const b = S.addFolder(s, { name: "B", space: "code" });
  const c = S.addFolder(s, { name: "C", space: "chat" });
  assert.equal(S.moveFolder(s, b.id, a.id, "into"), true);
  assert.equal(b.parentId, a.id);
  assert.equal(S.moveFolder(s, a.id, b.id, "into"), false, "parent into its own child");
  assert.equal(S.moveFolder(s, a.id, a.id, "into"), false, "into itself");
  assert.equal(S.moveFolder(s, a.id, c.id, "into"), false, "across spaces");
  assert.equal(S.moveFolder(s, b.id, a.id, "before"), true);
  assert.equal(b.parentId, null);
  assert.deepEqual(S.children(s, null, "code").map((f) => f.name), ["B", "A"]);
  assert.equal(S.moveFolder(s, b.id, null, "into"), true);
  assert.deepEqual(S.children(s, null, "code").map((f) => f.name), ["A", "B"]);
});

test("deleteFolder removes subfolders and a pending new chat", () => {
  const s = S.defaultState();
  const a = S.addFolder(s, { name: "A", space: "code" });
  const b = S.addFolder(s, { name: "B", space: "code", parentId: a.id });
  S.addFolder(s, { name: "C", space: "code", parentId: b.id });
  const keep = S.addFolder(s, { name: "Keep", space: "code" });
  s.pending = { folderId: b.id, space: "code", known: [], at: Date.now() };
  S.deleteFolder(s, a.id);
  assert.deepEqual(s.folders.map((f) => f.id), [keep.id]);
  assert.equal(s.pending, null);
});

test("removeItem takes a chat out of its folder", () => {
  const s = S.defaultState();
  const a = S.addFolder(s, { name: "A", space: "code" });
  S.fileItem(s, a.id, "/code/session_1", "One");
  S.removeItem(s, "/code/session_1");
  assert.equal(a.items.length, 0);
  assert.equal(S.folderOfPath(s, "/code/session_1"), null);
});

console.log(`store: ${passed} tests passed`);
