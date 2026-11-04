// VisionHazardAlert 배너의 색·3개 언어 문구가 5개 클래스 모두 갖춰져 있는지 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import en from '../src/i18n/locales/en.ts';
import ko from '../src/i18n/locales/ko.ts';
import zh from '../src/i18n/locales/zh.ts';
import { visionHazardTone } from '../src/theme.ts';

const CLASSES = ['kickboard', 'motorcycle', 'vehicle', 'person', 'animal'];

for (const [name, locale] of [
  ['ko', ko],
  ['en', en],
  ['zh', zh],
]) {
  test(`${name} 로케일에 비전 라벨·메시지 5개 모두 있다`, () => {
    for (const c of CLASSES) {
      assert.ok(locale.visionHazard.label[c], `${name}.visionHazard.label.${c}`);
      assert.ok(locale.visionHazard.message[c], `${name}.visionHazard.message.${c}`);
    }
  });
}

test('visionHazardTone에 5개 클래스 모두 색이 있다', () => {
  for (const c of CLASSES) assert.ok(visionHazardTone[c]?.accent);
});
