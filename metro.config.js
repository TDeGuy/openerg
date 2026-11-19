const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The swipeable tabs (react-native-tab-view) pick a native pager on phones, which starts a tab swipe
// on steep diagonal drags and cannot be told to leave a chart's touch alone. Its JS pager only
// reacts to clearly sideways movement (dx > 2 * dy) and respects views that hold the touch, so use
// that one on every platform.
const tabView = path.join(__dirname, 'node_modules', 'react-native-tab-view') + path.sep;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (/^\.\/Pager(\.js)?$/.test(moduleName) && context.originModulePath.startsWith(tabView)) {
    return { type: 'sourceFile', filePath: path.join(path.dirname(context.originModulePath), 'Pager.js') };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
