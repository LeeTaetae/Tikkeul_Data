const { withAndroidManifest, withInfoPlist, withProjectBuildGradle, createRunOncePlugin } = require('expo/config-plugins');

const repositories = [
  'https://devrepo.kakaomobility.com/repository/kakao-mobility-android-knsdk-public/',
  'https://devrepo.kakaomobility.com/repository/kakao-mobility-android-locationsdk-release/',
  'https://devrepo.kakaomobility.com/repository/kakao-mobility-android-knsdk-release/',
  'https://devrepo.kakao.com/nexus/content/groups/public/',
  'https://www.jitpack.io',
];

function withKakaoNavigation(config) {
  // The key is applied to native files only, never Expo extra or plugin options.
  config = withAndroidManifest(config, mod => {
    const key = process.env.KAKAO_NAVI_NATIVE_APP_KEY?.trim();
    const app = mod.modResults.manifest.application?.[0];
    if (!app) throw new Error('Android application manifest is missing');
    app['meta-data'] = (app['meta-data'] || []).filter(item => item.$['android:name'] !== 'com.tikkeuldata.kakao.NATIVE_APP_KEY');
    if (key) app['meta-data'].push({ $: { 'android:name': 'com.tikkeuldata.kakao.NATIVE_APP_KEY', 'android:value': key } });
    return mod;
  });
  config = withProjectBuildGradle(config, mod => {
    if (!mod.modResults.contents.includes('// tikkeul-kakao-navigation repositories')) {
      mod.modResults.contents += `\n// tikkeul-kakao-navigation repositories\nallprojects {\n  repositories {\n${repositories.map(url => `    maven { url '${url}' }`).join('\n')}\n  }\n}\n`;
    }
    return mod;
  });
  return withInfoPlist(config, mod => {
    const key = process.env.KAKAO_NAVI_NATIVE_APP_KEY?.trim();
    if (key) mod.modResults.KakaoNaviNativeAppKey = key;
    else delete mod.modResults.KakaoNaviNativeAppKey;
    mod.modResults.NSLocationWhenInUseUsageDescription ||= '현재 위치를 확인하여 목적지까지 길을 안내합니다.';
    mod.modResults.NSLocationAlwaysAndWhenInUseUsageDescription ||= '길안내 중 화면이 잠겨도 위치를 확인해 안내를 이어갑니다.';
    mod.modResults.UIBackgroundModes = [...new Set([...(mod.modResults.UIBackgroundModes || []), 'audio', 'location'])];
    // Scope the SDK's documented HTTP exception to its own domain.
    const ats = mod.modResults.NSAppTransportSecurity ||= {};
    const domains = ats.NSExceptionDomains ||= {};
    domains['kakao.com'] = { ...(domains['kakao.com'] || {}), NSIncludesSubdomains: true, NSExceptionAllowsInsecureHTTPLoads: true };
    return mod;
  });
}

module.exports = createRunOncePlugin(withKakaoNavigation, 'tikkeul-kakao-navigation', '0.1.0');
