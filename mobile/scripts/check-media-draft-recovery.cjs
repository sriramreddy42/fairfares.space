const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/utils/chatMediaDrafts.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const storage = new Map(), files = new Map();
let copyFailure = false;
const asyncStorage = {
  getItem: async key => storage.get(key) || null,
  setItem: async (key, value) => storage.set(key, value),
  removeItem: async key => storage.delete(key),
  getAllKeys: async () => [...storage.keys()],
  multiGet: async keys => keys.map(key => [key, storage.get(key) || null]),
};
const fileSystem = {
  documentDirectory: '/documents/',
  makeDirectoryAsync: async () => {},
  copyAsync: async ({ from, to }) => { assert.ok(files.has(from)); files.set(to, copyFailure ? 1 : files.get(from)); if (copyFailure) throw new Error('interrupted copy'); },
  moveAsync: async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from); },
  getInfoAsync: async uri => ({ exists: files.has(uri), size: files.get(uri) }),
  deleteAsync: async uri => files.delete(uri),
};
function restart() {
  const context = { exports: {}, require: name => name.includes('async-storage') ? { default: asyncStorage } : name.includes('file-system') ? fileSystem : { Platform: { OS: 'ios' } } };
  vm.createContext(context); vm.runInContext(compiled, context); return context.exports;
}
function attachment(name, kind = 'IMAGE', size = 50) {
  const uri = `/picker/${name}`; files.set(uri, size);
  return { kind, uri, name, mimeType: kind === 'IMAGE' ? 'image/jpeg' : kind === 'VIDEO' ? 'video/mp4' : 'application/pdf', size };
}
(async () => {
  let api = restart();
  const photo = await api.saveChatMediaDraft(7, 'chat-a', { ...attachment('photo.jpg'), preparation: Promise.resolve({}) }, 'album caption', 'batch-a');
  const video = await api.saveChatMediaDraft(7, 'chat-a', attachment('video.mp4', 'VIDEO', 1000), '', 'batch-a');
  const firstDoc = await api.saveChatMediaDraft(7, 'chat-a', attachment('one.pdf', 'FILE'), 'first document', 'batch-b');
  const secondDoc = await api.saveChatMediaDraft(7, 'chat-a', attachment('two.pdf', 'FILE'), 'second document', 'batch-c');
  for (const uri of [...files.keys()]) if (uri.startsWith('/picker/')) files.delete(uri);
  api = restart();
  let restored = await api.readChatMediaDrafts(7, 'chat-a');
  assert.equal(restored.length, 4);
  assert.ok(restored.every(draft => files.has(draft.attachment.uri)));
  assert.equal(restored[0].caption, 'album caption');
  assert.equal(restored[0].attachment.preparation, undefined);
  assert.equal(api.firstChatMediaDraftBatch(restored).length, 2, 'restore mixed album, not unrelated documents');
  assert.equal((await api.readChatMediaDrafts(8, 'chat-a')).length, 0);
  assert.equal((await api.readChatMediaDrafts(7, 'chat-b')).length, 0);

  // Metadata corruption must not hide healthy drafts or follow an arbitrary path.
  storage.set('fairfares.chitthi.media-draft.v1.7.corrupt', '{');
  storage.set('fairfares.chitthi.multipart.v1.7.corrupt', '{');
  assert.equal((await api.readChatMediaDrafts(7, 'chat-a')).length, 4);

  // Crash between encrypted queue commit and draft cleanup does not duplicate.
  files.set('/documents/encrypted', 75);
  storage.set('fairfares.chitthi.multipart.v1.7.hash', JSON.stringify({ ownerUserId: 7, conversationId: 'chat-a', recoveryDraftId: photo.recoveryDraftId, encryptedUri: '/documents/encrypted', encryptedSize: 75 }));
  assert.equal((await api.readChatMediaDrafts(7, 'chat-a')).length, 3);
  files.delete('/documents/encrypted');
  assert.equal((await api.readChatMediaDrafts(7, 'chat-a')).length, 4, 'missing ciphertext leaves source available to retry');
  await api.removeChatMediaDraft(7, photo);
  await api.removeChatMediaDraft(7, video);
  restored = await api.readChatMediaDrafts(7, 'chat-a');
  assert.equal(api.firstChatMediaDraftBatch(restored).length, 1);
  assert.equal(api.firstChatMediaDraftBatch(restored)[0].caption, 'first document');
  await api.removeChatMediaDraft(7, firstDoc);
  restored = await api.readChatMediaDrafts(7, 'chat-a');
  assert.equal(api.firstChatMediaDraftBatch(restored)[0].caption, 'second document');

  // Retrying a restored file updates the edited caption without copying a
  // disappeared picker URI or losing the draft's original raw-source metadata.
  const restoredDoc = restored[0].attachment;
  await api.saveChatMediaDraft(7, 'chat-a', restoredDoc, 'edited caption', 'ignored-new-batch');
  assert.equal((await api.readChatMediaDrafts(7, 'chat-a'))[0].caption, 'edited caption');
  await assert.rejects(api.saveChatMediaDraft(7, 'chat-b', restoredDoc, 'wrong chat'));
  await api.removeChatMediaDraft(7, secondDoc);
  assert.equal((await api.readChatMediaDrafts(7, 'chat-a')).length, 0);

  copyFailure = true;
  await assert.rejects(api.saveChatMediaDraft(7, 'chat-a', attachment('failed.jpg'), ''));
  assert.equal((await api.readChatMediaDrafts(7, 'chat-a')).length, 0);
  assert.ok(![...files.keys()].some(uri => uri.endsWith('.part')));
  copyFailure = false;
  await api.saveChatMediaDraft(7, 'chat-a', attachment('retry.jpg'), 'retry');
  assert.equal((await restart().readChatMediaDrafts(7, 'chat-a')).length, 1);
  console.log('Media draft recovery checks passed: restart, mixed batches, multiple documents, caption edits, isolation, corrupt records, queue handoff, and interrupted copies.');
})().catch(error => { console.error(error); process.exitCode = 1; });
