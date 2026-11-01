// 주행 아이콘: TS 선택지, Kotlin 매핑, 네이티브 PNG(주야간 x GPS on/off), 설정 화면 미리보기가 서로 맞는지 확인한다.
// 하나라도 빠지면 빌드는 되더라도 실기기에서 아이콘이 안 바뀌거나 앱이 죽을 수 있다(decodeResource 는 PNG 만 읽는다).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { CAR_ICONS } from '../src/native/navigationTypes.ts';

const root = new URL('../', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');
const kotlin = read('modules/kakao-navigation/android/src/main/java/com/tikkeuldata/navigation/CarIcons.kt');
const custom = CAR_ICONS.filter((id) => id !== 'default');

test('every TS car icon id has a Kotlin mapping, and default restores the SDK marker', () => {
  for (const id of custom) assert.match(kotlin, new RegExp(`"${id}" to`), id);
  assert.match(kotlin, /const val DEFAULT = "default"/);
  assert.match(kotlin, /setCustomCarImages\(null, null, null, null\)/);
});

test('each custom icon has day/night x on/off PNGs that are referenced in order', () => {
  for (const id of custom) {
    for (const mode of ['day', 'night']) {
      for (const gps of ['on', 'off']) {
        const name = `tikkeul_car_${id}_${mode}_${gps}`;
        const png = fs.readFileSync(new URL(`modules/kakao-navigation/android/src/main/res/drawable-nodpi/${name}.png`, root));
        assert.equal(png.subarray(1, 4).toString(), 'PNG', name);
      }
      // SDK reads [on, off]: index 0 is the normal marker, index 1 the weak-GPS marker.
      assert.match(kotlin, new RegExp(`listOf\\(R\\.drawable\\.tikkeul_car_${id}_${mode}_on, R\\.drawable\\.tikkeul_car_${id}_${mode}_off\\)`));
    }
    assert.ok(fs.existsSync(new URL(`assets/car-icons/${id}.png`, root)), `preview ${id}`);
  }
});
