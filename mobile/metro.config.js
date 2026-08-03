const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// @noble/hashes 1.8 publishes the React Native-safe crypto shim through the
// `./crypto` export, while Metro can normalize its internal import to
// `./crypto.js`. Keep package exports enabled and redirect only that missing
// alias instead of disabling export validation for every dependency.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const compatibleModuleName = moduleName === "@noble/hashes/crypto" || moduleName === "@noble/hashes/crypto.js"
    ? path.join(__dirname, "node_modules", "@noble", "hashes", "crypto.js")
    : moduleName;
  return context.resolveRequest(context, compatibleModuleName, platform);
};

module.exports = config;
