const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const messengerPath = path.join(root, "src", "screens", "MessengerScreen.tsx");
const source = fs.readFileSync(messengerPath, "utf8");

function assertContains(label, pattern) {
  if (!pattern.test(source)) {
    console.error(`Chitthi encryption regression check failed: ${label}`);
    process.exitCode = 1;
  }
}

assertContains(
  "encrypted transport text detector exists",
  /function\s+looksLikeEncryptedTransportText\s*\(\s*value:\s*string\s*\)/
);
assertContains(
  "detector catches backend encrypted placeholders",
  /isEncryptedPlaceholder\(text\)/
);
assertContains(
  "detector catches rich/private/location transport prefixes",
  /\^FF\(\?:RICH\|FORWARD\|PRIVATE\|LOCATION\|POLL\|EVENT\|CONTACT\):/
);
assertContains(
  "safe visible text never returns raw encrypted transport",
  /function\s+safeVisibleMessageText[\s\S]*?looksLikeEncryptedTransportText\(value\)\s*\?\s*unavailableEncryptedMessageText\s*:\s*value/
);
assertContains(
  "undecryptable encrypted messages are hidden from visible message arrays",
  /function\s+hideUndecryptableEncryptedMessages[\s\S]*?message\.text\s*!==\s*unavailableEncryptedMessageText/
);
assertContains(
  "decryption success path filters unavailable encrypted messages",
  /return\s+hideUndecryptableEncryptedMessages\(decryptedMessages\)/
);
assertContains(
  "envelope fetch failure path filters unavailable encrypted messages",
  /return\s+hideUndecryptableEncryptedMessages\(nextMessages\.map/
);
assertContains(
  "render path uses safe visible message text",
  /const\s+visibleMessageText\s*=\s*safeVisibleMessageText\(message\.text\s*\|\|\s*""\)/
);
assertContains(
  "search skips encrypted transport/unavailable messages",
  /looksLikeEncryptedTransportText\(message\.text\).*return/
);
assertContains(
  "sharing uses safe visible message text",
  /function\s+shareableMessageText[\s\S]*?const\s+visibleText\s*=\s*safeVisibleMessageText/
);
assertContains(
  "cached encrypted transport rows are not flashed before hydration",
  /showCachedThreadMessages[\s\S]*?cachedMessages\.some\(\(message\)\s*=>\s*looksLikeEncryptedTransportText\(message\.text\)\)[\s\S]*?return\s+false/
);

if (!process.exitCode) {
  console.log("Chitthi encryption regression check passed.");
}
