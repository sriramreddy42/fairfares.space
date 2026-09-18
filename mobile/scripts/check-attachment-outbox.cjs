const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/utils/chatAttachmentOutbox.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
function harness(integrateUpload = false) {
  const upload = integrateUpload ? require('./check-media-upload-recovery.cjs').harness() : null;
  const storage = upload?.storage || new Map(), files = upload?.files || new Map(), server = upload?.accepted || new Map(), queue = new Map(), faults = {}, drafts = [];
  let encryptions = 0;
  const disk = { documentDirectory: '/docs/', cacheDirectory: '/cache/',
    getInfoAsync: async uri => ({ exists: files.has(uri), size: files.get(uri) || 0 }),
    makeDirectoryAsync: async () => {},
    copyAsync: async ({ from, to }) => { if (faults.copy?.(from, to)) throw new Error('disk full'); if (!files.has(from)) throw new Error('missing source'); if (files.has(to)) throw new Error('destination exists'); files.set(to, files.get(from)); },
    moveAsync: async ({ from, to }) => { if (!files.has(from)) throw new Error('missing temp'); files.set(to, files.get(from)); files.delete(from); },
    deleteAsync: async uri => files.delete(uri),
  };
  const dependencies = {
    '@react-native-async-storage/async-storage': { removeItem: async key => storage.delete(key), getAllKeys: async () => [...storage.keys()], multiGet: async keys => keys.map(key => [key, storage.get(key)]), getItem: async key => storage.get(key) || null,
      setItem: async (key, value) => { if (faults.set?.(key, value)) throw new Error('disk failure'); storage.set(key, value); } },
    'expo-file-system/legacy': disk, 'react-native': { Platform: { OS: 'ios' } },
    '../api/client': { discardQueuedEncryptedChatAttachment: async () => true, getChatDeviceKeys: async () => ({ ready: true, keys: [{}] }), registerChatDeviceKey: async () => {},
      queueEncryptedChatAttachment: async (_, conversation, encrypted, mime, silent, draft, id) => { queue.set(encrypted.ciphertextSha256, { id, conversation }); },
      forwardEncryptedChatAttachment: async (source, conversation, envelopes, silent, id) => { if (faults.forward?.(conversation)) throw new Error('network offline'); if (!server.has(id)) server.set(id, { id: server.size + 1, metadata: {}, status: 'sent' }); return { message: server.get(id) }; },
      sendEncryptedChatMessage: async (conversation, envelopes, id) => { if (faults.forward?.(conversation)) throw new Error('network offline'); if (!server.has(id)) server.set(id, { id: server.size + 1, metadata: {}, status: 'sent' }); return { message: server.get(id) }; },
      sendDirectEncryptedChatAttachment: async (_, conversation, encrypted, mime, silent, signal, progress, refresh, clientId) => {
        if (faults.upload?.(encrypted)) throw new Error('network offline');
        const id = clientId || queue.get(encrypted.ciphertextSha256).id;
        if (!server.has(id)) server.set(id, { id: server.size + 1, metadata: {}, status: 'sent', createdAt: new Date().toISOString() });
        if (faults.lostResponse) { faults.lostResponse = false; throw new Error('network response lost'); }
        return { message: server.get(id) };
      } },
    './chatCrypto': { getOrCreateDeviceIdentity: async () => { if (faults.identityAfterSend && server.size) throw new Error('identity storage unavailable'); return { deviceId: 'device' }; } },
    './chatMediaDrafts': { readChatMediaDrafts: async () => [...drafts], removeChatMediaDraft: async (_, attachment) => { const index = drafts.findIndex(item => item.attachment.recoveryDraftId === attachment.recoveryDraftId); if (index >= 0) drafts.splice(index, 1); files.delete(attachment.uri); } },
    './chatRecovery': { awaitChatIdentityRecovery: async () => {}, recoveredChatIdentities: (_, identity) => [identity] },
    './chitthiChunkedCrypto': { encryptAttachmentFileForDevices: async (uri, metadata) => { encryptions++; const encryptedUri = `/cache/cipher-${encryptions}`; files.set(encryptedUri, 120); return { encryptedUri, encryptedSize: 120, ciphertextSha256: `sum-${encryptions}`, envelopes: [], metadata }; }, deleteChunkedTemporaryFile: uri => files.delete(uri) },
    './imageUpload': { prepareSavedChatImage: async media => { if (faults.prepare?.(media)) throw new Error('damaged image'); if (faults.prepareWait) await faults.prepareWait(); const uri = `/cache/derived-${media.uri.split('/').pop()}`; files.set(uri, 80); return { ...media, uri, size: 80, mimeType: 'image/jpeg' }; }, createLightweightVideoThumbnail: async () => '' },
    '../../modules/fairfares-crypto/src': { FairFaresCrypto: { available: true, videoPreparationAvailable: true, commitProtectedFile: async (from, to) => disk.moveAsync({ from, to }) } },
    './chitthiMediaStorage': { persistentChitthiMediaUri: (owner, id, ext) => `/docs/local/${owner}-${id}.${ext}`, copyPersistentChitthiMedia: async (to, from) => { files.set(to, files.get(from)); } },
  };
  const restart = () => {
    const api = upload?.restart().api;
    if (api) for (const name of ['queueEncryptedChatAttachment', 'sendDirectEncryptedChatAttachment', 'discardQueuedEncryptedChatAttachment']) dependencies['../api/client'][name] = api[name];
    const context = { exports: {}, require: name => { assert.ok(dependencies[name], name); return name === "@react-native-async-storage/async-storage" ? { default: dependencies[name] } : dependencies[name]; }, Set, Map, Date, Math, JSON, Error, Object, AbortController };
    vm.runInNewContext(compiled, context);
    if (api) context.exports.resumePendingEncryptedChatUploads = api.resumePendingEncryptedChatUploads;
    return context.exports;
  };
  const item = (name, kind = 'IMAGE') => { const uri = `/picker/${name}`; files.set(uri, 100); return { uri, kind, name, mimeType: kind === 'IMAGE' ? 'image/jpeg' : kind === 'VIDEO' ? 'video/mp4' : 'application/pdf', size: 100 }; };
  return { storage, files, server, faults, drafts, upload, restart, item, encryptions: () => encryptions };
}
const drain = api => api.drainAttachmentOutbox(7, () => true, async () => []);
(async () => {
  for (const failure of ['lost-response', 'acceptance-checkpoint']) {
    const h = harness(true); let api = h.restart();
    const [original] = await api.enqueueAttachmentBatch(7, 'chat', [h.item('photo')], '');
    if (failure === 'lost-response') h.upload.faults.finalize = async () => { throw new Error('network response lost'); };
    else h.faults.set = (key, value) => key.includes('attachment-item') && JSON.parse(value).state === 'sent';
    await drain(api); assert.equal(h.server.size, 1);
    for (const uri of h.files.keys()) if (uri.startsWith('/cache/')) h.files.delete(uri);
    h.upload.faults.finalize = null; h.faults.set = null;
    api = h.restart();
    assert.equal((await api.resumePendingEncryptedChatUploads(7)).length, 0, 'legacy recovery must not steal an outbox job');
    await api.retryAttachmentJob((await api.readAttachmentOutbox(7))[0]); await drain(api);
    assert.equal(h.server.size, 1); assert.ok(h.server.has(`chat:${original.id}`));
    assert.equal((await api.readAttachmentOutbox(7))[0].state, 'sent');
    console.log(`PASS real outbox/upload queue handoff survives ${failure} across restart without duplicates`);
  }
  {
    const h = harness(), api = h.restart();
    const jobs = await api.enqueueAttachmentBatch(7, 'chat', [h.item('first'), h.item('second')], '');
    h.storage.set(`fairfares.chitthi.attachment-item.v1.7.${jobs[0].id}`, '{broken');
    h.faults.set = key => key === `fairfares.chitthi.attachment-item.v1.7.${jobs[0].id}`;
    await drain(api); assert.equal(h.server.size, 1, 'one unwritable checkpoint must not strand its sibling');
    h.faults.set = null; await drain(h.restart()); assert.equal(h.server.size, 2);
    console.log('PASS corrupt or unwritable item checkpoints do not strand healthy siblings');
  }
  {
    const h = harness(), api = h.restart();
    const jobs = await api.enqueueAttachmentBatch(7, 'chat', [h.item('photo')], '');
    h.faults.identityAfterSend = true;
    api.subscribeAttachmentOutbox(() => { throw new Error('broken observer'); });
    await drain(api); assert.equal(h.server.size, 1);
    assert.equal((await api.readAttachmentOutbox(7))[0].state, 'sent');
    await api.retryAttachmentJob(jobs[0]);
    assert.equal(await api.cancelAttachmentJob(jobs[0]), false);
    await drain(h.restart()); assert.equal(h.server.size, 1);
    assert.equal((await api.readAttachmentOutbox(7))[0].state, 'sent');
    console.log('PASS accepted sends survive local identity/observer failures and stale retry/cancel actions');
  }
  {
    const h = harness(); let api = h.restart();
    await api.enqueueForwardBatch(7, [{ conversationId: 'browser', envelopes: [], type: 'IMAGE', caption: '', attachment: h.item('legacy'),
      upload: { ciphertextBase64: 'encrypted-bytes', ciphertextSha256: 'web-sum', encryptedSize: 120 } }]);
    h.faults.lostResponse = true; await drain(api);
    api = h.restart(); const job = (await api.readAttachmentOutbox(7))[0];
    assert.equal(await api.cancelAttachmentJob(job), false, 'an accepted forward with a lost response must not claim cancellation');
    await api.retryAttachmentJob(job); await drain(api); assert.equal(h.server.size, 1);
    assert.equal((await api.readAttachmentOutbox(7))[0].state, 'sent');
    console.log('PASS ambiguous forward acceptance remains recoverable instead of falsely cancelled');
  }
  {
    const h = harness(); let api = h.restart();
    const jobs = await api.enqueueAttachmentBatch(7, 'chat', [h.item('photo'), h.item('video', 'VIDEO'), h.item('doc', 'FILE')], 'caption');
    for (const job of jobs) { h.files.set(`${job.sourceUri}.prepared.part`, 17); h.files.set(`${job.sourceUri}.ffenc.part`, 17); }
    for (const uri of h.files.keys()) if (uri.startsWith('/picker/') || uri.startsWith('/cache/')) h.files.delete(uri);
    api = h.restart(); await drain(api);
    assert.equal(h.server.size, 3);
    assert.ok((await api.readAttachmentOutbox(7)).every(job => job.state === 'sent'));
    assert.equal(jobs[1].caption, '');
    console.log('PASS mixed source jobs survive restart and picker/cache eviction');
  }
  {
    const h = harness(), api = h.restart();
    h.faults.prepare = media => media.name === 'bad';
    await api.enqueueAttachmentBatch(7, 'chat', [h.item('bad'), h.item('good'), h.item('doc', 'FILE')], 'caption');
    await drain(api);
    assert.equal(h.server.size, 2);
    const bad = (await api.readAttachmentOutbox(7)).find(job => job.attachment.name === 'bad');
    assert.equal(bad.state, 'failed');
    h.faults.prepare = null; await api.retryAttachmentJob(bad); await drain(api);
    assert.equal(h.server.size, 3);
    console.log('PASS preparation failure isolates siblings and retries only the failed item');
  }
  {
    const h = harness(); let api = h.restart();
    await api.enqueueAttachmentBatch(7, 'chat', [h.item('photo')], '');
    h.faults.lostResponse = true; await drain(api);
    const original = h.encryptions();
    for (const uri of h.files.keys()) if (uri.startsWith('/cache/')) h.files.delete(uri);
    api = h.restart(); const job = (await api.readAttachmentOutbox(7))[0]; await api.retryAttachmentJob(job); await drain(api);
    assert.equal(h.server.size, 1); assert.equal(h.encryptions(), original);
    console.log('PASS lost acceptance response retries stable identity and durable ciphertext');
  }
  {
    const h = harness(), api = h.restart();
    h.faults.copy = from => from.endsWith('bad');
    await api.enqueueAttachmentBatch(7, 'chat', [h.item('bad'), h.item('good')], '');
    const jobs = await api.readAttachmentOutbox(7); assert.equal(jobs.length, 2); assert.equal(jobs[0].state, 'failed');
    await drain(api); assert.equal(h.server.size, 1);
    assert.equal(await api.cancelAttachmentJob(jobs[0]), true); await drain(api); assert.equal(h.server.size, 1);
    assert.equal((await api.readAttachmentOutbox(8)).length, 0);
    console.log('PASS import failures remain explicit, cancellation persists, accounts stay isolated');
  }
  {
    const h = harness(); let api = h.restart();
    const attachment = h.item('forward');
    await api.enqueueForwardBatch(7, ['one', 'two', 'three'].map(conversationId => ({ conversationId, sourceMessageId: 10, envelopes: [], type: 'IMAGE', caption: '', attachment })));
    h.faults.forward = conversation => conversation === 'two';
    await drain(api); assert.equal(h.server.size, 2);
    const pending = (await api.readAttachmentOutbox(7)).find(job => job.conversationId === 'two');
    assert.equal(pending.state, 'waiting');
    h.faults.forward = null; api = h.restart(); await api.retryAttachmentJob(pending); await drain(api);
    assert.equal(h.server.size, 3); assert.equal(h.encryptions(), 0);
    console.log('PASS multi-destination forwarding survives restart without repeating completed chats or uploading media');
  }
  {
    const h = harness(); let api = h.restart();
    await api.enqueueForwardBatch(7, [{ conversationId: 'browser', envelopes: [], type: 'IMAGE', caption: '', attachment: h.item('legacy'),
      upload: { ciphertextBase64: 'encrypted-bytes', ciphertextSha256: 'web-sum', encryptedSize: 120 } }]);
    h.faults.lostResponse = true; await drain(api);
    assert.equal(h.server.size, 1);
    api = h.restart(); await api.retryAttachmentJob((await api.readAttachmentOutbox(7))[0]); await drain(api);
    assert.equal(h.server.size, 1); assert.equal(h.encryptions(), 0);
    assert.equal((await api.readAttachmentOutbox(7))[0].state, 'sent');
    console.log('PASS legacy browser forwarding persists ciphertext and retries the same publication');
  }
  {
    const h = harness(), api = h.restart();
    let release;
    h.faults.prepareWait = () => new Promise(resolve => { release = resolve; });
    await api.enqueueAttachmentBatch(7, 'chat', [h.item('photo')], '');
    const running = drain(api);
    while (!release) await new Promise(resolve => setImmediate(resolve));
    const job = (await api.readAttachmentOutbox(7))[0];
    assert.equal(await api.cancelAttachmentJob(job), true);
    release(); await running;
    await drain(h.restart()); assert.equal(h.server.size, 0);
    assert.equal((await api.readAttachmentOutbox(7))[0].state, 'cancelled');
    console.log('PASS cancellation during preparation remains cancelled after restart');
  }
  {
    const h = harness(); let api = h.restart();
    h.drafts.push(...['good', 'bad'].map(name => ({ conversationId: 'chat', caption: '', attachment: { ...h.item(name), recoveryBatchId: 'old-batch', recoveryDraftId: name } })));
    h.faults.copy = from => from.endsWith('bad');
    await api.migrateAttachmentDrafts(7, () => true);
    assert.equal(h.drafts.length, 1);
    api = h.restart(); await api.migrateAttachmentDrafts(7, () => true);
    assert.equal(h.drafts.length, 1); assert.ok(h.files.has('/picker/bad'));
    h.faults.copy = null;
    await api.retryAttachmentJob((await api.readAttachmentOutbox(7)).find(job => job.attachment.name === 'bad'));
    await drain(api); assert.equal(h.server.size, 2);
    console.log('PASS partial legacy migration preserves the remaining source by identity');
  }
  {
    const h = harness(); let api = h.restart();
    h.faults.set = (key, value) => key.includes('attachment-item') && JSON.parse(value).state !== 'sent';
    await api.enqueueAttachmentBatch(7, 'chat', [h.item('photo')], '');
    h.faults.set = null; api = h.restart(); await drain(api);
    assert.equal(h.server.size, 1);
    console.log('PASS accepted manifest survives interrupted item checkpoints');
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
