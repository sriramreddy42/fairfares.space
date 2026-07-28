const fs = require("fs");
const path = require("path");

const roots = ["dist", "dist-visual"]
  .map((name) => path.join(__dirname, "..", name))
  .filter((root) => fs.existsSync(root));

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return fullPath.endsWith(".js") ? [fullPath] : [];
  });
}

function sanitizeBundle(filePath) {
  let source = fs.readFileSync(filePath, "utf8");
  const before = source;

  source = source.replace(
    /return eval\(body\)/g,
    'throw new Error("FairFares disabled Metro split-bundle eval for CSP-safe production web exports.")'
  );
  source = source.replace(
    /eval\(['"]require['"]\)\(['"]node:crypto['"]\)/g,
    'require("node:crypto")'
  );

  if (source !== before) {
    fs.writeFileSync(filePath, source);
    return true;
  }
  return false;
}

let changed = 0;
for (const root of roots) {
  for (const filePath of walk(root)) {
    if (sanitizeBundle(filePath)) changed += 1;
  }
}

const remaining = roots
  .flatMap((root) => walk(root))
  .filter((filePath) => {
    const source = fs.readFileSync(filePath, "utf8");
    return /\beval\s*\(|new Function\s*\(/.test(source);
  });

if (remaining.length) {
  console.error("CSP-unsafe JavaScript remained after sanitizing:");
  for (const filePath of remaining) {
    console.error(`- ${path.relative(path.join(__dirname, ".."), filePath)}`);
  }
  process.exit(1);
}

console.log(`Sanitized ${changed} FairFares web bundle file(s) for strict CSP.`);
