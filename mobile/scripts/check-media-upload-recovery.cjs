const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(require('node:path').join(__dirname, '../src/api/client.ts'), 'utf8');
const helpers = source.slice(source.indexOf('const multipartStatePrefix'), source.indexOf('function attachmentUploadCancelledError'));
const implementation = source.slice(source.indexOf('type EncryptedAttachmentUpload'), source.indexOf('export async function getEncryptedChatAttachmentDownloadUrl'));
const compiled = ts.transpileModule(helpers + implementation, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function harness() {
  const storage = new Map(), files = new Map(), authorizations = new Map(), accepted = new Map(), modified = new Map();
  const transfers = [], calls = [];
  const faults = { upload: null, finalize: null, expectedEnvelope: null, copy: null, remove: null, set: null, authorize: null };
  let nextId = 0;
  class File {
    constructor(...segments) { this.uri = segments.map(segment => segment.uri || segment).join('/'); }
    get modificationTime() { return modified.get(this.uri) || Date.now(); }
    get exists() { return files.has(this.uri); }
    get size() { return files.get(this.uri); }
    delete() { files.delete(this.uri); }
  }
  class Directory {
    constructor(...segments) { this.uri = segments.map(segment => segment.uri || segment).join('/'); }
    create() {}
    get exists() { return [...files.keys()].some(uri => uri.startsWith(`${this.uri}/`)); }
    list() { return [...files.keys()].filter(uri => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes('/')).map(uri => new File(uri)); }
  }
  function restart() {
    const context = {
      exports: {}, Map, Set, Date, Math, JSON, Number, Error, Promise, AbortController,
      encodeURIComponent, authTokenGeneration: 1, encryptedUploadSessionControllers: new Set(),
      Platform: { OS: 'ios' }, File, Directory, Paths: { document: '/documents', cache: new Directory('/cache') },
      FileSystem: {
        copyAsync: async ({ from, to }) => { assert.ok(files.has(from), `source exists: ${from}`); files.set(to, files.get(from)); if (faults.copy) await faults.copy(from, to); },
        moveAsync: async ({ from, to }) => { files.set(to, files.get(from)); files.delete(from); },
        deleteAsync: async uri => { files.delete(uri); },
      },
      AsyncStorage: {
        getItem: async key => storage.get(key) || null,
        setItem: async (key, value) => { if (faults.set) await faults.set(key, value); storage.set(key, value); },
        removeItem: async key => { if (faults.remove) await faults.remove(key); storage.delete(key); },
        getAllKeys: async () => [...storage.keys()],
        multiGet: async keys => keys.map(key => [key, storage.get(key) || null]),
      },
      authorizeEncryptedChatAttachment: async (conversation, size, checksum) => {
        calls.push(['authorize', conversation]);
        if (faults.authorize) await faults.authorize();
        const authorization = { uploadId: `upload-${++nextId}`, transferMode: size > 100 ? 'MULTIPART' : 'SINGLE', uploadUrl: '/upload', headers: {}, expiresIn: 3600 };
        authorizations.set(authorization.uploadId, { conversation, checksum });
        return authorization;
      },
      uploadEncryptedFile: async (_, __, uri, signal) => { if (faults.upload) await faults.upload(uri, signal); if (signal?.aborted) throw new Error('aborted'); transfers.push(uri); },
      uploadEncryptedMultipartFile: async (authorization, uri, signal) => {
        if (!authorizations.has(authorization.uploadId)) throw Object.assign(new Error('Multipart upload was not found or has expired.'), { fairFaresHttpStatus: 404 });
        if (faults.upload) await faults.upload(uri, signal);
        if (signal?.aborted) throw new Error('aborted');
        transfers.push(uri);
      },
      finalizeEncryptedChatAttachment: async (uploadId, envelopes, __, clientId) => {
        calls.push(['finalize', uploadId, clientId]);
        if (!authorizations.has(uploadId)) throw Object.assign(new Error('Upload authorization was not found or has expired.'), { fairFaresHttpStatus: 409 });
        if (faults.expectedEnvelope && envelopes[0]?.ciphertext !== faults.expectedEnvelope) throw Object.assign(new Error('Encryption keys changed. Refresh the chat and try again.'), { fairFaresHttpStatus: 409 });
        const key = `${authorizations.get(uploadId).conversation}:${clientId}`;
        if (!accepted.has(key)) accepted.set(key, { message: { id: accepted.size + 1 } });
        if (faults.finalize) await faults.finalize();
        return accepted.get(key);
      },
      throwIfAttachmentUploadCancelled: signal => { if (signal?.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); },
      attachmentUploadCancelledError: () => Object.assign(new Error('cancelled'), { name: 'AbortError' }),
      FairFaresCrypto: { available: false, cancelMultipartUpload: async () => {} },
      abortEncryptedChatAttachmentMultipart: async () => {},
      removeChatMediaDraft: async () => {},

    };
    vm.createContext(context);
    vm.runInContext(compiled, context);
    return { api: context.exports, changeSession() { context.authTokenGeneration++; context.encryptedUploadSessionControllers.forEach(controller => controller.abort()); } };
  }
  function attachment(index, size = 50) {
    const encryptedUri = `/cache/${index}`;
    files.set(encryptedUri, size);
    return { encryptedUri, encryptedSize: size, ciphertextSha256: `hash${index}`, envelopes: [{ ciphertext: 'encrypted' }] };
  }
  return { storage, files, modified, accepted, authorizations, transfers, calls, faults, restart, attachment };
}

let checks = 0;
async function test(label, run) { await run(harness()); checks++; console.log(`PASS ${label}`); }
module.exports = { harness };
if (require.main === module) (async () => {
  await test('small file survives actual runtime restart and cache eviction', async h => {
    const item = h.attachment(1); h.faults.upload = async () => { throw new Error('offline'); };
    await assert.rejects(h.restart().api.sendDirectEncryptedChatAttachment(7, 'chat', item, 'image/jpeg'));
    h.files.delete(item.encryptedUri); h.faults.upload = null;
    const api = h.restart().api;
    assert.equal((await api.resumePendingEncryptedChatUploads(8)).length, 0);
    assert.equal((await api.resumePendingEncryptedChatUploads(7)).length, 1);
    assert.equal(h.storage.size, 0);
  });
  await test('mixed batch over five items drains in persisted order', async h => {
    const api = h.restart().api;
    for (let i = 0; i < 8; i++) await api.queueEncryptedChatAttachment(7, 'chat', h.attachment(i, i % 2 ? 500 : 50), i % 2 ? 'video/mp4' : 'image/jpeg');
    const result = await h.restart().api.resumePendingEncryptedChatUploads(7);
    assert.equal(result.length, 8); assert.equal(h.storage.size, 0);
    assert.ok(result.every(message => message.recoveredConversationId === 'chat'));
  });
  await test('one failed upload does not strand following photos', async h => {
    const api = h.restart().api;
    for (let i = 0; i < 3; i++) await api.queueEncryptedChatAttachment(7, 'chat', h.attachment(i), 'image/jpeg');
    h.faults.upload = async uri => { if (uri.includes('hash1.')) throw new Error('offline'); };
    assert.equal((await api.resumePendingEncryptedChatUploads(7)).length, 2);
    assert.equal(h.storage.size, 1);
  });
  await test('lost finalize response remains idempotent after restart', async h => {
    h.faults.finalize = async () => { throw new Error('response lost'); };
    await assert.rejects(h.restart().api.sendDirectEncryptedChatAttachment(7, 'chat', h.attachment(1), 'application/pdf'));
    const transferred = h.transfers.length;
    h.faults.finalize = null;
    assert.equal((await h.restart().api.resumePendingEncryptedChatUploads(7)).length, 1);
    assert.equal(h.accepted.size, 1); assert.equal(h.transfers.length, transferred);
  });
  await test('simultaneous sends share one queue item and one server message', async h => {
    const api = h.restart().api, item = h.attachment(1);
    const results = await Promise.all([api.sendDirectEncryptedChatAttachment(7, 'chat', item, 'image/jpeg'), api.sendDirectEncryptedChatAttachment(7, 'chat', item, 'image/jpeg')]);
    assert.equal(results[0].message.id, results[1].message.id);
    assert.equal(h.transfers.length, 1); assert.equal(h.accepted.size, 1);
  });
  await test('live send overlapping recovery does not duplicate or lose the response', async h => {
    const api = h.restart().api, item = h.attachment(1);
    await api.queueEncryptedChatAttachment(7, 'chat', item, 'image/jpeg');
    const [live] = await Promise.all([api.sendDirectEncryptedChatAttachment(7, 'chat', item, 'image/jpeg'), api.resumePendingEncryptedChatUploads(7)]);
    assert.ok(live.message.id); assert.equal(h.accepted.size, 1); assert.equal(h.transfers.length, 1);
  });
  await test('reusing ciphertext in two conversations keeps separate sends', async h => {
    const api = h.restart().api, item = h.attachment(1);
    await api.queueEncryptedChatAttachment(7, 'one', item, 'image/jpeg');
    await api.queueEncryptedChatAttachment(7, 'two', item, 'image/jpeg');
    assert.equal(h.storage.size, 2);
    assert.equal((await api.resumePendingEncryptedChatUploads(7)).length, 2);
    assert.equal(h.accepted.size, 2);
  });
  await test('interrupted ciphertext copy can be retried', async h => {
    const item = h.attachment(1); h.faults.copy = async (_, to) => { h.files.set(to, 1); throw new Error('killed during copy'); };
    await assert.rejects(h.restart().api.queueEncryptedChatAttachment(7, 'chat', item, 'image/jpeg'));
    h.faults.copy = null;
    const api = h.restart().api;
    await api.queueEncryptedChatAttachment(7, 'chat', item, 'image/jpeg');
    assert.equal((await api.resumePendingEncryptedChatUploads(7)).length, 1);
  });
  await test('expired multipart authorization is renewed', async h => {
    const item = h.attachment(1, 500); h.faults.upload = async () => { throw new Error('offline'); };
    await assert.rejects(h.restart().api.sendDirectEncryptedChatAttachment(7, 'chat', item, 'video/mp4'));
    h.authorizations.clear(); h.faults.upload = null;
    assert.equal((await h.restart().api.resumePendingEncryptedChatUploads(7)).length, 1);
  });
  await test('expired authorization after uploaded checkpoint is renewed', async h => {
    h.faults.finalize = async () => { throw new Error('server unavailable'); };
    await assert.rejects(h.restart().api.sendDirectEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg'));
    h.faults.finalize = null; h.authorizations.clear();
    assert.equal((await h.restart().api.resumePendingEncryptedChatUploads(7)).length, 1);
    assert.equal(h.accepted.size, 1);
  });
  await test('accepted send is not failed by local cleanup errors', async h => {
    h.faults.remove = async () => { throw new Error('disk unavailable'); };
    const sent = await h.restart().api.sendDirectEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg');
    assert.ok(sent.message.id); assert.equal(h.storage.size, 1);
    h.faults.remove = null;
    assert.equal((await h.restart().api.resumePendingEncryptedChatUploads(7)).length, 1);
    assert.equal(h.accepted.size, 1); assert.equal(h.transfers.length, 1);
  });
  await test('cancelled transfer stays cancelled even if queue removal fails', async h => {
    const api = h.restart().api, item = h.attachment(1);
    await api.queueEncryptedChatAttachment(7, 'chat', item, 'image/jpeg');
    h.faults.remove = async () => { throw new Error('disk unavailable'); };
    await assert.rejects(api.discardQueuedEncryptedChatAttachment(7, item.ciphertextSha256, 'chat'));
    h.faults.remove = null;
    assert.equal((await h.restart().api.resumePendingEncryptedChatUploads(7)).length, 0);
    assert.equal(h.accepted.size, 0); assert.equal(h.storage.size, 0);
  });
  await test('cancelling an active upload aborts it and prevents recovery', async h => {
    const api = h.restart().api, controller = new AbortController(), started = deferred();
    h.faults.upload = async (_, signal) => { started.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); };
    const sending = api.sendDirectEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg', false, controller.signal);
    await started.promise; controller.abort(); await assert.rejects(sending);
    assert.equal(h.storage.size, 0); assert.equal(h.accepted.size, 0);
  });
  await test('account switch during upload preserves old-account state without finalizing', async h => {
    const runtime = h.restart(), started = deferred(), release = deferred();
    h.faults.upload = async () => { started.resolve(); await release.promise; };
    const sending = runtime.api.sendDirectEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg');
    await started.promise; runtime.changeSession(); release.resolve(); await assert.rejects(sending);
    assert.equal(h.accepted.size, 0); assert.equal(h.storage.size, 1);
  });
  await test('account switch while authorizing cannot start another-account upload', async h => {
    const runtime = h.restart(), started = deferred(), release = deferred();
    h.faults.authorize = async () => { started.resolve(); await release.promise; };
    const sending = runtime.api.sendDirectEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg');
    await started.promise; runtime.changeSession(); release.resolve(); await assert.rejects(sending);
    assert.equal(h.transfers.length, 0); assert.equal(h.accepted.size, 0);
  });
  await test('malformed queue entries do not block healthy records', async h => {
    const api = h.restart().api;
    h.storage.set('fairfares.chitthi.multipart.v1.7.broken', '{');
    await api.queueEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg');
    assert.equal((await api.resumePendingEncryptedChatUploads(7)).length, 1);
  });
  await test('receipt cleanup can recover even after ciphertext was removed', async h => {
    h.faults.remove = async () => { throw new Error('disk unavailable'); };
    await h.restart().api.sendDirectEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg');
    h.files.clear(); h.faults.remove = null;
    const api = h.restart().api;
    assert.equal((await api.pendingEncryptedChatUploadSummary(7)).validCount, 1);
    assert.equal((await api.resumePendingEncryptedChatUploads(7)).length, 1);
    assert.equal(h.transfers.length, 1);
  });
  await test('changed recipient keys rewrap the descriptor without re-uploading media', async h => {
    h.faults.expectedEnvelope = 'new-key';
    let refreshes = 0;
    const api = h.restart().api;
    const result = await api.sendDirectEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg', false, undefined, undefined, async (conversation, envelopes) => {
      assert.equal(conversation, 'chat'); assert.equal(envelopes[0].ciphertext, 'encrypted'); refreshes++;
      return [{ ciphertext: 'new-key' }];
    });
    assert.ok(result.message.id); assert.equal(refreshes, 1); assert.equal(h.transfers.length, 1); assert.equal(h.accepted.size, 1);
  });
  await test('recovery refreshes keys that changed while the app was closed', async h => {
    h.faults.expectedEnvelope = 'new-key';
    await assert.rejects(h.restart().api.sendDirectEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg'));
    const api = h.restart().api;
    const result = await api.resumePendingEncryptedChatUploads(7, () => true, async () => [{ ciphertext: 'new-key' }]);
    assert.equal(result.length, 1); assert.equal(h.transfers.length, 1);
  });
  await test('permanently invalid keys cause a bounded retry and preserve the upload', async h => {
    h.faults.expectedEnvelope = 'new-key';
    let refreshes = 0;
    await assert.rejects(h.restart().api.sendDirectEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg', false, undefined, undefined, async (_, envelopes) => { refreshes++; return envelopes; }));
    assert.equal(refreshes, 1); assert.equal(h.accepted.size, 0); assert.equal(h.storage.size, 1);
  });
  await test('old multipart queue format still recovers', async h => {
    const api = h.restart().api;
    await api.queueEncryptedChatAttachment(7, 'chat', h.attachment(1, 500), 'video/mp4');
    const [key, raw] = [...h.storage][0];
    h.storage.delete(key); h.storage.set('fairfares.chitthi.multipart.v1.7.hash1', raw);
    assert.equal((await h.restart().api.resumePendingEncryptedChatUploads(7)).length, 1);
  });
  await test('failed cleanup is retried in the same runtime', async h => {
    const api = h.restart().api;
    h.faults.remove = async () => { throw new Error('disk unavailable'); };
    await api.sendDirectEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg');
    h.faults.remove = null;
    await api.resumePendingEncryptedChatUploads(7);
    assert.equal(h.storage.size, 0); assert.equal(h.accepted.size, 1);
  });
  await test('orphan cleanup preserves old pending media for every account', async h => {
    const api = h.restart().api;
    for (const uri of ['/documents/chitthi-outgoing/orphan.ffenc2', '/documents/chitthi-pending-media/7-orphan', '/documents/chitthi-pending-media/8-keep', '/documents/chitthi-pending-media/7-active']) {
      h.files.set(uri, 50); h.modified.set(uri, Date.now() - 48 * 3600 * 1000);
    }
    h.storage.set('fairfares.chitthi.media-draft.v1.8.keep', JSON.stringify({ attachment: {} }));
    await api.queueEncryptedChatAttachment(7, 'chat', h.attachment(1), 'image/jpeg', false, 'active');
    const record = JSON.parse([...h.storage.values()].find(raw => raw.includes('ciphertextSha256')));
    h.modified.set(record.encryptedUri, Date.now() - 48 * 3600 * 1000);
    h.faults.upload = async () => { throw new Error('offline'); };
    await api.resumePendingEncryptedChatUploads(7);
    assert.ok(h.files.has(record.encryptedUri), 'pending ciphertext is retained regardless of age');
    assert.ok(h.files.has('/documents/chitthi-pending-media/7-active'), 'source used by queued upload is retained');
    assert.ok(h.files.has('/documents/chitthi-pending-media/8-keep'), 'other account draft is retained');
    assert.ok(!h.files.has('/documents/chitthi-outgoing/orphan.ffenc2'));
    assert.ok(!h.files.has('/documents/chitthi-pending-media/7-orphan'));
  });
  console.log(`${checks} media upload recovery checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
