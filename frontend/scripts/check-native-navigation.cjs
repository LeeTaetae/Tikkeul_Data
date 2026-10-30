const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
require('@expo/env').load(process.cwd(), { silent: true });
const app = JSON.parse(fs.readFileSync('app.json', 'utf8')).expo;
const keyConfigured = !!process.env.KAKAO_NAVI_NATIVE_APP_KEY?.trim();
const java = spawnSync('java', ['-version'], { encoding: 'utf8', windowsHide: true });
const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk');
const androidAvailable = fs.existsSync(androidHome);
console.log(JSON.stringify({
  androidPackage: app.android.package,
  iosBundleIdentifier: app.ios.bundleIdentifier,
  nativeKeyConfigured: keyConfigured,
  nativeModulePresent: fs.existsSync('modules/kakao-navigation/expo-module.config.json'),
  javaAvailable: !java.error && java.status === 0,
  androidSdkAvailable: androidAvailable,
  localIosBuildAvailable: process.platform === 'darwin',
  note: 'Browser and Expo Go cannot execute the official navigation UI. See docs/kakao-native-navigation.md.',
}, null, 2));
if (process.argv.includes('--strict') && (!keyConfigured || java.error || java.status !== 0 || !androidAvailable)) process.exitCode = 1;
