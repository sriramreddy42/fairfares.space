const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/utils/chatMediaRecovery.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const flush = () => new Promise(resolve => setImmediate(resolve));
(async () => {
  let calls = 0, tick, change, allowed = true, release;
  const app = { currentState: 'active', addEventListener: (_, listener) => { change = listener; return { remove() {} }; } };
  const api = { resumePendingEncryptedChatUploads: async (owner, canRun) => {
    calls++; if (calls === 1) await new Promise(resolve => { release = resolve; });
    return canRun() ? [{ id: calls, recoveredConversationId: 'chat' }] : [];
  } };
  const context = { exports: {}, require: name => name === 'react-native' ? { AppState: app } : name === '../api/client' ? api : name === './chatAttachmentOutbox' ? { migrateAttachmentDrafts: async () => {}, drainAttachmentOutbox: async () => [], subscribeAttachmentOutbox: () => () => {} } : {},
    setInterval: callback => { tick = callback; return 1; }, clearInterval() {}, Set, Error, JSON };
  vm.runInNewContext(compiled, context);
  const recovered = [];
  const unsubscribe = context.exports.subscribeMediaRecovery((owner, messages) => recovered.push({ owner, messages }));
  const stop = context.exports.startMediaRecovery(7, () => allowed);
  await flush();
  assert.equal(calls, 1, 'starts without a mounted chat screen');
  tick(); change('active'); assert.equal(calls, 1, 'overlapping wakeups share the running pass');
  release(); await flush(); assert.equal(recovered.length, 1);
  allowed = false; tick(); assert.equal(calls, 1, 'live media ownership pauses recovery');
  allowed = true; app.currentState = 'background'; tick(); assert.equal(calls, 1);
  app.currentState = 'active'; change('active'); await flush(); assert.equal(calls, 2);
  stop(); tick(); change('active'); await flush(); assert.equal(calls, 2, 'logout stops scheduling');
  unsubscribe();
  console.log('PASS app-owned recovery: startup, serialization, live-send pause, foreground, and logout');
})().catch(error => { console.error(error); process.exitCode = 1; });
