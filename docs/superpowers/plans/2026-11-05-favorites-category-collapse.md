# 즐겨찾기 카테고리 접기/펴기 + 카테고리 빠른 선택 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 즐겨찾기 화면의 커스텀 카테고리 그룹을 기본 접힘 상태로 바꾸고 쉐브론 버튼으로 펴고 접을 수 있게 하며, 장소 추가 폼에서 이미 쓰는 카테고리 이름을 칩으로 눌러 바로 채울 수 있게 한다.

**Architecture:** `app/favorites.tsx` 한 파일만 수정한다. 접힘 상태는 `Set<string>`(카테고리 이름) 로컬 state로 관리하고 기본값은 "전부 접힘"(빈 집합이 아니라 "집합에 없으면 접힘"으로 판정 — 아래 Task 1 참고). 카테고리 칩은 이미 화면에 로드돼 있는 `groupedByCategory`의 키를 그대로 쓴다. 새 백엔드 호출·새 의존성 없음.

**Tech Stack:** React Native(Expo), TypeScript, 기존 `Icon`/`Chip`/`MenuSheet`의 쉐브론 토글 패턴.

**Spec:** `docs/superpowers/specs/2026-11-05-favorites-category-collapse-design.md`

## Global Constraints
- 접힘 상태는 기기에 저장하지 않는다 — 화면 재진입 시 항상 접힘부터 시작(Non-goal).
- 카테고리 헤더(`groupHeader`)를 눌렀을 때의 기존 "홈 화면 지도로 이동" 동작은 그대로 둔다 — 건드리지 않는다.
- 카테고리 칩은 입력창 값을 채울 뿐 저장을 강제하지 않는다. 카테고리가 하나도 없으면 칩 줄 자체를 렌더링하지 않는다.
- 이 변경은 RN 컴포넌트 테스트 인프라가 이 레포에 없다는 기존 관례를 따른다(자동 단위 테스트 추가 안 함) — `npx tsc --noEmit`과 `npm test`(회귀) 통과 + 수동 확인으로 완료 기준을 삼는다.

## Review Focus
- 카테고리가 2개 이상일 때 한 카테고리를 펴도 다른 카테고리는 접힌 채로 남아야 한다(Set 기반 독립 토글).
- 카테고리가 하나도 없는 신규 사용자: 메인 화면에 빈 그룹 섹션이 없어야 하고, 추가 폼에도 칩 줄이 안 보여야 한다.
- 쉐브론을 눌러도 헤더의 "지도로 이동" 핸들러가 같이 발동하면 안 된다(이벤트 버블링/겹친 터치 영역 주의).
- 칩을 눌러 카테고리 입력창을 채운 뒤에도 사용자가 직접 수정할 수 있어야 한다(칩이 입력을 막지 않음).
- 같은 이름의 카테고리 칩을 두 번 누르거나, 칩으로 채운 뒤 다시 지워도 저장(`onSave`)이 정상 동작해야 한다.

---

## 파일 구조

- `frontend/app/favorites.tsx` (수정만) — 메인 리스트 렌더링 부분(카테고리 그룹 토글)과 `AddFavoriteCard`(카테고리 칩) 두 군데를 고친다. 새 파일 없음.

---

### Task 1: 카테고리 그룹 접기/펴기

**Files:**
- Modify: `frontend/app/favorites.tsx:1`(import), `:110-123`(카테고리 그룹 렌더링), `:323-376`(styles)

**Interfaces:**
- Consumes: 없음(화면 로컬 상태만 씀).
- Produces: 없음(이 화면 안에서만 쓰는 state).

이 작업은 RN 컴포넌트라 전용 유닛 테스트를 새로 만들지 않는다(레포 관례, Global Constraints 참고). `npx tsc --noEmit`·`npm test`(회귀)와 수동 확인(Step 4)으로 완료를 확인한다.

- [ ] **Step 1: import 추가**

`frontend/app/favorites.tsx:1`을 고쳐 `ChevronDown`, `ChevronUp`을 `lucide-react-native`에서 가져온다(기존 `Briefcase, Heart, House, MapPin, Trash2, X, type LucideIcon`에 추가):

```ts
import { Briefcase, ChevronDown, ChevronUp, Heart, House, MapPin, Trash2, X, type LucideIcon } from 'lucide-react-native';
```

- [ ] **Step 2: 접힘 상태 추가**

`FavoritesScreen` 함수 안, `items`/`loadError` state 선언(`frontend/app/favorites.tsx:31-32`) 바로 아래에 추가:

```ts
// 카테고리 그룹은 기본 접힘(100개짜리 카테고리가 화면을 다 덮지 않게) - 이 Set 에 들어있으면 "펴짐".
const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
const toggleCategory = (category: string) => {
  setExpandedCategories((prev) => {
    const next = new Set(prev);
    if (next.has(category)) next.delete(category);
    else next.add(category);
    return next;
  });
};
```

- [ ] **Step 3: 렌더링에 쉐브론 버튼과 조건부 목록 적용**

`frontend/app/favorites.tsx:110-123`의 카테고리 그룹 블록을 고친다. 기존 헤더 `Pressable`(지도 이동)은 그대로 두고, 그 옆에 쉐브론 `Pressable`을 형제로 추가하며, 항목 목록(`group.map(...)`)은 `expandedCategories.has(category)`일 때만 렌더링한다:

