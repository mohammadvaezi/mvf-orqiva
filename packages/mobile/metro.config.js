// ── [PCODE-226 | S15 | v0.1.0] T21.3 React Native (Expo) app shell: pairing, live feed, offline cache ──
//    Why:  the app has its own install, because React Native pins its own React. Metro watches
//          packages/shared, which the app uses through a link, and refuses anything that would resolve to
//          the repository's root node_modules: that is the web app's React, and two Reacts break the app.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const rootModules = path.resolve(__dirname, '../../node_modules') + path.sep;

config.watchFolders = [path.resolve(__dirname, '../shared')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.resolveRequest = (context, name, platform) => {
  const found = context.resolveRequest(context, name, platform);
  if (found.type === 'sourceFile' && found.filePath.startsWith(rootModules))
    throw new Error(
      name +
        ' resolved to the repository root (' +
        found.filePath +
        '); install it in packages/mobile',
    );
  return found;
};

module.exports = config;
