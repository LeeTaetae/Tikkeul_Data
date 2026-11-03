const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, withInfoPlist, withProjectBuildGradle, withAppBuildGradle, createRunOncePlugin } = require('expo/config-plugins');

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
  config = withAndroidManifest(config, mod => {
    const key = process.env.KAKAO_NAVI_NATIVE_APP_KEY?.trim();
    const app = mod.modResults.manifest.application?.[0];
    if (!app) throw new Error('Android application manifest is missing');
    const activityName = 'com.kakao.sdk.auth.AuthCodeHandlerActivity';
    app.activity = (app.activity || []).filter(item => item.$['android:name'] !== activityName);
    if (key) {
      app.activity.push({
        $: { 'android:name': activityName, 'android:exported': 'true' },
        'intent-filter': [{
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
          ],
          data: [{ $: { 'android:scheme': `kakao${key}`, 'android:host': 'oauth' } }],
        }],
      });
    }
    return mod;
  });
  config = withProjectBuildGradle(config, mod => {
    if (!mod.modResults.contents.includes('// tikkeul-kakao-navigation repositories')) {
      mod.modResults.contents += `\n// tikkeul-kakao-navigation repositories\nallprojects {\n  repositories {\n${repositories.map(url => `    maven { url '${url}' }`).join('\n')}\n  }\n}\n`;
    }
    return mod;
  });
  config = withAppBuildGradle(config, mod => {
    const marker = '// tikkeul-navigation: Windows CMake object paths';
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents += `\n${marker}\nif (System.getProperty('os.name').toLowerCase().contains('windows')) {\n    android.defaultConfig.externalNativeBuild.cmake.arguments '-DCMAKE_UNITY_BUILD=ON', '-DCMAKE_UNITY_BUILD_BATCH_SIZE=1', '-DCMAKE_OBJECT_PATH_MAX=128'\n}\n`;
    }
    return mod;
  });
  // KNSDK.framework (Kakao's prebuilt binary) was linked against Realm/RealmSwift as dynamic frameworks,
  // so it looks for them at @rpath at runtime. Expo's autolinking forces Realm back to a static library
  // because it vendors a precompiled xcframework (expo-modules-autolinking/scripts/ios/precompiled_modules.rb),
  // which leaves Realm.framework missing from the app bundle and crashes at launch. Expo applies that
  // downgrade by monkey-patching Pod::Installer#run_podfile_pre_install_hooks to run *after* any Podfile
  // `pre_install` block, so a plain `pre_install do...end` here gets overridden. Wrap the (already patched)
  // method once more so our override for just these two pods runs last and wins.
  config = withDangerousMod(config, ['ios', mod => {
    const podfilePath = path.join(mod.modRequest.platformProjectRoot, 'Podfile');
    const contents = fs.readFileSync(podfilePath, 'utf8');
    const marker = '# tikkeul-kakao-navigation: keep Realm/RealmSwift dynamic for KNSDK';
    if (!contents.includes(marker)) {
      const hook = `\n${marker}\nPod::Installer.class_eval do\n  _tikkeul_original_run_podfile_pre_install_hooks = instance_method(:run_podfile_pre_install_hooks)\n  define_method(:run_podfile_pre_install_hooks) do\n    _tikkeul_original_run_podfile_pre_install_hooks.bind(self).call\n    pod_targets.each do |t|\n      if ['Realm', 'RealmSwift'].include?(t.name)\n        def t.build_type\n          Pod::BuildType.dynamic_framework\n        end\n      end\n    end\n  end\nend\n`;
      fs.writeFileSync(podfilePath, `${contents}${hook}`);
    }
    return mod;
  }]);

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
    // Kakao Login's redirect URI scheme (kakao{NATIVE_APP_KEY}://oauth), reusing the same native app key as KakaoNavi.
    const scheme = key ? `kakao${key}` : null;
    mod.modResults.CFBundleURLTypes = (mod.modResults.CFBundleURLTypes || []).filter(
      entry => !((entry.CFBundleURLSchemes || []).length === 1 && entry.CFBundleURLSchemes[0]?.startsWith('kakao')),
    );
    if (scheme) mod.modResults.CFBundleURLTypes.push({ CFBundleURLSchemes: [scheme] });
    return mod;
  });
}

module.exports = createRunOncePlugin(withKakaoNavigation, 'tikkeul-kakao-navigation', '0.1.0');