```tsx
{Object.entries(groupedByCategory).map(([category, group]) => {
  const expanded = expandedCategories.has(category);
  return (
    <View key={category} style={styles.group}>
      <View style={styles.groupHeaderRow}>
        <Pressable
          onPress={() => router.push({ pathname: '/', params: { favoriteCategory: category } })}
          style={({ pressed }) => [styles.groupHeader, pressed && styles.pressed]}
          accessibilityRole="button"
        >
          <Text style={styles.groupHeaderText}>{category}</Text>
        </Pressable>
        <Pressable
          onPress={() => toggleCategory(category)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={category}
          hitSlop={8}
          style={styles.groupChevron}
        >
          <Icon icon={expanded ? ChevronUp : ChevronDown} size={20} color={colors.muted} />
        </Pressable>
      </View>
      {expanded &&
        group.map((item) => (
          <FavoriteRow key={item.id} item={item} onPress={() => onStart(item)} onDelete={() => onDelete(item.id)} />
        ))}
    </View>
  );
})}
```

`styles.groupHeader`(`frontend/app/favorites.tsx:333`)는 `flex: 1`을 추가해 쉐브론과 한 줄에 나란히 들어가게 한다. 새 스타일 `groupHeaderRow: { flexDirection: 'row', alignItems: 'center' }`와 `groupChevron: { padding: space.xs }`를 `styles`(`frontend/app/favorites.tsx:323` 근처)에 추가한다.

- [ ] **Step 4: 타입체크 + 전체 테스트 + 수동 확인**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 에러 없음, 테스트 전부 PASS(기존에 있던 무관한 flaky `guidance-session` 테스트 1건은 제외하고 판단).

수동 확인: 커스텀 즐겨찾기를 같은 카테고리로 2개 이상 만든 테스트 계정으로 즐겨찾기 화면을 열어 카테고리가 기본 접힘인지 확인. 쉐브론을 눌러 펴지는지, 다시 눌러 접히는지 확인. 카테고리 2개를 만들어 하나만 펴도 다른 하나는 접힌 채로 남는지 확인. 헤더(카테고리 이름) 텍스트 부분을 누르면 여전히 홈 화면 지도로 이동하는지(쉐브론을 누른 게 아니라 헤더를 눌렀을 때만) 확인.

- [ ] **Step 5: 커밋**

```bash
git add frontend/app/favorites.tsx
git commit -m "feat: 즐겨찾기 카테고리 목록 접기/펴기 추가"
```

---

### Task 2: 장소 추가 폼에 카테고리 빠른 선택 칩

**Files:**
- Modify: `frontend/app/favorites.tsx:127`(호출부에 prop 추가), `:182`(`AddFavoriteCard` 시그니처), `:314-317`(카테고리 입력 주변), `:323-376`(styles)

**Interfaces:**
- Consumes: `FavoritesScreen`이 이미 계산해 둔 `groupedByCategory`(Task 1에서 안 바뀜, `frontend/app/favorites.tsx:56-64`)의 키 목록.
- Produces: 없음.

RN 컴포넌트라 전용 유닛 테스트를 새로 만들지 않는다(Task 1과 같은 이유).

- [ ] **Step 1: 카테고리 목록을 `AddFavoriteCard`에 전달**

`frontend/app/favorites.tsx:127`의 호출부를 고친다:

```tsx
<AddFavoriteCard
  token={token}
  existingKinds={new Set(items?.map((i) => i.kind))}
  existingCategories={Object.keys(groupedByCategory)}
  onAdded={load}
/>
```

`AddFavoriteCard`(`frontend/app/favorites.tsx:182`)의 함수 시그니처에 `existingCategories: string[]`을 추가:

```ts
function AddFavoriteCard({
  token,
  existingKinds,
  existingCategories,
  onAdded,
}: {
  token: string;
  existingKinds: Set<FavoriteKind> | undefined;
  existingCategories: string[];
  onAdded: () => Promise<void>;
}) {
```

- [ ] **Step 2: 카테고리 입력 위에 칩 목록 렌더링**

`frontend/app/favorites.tsx:315-317`(`kind === 'custom'`일 때의 카테고리 `TextField`) 바로 위에 추가 — 칩을 누르면 `setCategory`로 입력창 값을 채우고, 현재 값과 같은 카테고리는 선택 표시:

```tsx
{kind === 'custom' && existingCategories.length > 0 && (
  <View style={styles.categoryChipRow}>
    {existingCategories.map((name) => (
      <Chip key={name} label={name} selected={category === name} onPress={() => setCategory(name)} />
    ))}
  </View>
)}
```

`styles.categoryChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }`를 `styles`에 추가.

- [ ] **Step 3: 타입체크 + 전체 테스트 + 수동 확인**

Run: `npx tsc --noEmit && npm test`
Expected: 타입 에러 없음, 테스트 전부 PASS(동일하게 무관한 flaky 1건 제외).

수동 확인: 카테고리가 이미 1개 이상 있는 테스트 계정으로 "장소 추가"를 열고 즐겨찾기 종류를 "즐겨찾기"(custom)로 선택 → 기존 카테고리 칩이 보이는지 확인 → 칩을 누르면 카테고리 입력창에 그 이름이 채워지는지 확인 → 입력창을 직접 수정해도 되는지 확인 → 저장이 정상 동작하는지 확인. 카테고리가 하나도 없는 계정으로는 칩 줄 자체가 안 보이는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add frontend/app/favorites.tsx
git commit -m "feat: 즐겨찾기 추가 시 기존 카테고리 칩으로 빠르게 선택"
```
