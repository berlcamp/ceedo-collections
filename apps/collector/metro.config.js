const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// @ceedo/shared, @ceedo/db-local and @ceedo/sync-engine live outside this app directory,
// which metro does not watch or resolve into by default -- they would resolve in Node and
// fail in the bundler.
//
// `disableHierarchicalLookup` is deliberately NOT set. Expo's monorepo guide offers it for
// hoisted (npm/yarn) layouts; under pnpm's isolated layout every package's dependencies sit
// in its OWN node_modules beside it, so switching off the upward walk makes them
// unreachable. Measured, not assumed: with it on, `expo export` fails to resolve
// @expo/metro-runtime from expo-router's own entry file.
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.sourceExts.push("sql");

module.exports = config;
