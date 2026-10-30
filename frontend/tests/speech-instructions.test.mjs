// H단계: 음성으로 읽을 턴 안내의 중복 줄 제거(같은 위치·같은 거리·같은 도로명일 때만).
// 샘플은 실제 TMAP 응답(의정부 → 강남역 자동차 경로)의 문구·구조를 그대로 옮긴 것이다. 좌표는 구조만 맞춘 값이다.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { dedupeSpokenInstructions, SAME_POINT_M } from '../src/lib/navigation/speechInstructions.ts';

const M = 111320;
const K = Math.cos((37.7 * Math.PI) / 180);
const at = (northM, eastM = 0) => ({ lat: 37.7 + northM / M, lng: 127 + eastM / (M * K) });
const line = (text, point) => ({ text, point });

// 실제 응답 구조: [시작 구간 요약] [턴 문구] [같은 구간 요약] [턴 문구] [같은 구간 요약] …
const P0 = at(0);
const P1 = at(142);
const P2 = at(300);
const P3 = at(452);
const REAL = [
  line('일반도로, 142m', P0),
  line('교차로에서 우회전 후 느티나무1길을 따라 158m 이동', P1),
  line('느티나무1길, 158m', P1),
  line('교차로에서 좌회전 후 신촌로를 따라 152m 이동', P2),
  line('신촌로, 152m', P2),
  line('신촌 교차로에서 법원,검찰청 방면으로 우회전 후 의정로를 따라 177m 이동', P3),
  line('의정로, 177m', P3),
];

test('같은 위치·같은 거리·같은 도로명의 "도로명, 거리" 요약 줄만 뺀다(실제 응답 구조)', () => {
  const result = dedupeSpokenInstructions(REAL);
  assert.deepEqual(result.map((i) => i.text), [
    '일반도로, 142m', // 앞에 턴 문구가 없는 시작 구간 요약은 중복이 아니다
    '교차로에서 우회전 후 느티나무1길을 따라 158m 이동',
    '교차로에서 좌회전 후 신촌로를 따라 152m 이동',
    '신촌 교차로에서 법원,검찰청 방면으로 우회전 후 의정로를 따라 177m 이동',
  ]);
});

test('서로 다른 안내 지점은 지우지 않는다: 턴 문구는 모두 남고, 문구는 원문 그대로다', () => {
  const result = dedupeSpokenInstructions(REAL);
  const turns = REAL.filter((i) => i.text.includes('이동'));
  assert.deepEqual(result.filter((i) => i.text.includes('이동')), turns);
  assert.ok(result.every((i) => REAL.includes(i))); // 새 객체·변형된 문구가 없다
});

test('같은 거리여도 위치가 다르면(3m 초과) 다른 안내라 남긴다', () => {
  const far = [line('교차로에서 우회전 후 신촌로를 따라 152m 이동', P2), line('신촌로, 152m', at(300 + SAME_POINT_M + 20))];
  assert.equal(dedupeSpokenInstructions(far).length, 2);
});

test('같은 위치여도 거리가 다르거나 도로명이 다르면 남긴다', () => {
  assert.equal(dedupeSpokenInstructions([line('우회전 후 신촌로를 따라 152m 이동', P2), line('신촌로, 300m', P2)]).length, 2); // 거리 다름
  assert.equal(dedupeSpokenInstructions([line('우회전 후 신촌로를 따라 152m 이동', P2), line('의정로, 152m', P2)]).length, 2); // 도로명 다름
});

test('좌표가 없으면 같은 위치임을 확인할 수 없어 빼지 않는다', () => {
  assert.equal(dedupeSpokenInstructions([line('우회전 후 신촌로를 따라 152m 이동', null), line('신촌로, 152m', null)]).length, 2);
  assert.equal(dedupeSpokenInstructions([line('우회전 후 신촌로를 따라 152m 이동', P2), line('신촌로, 152m', null)]).length, 2);
});

test('요약 형태가 아닌 줄과 첫 줄, 빈 목록은 그대로 둔다(입력을 바꾸지 않는다)', () => {
  const input = [line('목적지에 도착했습니다', P3), line('직진', P3)];
  const copy = JSON.parse(JSON.stringify(input));
  assert.deepEqual(dedupeSpokenInstructions(input), input);
  assert.deepEqual(input, copy);
  assert.deepEqual(dedupeSpokenInstructions([]), []);
  assert.equal(dedupeSpokenInstructions([line('신촌로, 152m', P2)]).length, 1);
});
