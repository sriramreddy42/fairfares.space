// Exercise real envelope and media cryptography with an in-memory filesystem.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const nacl = require('tweetnacl');
const files = new Map();
class File {
  constructor(...parts) { this.uri = parts.map(part => part.uri || part).join('/'); }
  get exists() { return files.has(this.uri); }
  get size() { return files.get(this.uri)?.length || 0; }
  get parentDirectory() { return { create() {} }; }
  create() { files.set(this.uri, Buffer.alloc(0)); }
  delete() { files.delete(this.uri); }
  move(destination) { files.set(destination.uri, files.get(this.uri)); files.delete(this.uri); }
  open() {
    const file = this;
    return { offset: 0, close() {},
      readBytes(size) { const result = Uint8Array.from(files.get(file.uri).subarray(this.offset, this.offset + size)); this.offset += result.length; return result; },
      writeBytes(bytes) { files.set(file.uri, Buffer.concat([files.get(file.uri), Buffer.from(bytes)])); this.offset += bytes.length; }
    };
  }
}
function load(name, extra = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/utils', name + '.ts'), 'utf8');
  const stubs = {
    'react-native-get-random-values': {}, '@react-native-async-storage/async-storage': {}, 'expo-secure-store': {},
    'react-native': { Platform: { OS: 'web' } },
    'expo-file-system': { File, Paths: { cache: '/cache' } },
    '../../modules/fairfares-crypto/src': { FairFaresCrypto: { available: false } },
    './performanceDiagnostics': { startDevelopmentPerformanceOperation: () => ({ progress() {}, complete() {}, fail() {} }) }, ...extra
  };
  const context = { exports: {}, require: name => name in stubs ? stubs[name] : require(name), Uint8Array, ArrayBuffer, TextEncoder, TextDecoder, setTimeout, clearTimeout, Buffer };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, context);
  return context.exports;
}
const chat = load('chatCrypto');
const chunked = load('chitthiChunkedCrypto', { './chatCrypto': chat });
const b64 = bytes => Buffer.from(bytes).toString('base64');
function identity(deviceId) {
  const pair = nacl.box.keyPair();
  return { deviceId, publicKey: b64(pair.publicKey), secretKey: b64(pair.secretKey) };
}
const sender = identity('sender'), recipient = identity('recipient'), stranger = identity('stranger');
const keys = [sender, recipient].map((item, index) => ({ userId: index + 1, deviceId: item.deviceId, publicKey: item.publicKey }));
const metadata = { kind: 'FILE', fileName: 'sample.bin', mimeType: 'application/octet-stream', caption: 'caption' };
(async () => {
  const small = crypto.randomBytes(97);
  const encrypted = chat.encryptAttachmentForDevices(b64(small), metadata, sender, keys);
  for (const person of [sender, recipient]) {
    const envelope = encrypted.envelopes.find(item => item.recipientDeviceId === person.deviceId);
    const descriptor = chat.decryptEnvelope(envelope, person);
    assert.deepEqual(Buffer.from(chat.decryptAttachmentBase64(encrypted.ciphertextBase64, descriptor).base64, 'base64'), small);
    assert.equal(chat.decryptEnvelope(envelope, stranger), "");
    const damaged = Buffer.from(encrypted.ciphertextBase64, 'base64'); damaged[3] ^= 1;
    assert.throws(() => chat.decryptAttachmentBase64(b64(damaged), descriptor));
  }
  console.log('PASS legacy media authenticates for intended devices and rejects wrong keys/tampering');
  for (const size of [1, chunked.CHITTHI_CHUNK_SIZE, chunked.CHITTHI_CHUNK_SIZE * 2 + 17]) {
    const plaintext = crypto.randomBytes(size); files.set('/source', plaintext);
    const encrypted = await chunked.encryptAttachmentFileForDevices('/source', metadata, sender, keys);
    const descriptor = chat.decryptEnvelope(encrypted.envelopes[1], recipient);
    const ciphertext = Buffer.from(files.get(encrypted.encryptedUri));
    assert.equal(encrypted.ciphertextSha256, crypto.createHash('sha256').update(ciphertext).digest('base64'));
    await chunked.decryptChunkedAttachmentFile(encrypted.encryptedUri, '/clear', descriptor);
    assert.deepEqual(files.get('/clear'), plaintext);
    assert.deepEqual(Buffer.from(chat.decryptAttachmentBase64(b64(ciphertext), descriptor).base64, 'base64'), plaintext);
    const damaged = Buffer.from(ciphertext); damaged[damaged.length - 1] ^= 1;
    files.set('/damaged', damaged);
    await assert.rejects(chunked.decryptChunkedAttachmentFile('/damaged', '/unsafe', descriptor));
    assert.equal(files.has('/unsafe'), false); assert.equal(files.has('/unsafe.part'), false);
    assert.throws(() => chat.decryptAttachmentBase64(b64(damaged), descriptor));
    assert.throws(() => chat.decryptAttachmentBase64(b64(ciphertext.subarray(1)), descriptor));
    assert.equal(chunked.parseChunkedAttachmentDescriptor(JSON.stringify({ ...JSON.parse(descriptor), chunkCount: 0 })), null);
  }
  console.log('PASS chunked V2 round-trips boundary sizes on file/browser paths and rejects corruption without publishing plaintext');
  // Independent Node AES-GCM vectors use the same prefix + big-endian counter
  // wire format implemented by the iOS and Android native modules.
  const key = crypto.randomBytes(32), prefix = crypto.randomBytes(4), plaintext = crypto.randomBytes(2055), chunkSize = 1024;
  const chunks = [];
  for (let offset = 0, index = 0; offset < plaintext.length; offset += chunkSize, index++) {
    const nonce = Buffer.alloc(12); prefix.copy(nonce); nonce.writeBigUInt64BE(BigInt(index), 4);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
    chunks.push(Buffer.concat([cipher.update(plaintext.subarray(offset, offset + chunkSize)), cipher.final(), cipher.getAuthTag()]));
  }
  const descriptor = JSON.stringify({ ...metadata, type: 'ATTACHMENT', v: 3, format: 'CHUNKED_AES_GCM_V3', key: b64(key), noncePrefix: b64(prefix), chunkSize, chunkCount: chunks.length, plaintextSize: plaintext.length });
  assert.deepEqual(Buffer.from(chat.decryptAttachmentBase64(b64(Buffer.concat(chunks)), descriptor).base64, 'base64'), plaintext);
  assert.throws(() => chat.decryptAttachmentBase64(b64(Buffer.concat([chunks[1], chunks[0], chunks[2]])), descriptor));
  console.log('PASS native V3 wire-format vectors decrypt in the browser and reject reordered chunks');
})().catch(error => { console.error(error); process.exitCode = 1; });
