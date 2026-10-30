// 세 언어 리소스가 같은 키 구조를 갖는지, 코드에서 실제로 쓰는 t() 키가 전부 존재하는지 확인한다.
// 번역 하나를 빼먹어도 화면에선 i18next 가 키를 그대로 보여줄 뿐 에러가 안 나서, 수동으로 세 언어를
// 다 눌러보지 않으면 놓치기 쉽다 - 그래서 자동 테스트로 잡는다.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import ko from '../src/i18n/locales/ko.ts';
import en from '../src/i18n/locales/en.ts';
import zh from '../src/i18n/locales/zh.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url)); // .../frontend/tests

function leafPaths(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) out.push(...leafPaths(v, p));
    else out.push(p);
  }
  return out;
}

// src·app 전체에서 t('literal.key') / t(`literal.key.${dynamic}`) 형태로 쓰는 키의 "리터럴 부분"만 모은다.
// 리터럴 부분만 모으는 이유: 동적 조각(${f} 등)은 타입(union)으로 이미 보장되고, 여기선 정적 키 존재만 본다.
function collectUsedKeyPrefixes(dir) {
  const prefixes = new Set();
  for (const file of walk(dir)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(/\bt\(\s*(['"`])((?:[^'"`]|\\.)*?)\1/g)) {
      const raw = m[2];
      // 템플릿 리터럴의 ${...} 는 와일드카드로 취급 - "alerts.type." 처럼 앞부분만 있으면 그 prefix가 실제 존재하는지 본다.
      const literalPrefix = raw.split('${')[0];
      if (literalPrefix) prefixes.add(literalPrefix.replace(/\.$/, ''));
    }
  }
  return prefixes;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

// path 가 리소스 안의 리프 키이거나, 동적 키의 부모 객체(그 아래에 적어도 하나의 값이 있는 그룹)인지 확인한다.
function existsAsLeafOrGroup(resource, dottedPath) {
  const node = dottedPath.split('.').reduce((o, k) => (o == null || typeof o !== 'object' ? undefined : o[k]), resource);
  return node !== undefined;
}

test('ko/en/zh 리소스는 같은 키 구조를 갖는다(번역 하나라도 빠지면 실패)', () => {
  const koPaths = leafPaths(ko).sort();
  const enPaths = leafPaths(en).sort();
  const zhPaths = leafPaths(zh).sort();
  assert.deepEqual(enPaths, koPaths, 'en.ts 가 ko.ts 와 다른 키 구조를 가짐');
  assert.deepEqual(zhPaths, koPaths, 'zh.ts 가 ko.ts 와 다른 키 구조를 가짐');
});

test('코드에서 쓰는 t() 키가 ko.ts 에 전부 존재한다', () => {
  const used = collectUsedKeyPrefixes(path.join(ROOT, '..', 'src'));
  for (const key of collectUsedKeyPrefixes(path.join(ROOT, '..', 'app'))) used.add(key);
  const missing = [...used].filter((k) => k && !existsAsLeafOrGroup(ko, k));
  assert.deepEqual(missing, [], `ko.ts 에 없는 키: ${missing.join(', ')}`);
});
