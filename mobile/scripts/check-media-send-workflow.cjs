// Execute the actual screen send handler with native/UI boundaries replaced.
// This catches ownership and sequencing bugs that queue-only tests cannot.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const file = require('node:path').join(__dirname, '../src/screens/MessengerScreen.tsx');
const text = fs.readFileSync(file, 'utf8');
const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler, receiptEffect;
const pickerHandlers = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('markChatRead(')) receiptEffect = node.arguments[0].getText(ast);
  if (ts.isFunctionDeclaration(node) && node.name?.text === 'sendMessage') handler = node.getText(ast);
  else if (ts.isFunctionDeclaration(node) && ['chooseAndSendImage', 'chooseAndSendFile', 'takeAndSendPhoto'].includes(node.name?.text)) pickerHandlers.push(node.getText(ast));
  else ts.forEachChild(node, visit);
}
visit(ast); assert.ok(handler); assert.ok(receiptEffect, 'read-receipt effect must remain covered');
const compiled = ts.transpileModule(handler + '\n' + pickerHandlers.join('\n') + '\nexport const runReceiptEffect = ' + receiptEffect + ';\nexport { sendMessage, chooseAndSendImage, chooseAndSendFile, takeAndSendPhoto };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const ref = current => ({ current });
const noop = () => {};
function attachment(kind, name, extra = {}) { return { kind, name, uri: `/picker/${name}`, mimeType: kind === 'IMAGE' ? 'image/jpeg' : kind === 'VIDEO' ? 'video/mp4' : 'application/pdf', size: 100, ...extra }; }
function harness(items) {
  const events = [], alerts = [], queued = [], removedDrafts = [], sent = [];
  const pendingRows = new Map();
  let nextId = 1;
  const context = {
    exports: {}, importingAttachmentsRef: ref(false), pendingMediaSelectionGenerationRef: ref(0), AbortController, Error, Promise, Set, Map, Date, Math, JSON, Number, Object,
    pendingImages: items.filter(item => item.kind !== 'FILE'), pendingAttachment: items.find(item => item.kind === 'FILE') || null,
    messageText: 'caption', mentionedUserIds: [], groupMembers: [], pendingPost: null, pendingRide: null,
    signedIn: true, currentUserId: 7, activeConversationId: 'chat', hydratedConversationId: 'chat', isAppActive: true, activeConversation: { subject: 'Chat' },
    messengerUserIdRef: ref(7), activeConversationIdRef: ref('chat'), userTouchedThreadRef: ref(false), shouldAutoScrollToEndRef: ref(false),
    activeAttachmentSendKeysRef: ref(new Set()), activeAttachmentSourceUrisRef: ref(new Map()), activeMediaTransferCountRef: ref(0),
    attachmentCryptoAbortRef: ref(null), activeAttachmentSendsRef: ref(new Map()), nextOptimisticAttachmentIdRef: ref(-1), messagesConversationIdRef: ref('chat'), lastReadAcknowledgementRef: ref({}),
    effectiveAttachmentLimitBytes: 100000000, effectiveAttachmentLimitMb: 100, nativeLongMediaAvailable: true, JAVASCRIPT_MEDIA_SAFE_BYTES: 6000000, CHAT_HD_VIDEO_PREPARE_MIN_BYTES: 5000000,
    Platform: { OS: 'ios' }, data: { user: { id: 7, name: 'Sender' } }, messages: [],
    FileSystem: { cacheDirectory: '/cache/', getFreeDiskStorageAsync: async () => 1000000000, deleteAsync: async () => {} },
    FairFaresCrypto: {
      videoPreparationAvailable: true, videoOptimizationAvailable: true,
      prepareVideo: async (_, uri) => ({ outputSize: 75, mimeType: 'video/mp4' }),
    },
    Alert: { alert: (...args) => alerts.push(args) },
    containsExactMention: () => false,
    updateChatTyping: async () => {}, logDevelopmentPerformance: noop, onMediaTransferActiveChange: noop,
    onRequireLogin: noop, publishMediaProgress: noop, scrollThreadToLatest: noop, playChitthiSentSound: noop,
    onCardMessageSent: noop, onClearPendingPost: noop, onClearPendingRide: noop,
    createOutboxClientMessageId: () => "web-batch",
    enqueueAttachmentBatch: async (_, __, items) => items.map(() => ({ state: "queued" })),
    refreshMessenger: async () => {}, refreshAttachmentEnvelopes: async () => [],
    releasePendingAttachments: noop, deleteChunkedTemporaryFile: noop,
    createLightweightVideoThumbnail: async () => 'thumbnail', acquireVideoSendPipeline: async () => noop,
    allowBusyUiToPaint: async () => {}, ensureChatDeviceIdentity: async () => ({ deviceId: 'device' }),
    getEncryptionKeysForSend: async () => ({ ready: true, keys: [] }), chatKeyPayloadCanSend: () => true,
    attachmentProgressReporter: () => noop, cryptoThrottleForSize: () => ({}),
    encryptedAttachmentLocalUri: () => '',
    mergeChatMessages: (current, incoming) => [...current, ...incoming],
    mergeThreadHistoryMessages: (current, incoming) => [...current.filter(row => !incoming.some(next => next.id === row.id)), ...incoming],
    upsertPendingMediaMessage: (_, row) => pendingRows.set(row.id, row),
    updatePendingMediaMessage: (_, id, update) => { if (pendingRows.has(id)) pendingRows.set(id, update(pendingRows.get(id))); },
    removePendingMediaMessage: (_, id) => pendingRows.delete(id),
    saveChatMediaDraft: async (_, __, item, caption, batch) => {
      events.push(`draft:${item.name}`);
      return { ...item, recoveryDraftId: item.recoveryDraftId || `draft-${item.name}`, recoveryBatchId: batch };
    },
    removeChatMediaDraft: async (_, item, preserve) => { removedDrafts.push({ ...item, preserve }); },
    encryptAttachmentFileForDevices: async (_, descriptor) => {
      events.push(`encrypt:${descriptor.fileName}`);
      return { encryptedUri: `/cipher/${descriptor.fileName}`, ciphertextSha256: descriptor.fileName, encryptedSize: 150, envelopes: [] };
    },
    queueEncryptedChatAttachment: async (_, __, encrypted, ___, ____, draftId) => {
      events.push(`queue:${encrypted.ciphertextSha256}`);
      queued.push({ encrypted, draftId }); return `client-${encrypted.ciphertextSha256}`;
    },
    sendDirectEncryptedChatAttachment: async (_, __, encrypted) => {
      events.push(`upload:${encrypted.ciphertextSha256}`); sent.push(encrypted);
      return { message: { id: nextId++, mine: true, metadata: {}, createdAt: new Date().toISOString() } };
    },
    discardQueuedEncryptedChatAttachment: async () => {},
  };
  context.releaseComposerAttachments = items => context.releasePendingAttachments(items);
  for (const state of ['AttachmentMenuOpen', 'PendingPreviewIndex', 'AttachmentSending', 'AttachmentStatusCancelable', 'AttachmentStatus', 'PendingImages', 'PendingAttachment', 'PendingPhotoPreviewOpen', 'MessageText', 'Messages', 'EncryptionReady', 'LocalMediaMessageIds']) {
    const key = state[0].toLowerCase() + state.slice(1);
    context[`set${state}`] = value => { context[key] = typeof value === 'function' ? value(context[key] ?? []) : value; };
  }
  vm.createContext(context); vm.runInContext(compiled, context);
  return { context, events, alerts, queued, removedDrafts, sent, send: context.exports.sendMessage };
}
let count = 0;
async function test(label, run) { await run(); count++; console.log(`PASS ${label}`); }
(async () => {
  await test('backgrounded threads do not mark messages read, then acknowledge when foregrounded', async () => {
    const h = harness([]), calls = [];
    Object.assign(h.context, {
      isAppActive: false,
      messages: [{ id: 1, mine: false, type: 'IMAGE' }],
      markChatRead: async (...args) => { calls.push(args); },
    });
    h.context.exports.runReceiptEffect();
    assert.deepEqual(calls, []);
    h.context.isAppActive = true;
    h.context.exports.runReceiptEffect();
    await new Promise(done => setImmediate(done));
    assert.deepEqual(calls, [['chat', '1']]);
  });
  await test('all pickers reject results after navigation or account change', async () => {
    for (const [handler, picker, singular] of [['chooseAndSendImage', 'pickChatMedia', false], ['chooseAndSendFile', 'pickChatFile', true], ['takeAndSendPhoto', 'takeChatPhoto', true]]) {
      const h = harness([]); let resolve;
      h.context[picker] = () => new Promise(done => { resolve = done; });
      let released = 0; h.context.releasePendingAttachments = items => { released += items.length; };
      const work = h.context.exports[handler]();
      assert.equal(typeof resolve, 'function', `${handler} did not open its picker: ${JSON.stringify(h.alerts)}`);
      h.context.activeConversationIdRef.current = 'other-chat'; h.context.messengerUserIdRef.current = 8;
      const item = attachment('IMAGE', 'new.jpg'); resolve(singular ? item : [item]); await work;
      assert.equal(h.context.pendingImages.length, 0); assert.equal(released, 1);
    }
  });
  await test('camera appends a photo without discarding the existing mixed selection', async () => {
    const h = harness([attachment('VIDEO', 'video.mp4')]);
    h.context.takeChatPhoto = async () => attachment('IMAGE', 'camera.jpg');
    await h.context.exports.takeAndSendPhoto();
    assert.equal(h.context.pendingImages.length, 2); assert.equal(h.context.pendingImages[0].name, 'video.mp4');
  });
  await test('native sender encrypts and uploads a mixed photo/file batch once', async () => {
    const h = harness([attachment('IMAGE', 'one.jpg'), attachment('IMAGE', 'two.jpg'), attachment('FILE', 'doc.pdf')]);
    await h.send();
    assert.equal(h.sent.length, 3, JSON.stringify(h.alerts));
    assert.deepEqual(h.events.filter((event) => event.startsWith('upload:')), ['upload:one.jpg', 'upload:two.jpg', 'upload:doc.pdf']);
    assert.equal(h.context.pendingImages.length, 0);
    assert.equal(h.context.pendingAttachment, null);
  });
  await test('browser batches encrypt and upload one item at a time', async () => {
    const h = harness([attachment('IMAGE', 'one.jpg', { blob: {} }), attachment('IMAGE', 'two.jpg', { blob: {} })]);
    h.context.Platform.OS = 'web';
    h.context.FileReader = class { readAsDataURL() { this.result = 'data:image/jpeg;base64,cmF3'; this.onload(); } };
    h.context.encryptAttachmentForDevices = (_, descriptor) => {
      h.events.push(`encrypt:${descriptor.fileName}`);
      return { ciphertextBase64: 'encrypted', ciphertextSha256: descriptor.fileName, encryptedSize: 150, envelopes: [] };
    };
    await h.send();
    assert.equal(h.sent.length, 2, JSON.stringify(h.alerts));
    assert.ok(h.events.indexOf('upload:one.jpg') < h.events.indexOf('encrypt:two.jpg'));
  });
  console.log(`${count} media send workflow checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
