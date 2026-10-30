// 상세 경로 표시 다듬기(src/lib/routeInstructions.ts) 테스트.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dedupeInstructions, formatInstructionText } from '../src/lib/routeInstructions.ts';

const i = (text) => ({ text, point: null });

test('거리 표기를 km 단위로 바꾼다(1km 이상)', () => {
  assert.equal(formatInstructionText('신흥로, 1856m'), '신흥로, 1.9km');
  assert.equal(formatInstructionText('교차로에서 좌회전 후 ~로를 따라 4785m 이동'), '교차로에서 좌회전 후 ~로를 따라 4.8km 이동');
});

test('1km 미만은 10m 단위로 반올림만 한다', () => {
  assert.equal(formatInstructionText('일반도로, 19m'), '일반도로, 20m');
});

test('턴 설명 바로 뒤 같은 구간 요약 줄은 뺀다', () => {
  const result = dedupeInstructions([
    i('9시 방향 후 일반도로를 따라 19m 이동'),
    i('일반도로, 19m'), // 중복 - 빠져야 함
    i('신흥로56번길, 288m'),
    i('대학길 삼거리에서 우회전 후 신흥로를 따라 359m 이동'),
    i('신흥로, 359m'), // 중복 - 빠져야 함
    i('도착'),
  ]);
  assert.deepEqual(
    result.map((r) => r.text),
    ['9시 방향 후 일반도로를 따라 19m 이동', '신흥로56번길, 288m', '대학길 삼거리에서 우회전 후 신흥로를 따라 359m 이동', '도착'],
  );
});

test('거리가 다르면 중복으로 보지 않는다', () => {
  const result = dedupeInstructions([i('신흥로, 100m'), i('신흥로, 200m')]);
  assert.equal(result.length, 2);
});

test('첫 줄이 "도로명, 거리" 형태라도(앞에 비교 대상이 없으면) 유지한다', () => {
  const result = dedupeInstructions([i('일반도로, 1m')]);
  assert.equal(result.length, 1);
});
