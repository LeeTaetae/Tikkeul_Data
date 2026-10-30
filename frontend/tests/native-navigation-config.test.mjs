import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import withKakaoNavigation from '../plugins/withKakaoNavigation.cjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function apply(config, platform, mod, modResults) {
  const result = await config.mods[platform][mod]({
    ...config, modResults,
    modRequest: { projectRoot: root, platformProjectRoot: root, platformName: platform, modName: mod },
  });
  return result.modResults;
}

test('native key is applied only to native manifests, preserving unrelated settings', async t => {
  const previous = process.env.KAKAO_NAVI_NATIVE_APP_KEY;
  t.after(() => { if (previous === undefined) delete process.env.KAKAO_NAVI_NATIVE_APP_KEY; else process.env.KAKAO_NAVI_NATIVE_APP_KEY = previous; });
  const key = 'test-only-native-key';
  process.env.KAKAO_NAVI_NATIVE_APP_KEY = key;
  const config = withKakaoNavigation({ name: 'Fixture', slug: 'fixture', extra: { unrelated: 'kept' } });
  const manifest = await apply(config, 'android', 'manifest', { manifest: { application: [{ 'meta-data': [{ $: { 'android:name': 'existing', 'android:value': 'keep' } }] }] } });
  assert.equal(manifest.manifest.application[0]['meta-data'].find(m => m.$['android:name'] === 'existing').$['android:value'], 'keep');
  assert.equal(manifest.manifest.application[0]['meta-data'].find(m => m.$['android:name'] === 'com.tikkeuldata.kakao.NATIVE_APP_KEY').$['android:value'], key);
  const plist = await apply(config, 'ios', 'infoPlist', { UIBackgroundModes: ['fetch'], NSAppTransportSecurity: { NSAllowsArbitraryLoads: false } });
  assert.equal(plist.KakaoNaviNativeAppKey, key);
  assert.equal(plist.NSAppTransportSecurity.NSAllowsArbitraryLoads, false);
  assert.deepEqual(plist.UIBackgroundModes, ['fetch', 'audio', 'location']);
  assert.deepEqual(config.extra, { unrelated: 'kept' });
  const repeated = await apply(config, 'android', 'manifest', manifest);
  assert.equal(repeated.manifest.application[0]['meta-data'].filter(m => m.$['android:name'] === 'com.tikkeuldata.kakao.NATIVE_APP_KEY').length, 1);
});

test('removing the native key removes stale native credentials on regeneration', async t => {
  const previous = process.env.KAKAO_NAVI_NATIVE_APP_KEY;
  t.after(() => { if (previous === undefined) delete process.env.KAKAO_NAVI_NATIVE_APP_KEY; else process.env.KAKAO_NAVI_NATIVE_APP_KEY = previous; });
  delete process.env.KAKAO_NAVI_NATIVE_APP_KEY;
  const config = withKakaoNavigation({ name: 'Fixture', slug: 'fixture' });
  const plist = await apply(config, 'ios', 'infoPlist', { KakaoNaviNativeAppKey: 'stale' });
  assert.equal(plist.KakaoNaviNativeAppKey, undefined);
  const manifest = await apply(config, 'android', 'manifest', { manifest: { application: [{ 'meta-data': [{ $: { 'android:name': 'com.tikkeuldata.kakao.NATIVE_APP_KEY', 'android:value': 'stale' } }] }] } });
  assert.equal(manifest.manifest.application[0]['meta-data'].length, 0);
});

test('native repositories are present exactly once after repeated prebuild mods', async () => {
  const config = withKakaoNavigation({ name: 'Fixture', slug: 'fixture' });
  const original = { language: 'groovy', contents: 'buildscript { }\n' };
  const first = await apply(config, 'android', 'projectBuildGradle', original);
  const second = await apply(config, 'android', 'projectBuildGradle', first);
  assert.equal(second.contents, first.contents);
  assert.equal(second.contents.split('kakao-mobility-android-knsdk-public/').length - 1, 1);
  assert.ok(second.contents.startsWith('buildscript { }'));
});

test('Expo public configuration does not expose the native application key', () => {
  const key = 'test-key-must-not-appear-in-public-config';
  const result = spawnSync(process.execPath, ['node_modules/expo/bin/cli', 'config', '--type', 'public', '--json'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
    env: { ...process.env, KAKAO_NAVI_NATIVE_APP_KEY: key, CI: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes(key), false);
});
