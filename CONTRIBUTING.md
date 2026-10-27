# 기여 가이드

팀 규칙의 원본은 [CLAUDE.md](CLAUDE.md)다. 이 문서는 작업 절차만 요약한다. 충돌하면 `CLAUDE.md`가 우선한다.

## 브랜치

| 브랜치 | 용도 | 누가 | 규칙 |
|---|---|---|---|
| `main` | 항상 돌아가는 안정 버전 | Git 관리자(PR 머지) | 직접 push 금지 |
| `feat/기능명` | 기능 개발 | 각자 | 기능별 브랜치 |
| `fix/버그명` | 버그 수정 | 각자 | 버그별 브랜치 |

## 작업 흐름

```bash
git status
git switch main
git pull
git switch -c feat/기능명
# ... 작업 · 테스트 ...
git status
git diff
git add <변경 파일>
git commit -m "feat: 설명"
git push -u origin feat/기능명
```

- `git add .` 대신 변경한 파일을 지정한다. `.env` 같은 파일이 섞이는 것을 막기 위해서다.
- 브랜치를 바꾸기 전에 작업 중인 변경 사항을 확인한다.
- 다른 팀원의 작업을 덮어쓰지 않는다.

## 커밋 메시지

한 줄로, 무엇을 왜 바꿨는지 알 수 있게 쓴다.

| 접두사 | 용도 |
|---|---|
| `feat:` | 기능 추가 |
| `fix:` | 버그 수정 |
| `docs:` | 문서 변경 |
| `style:` | 서식 변경 |
| `refactor:` | 구조 정리 |

예: `fix: 네트워크 끊김 시 갱신 시각이 사라지는 문제 수정`

## Pull Request

1. 브랜치를 push한 뒤 PR을 만든다. 템플릿([.github/PULL_REQUEST_TEMPLATE.md](.github/PULL_REQUEST_TEMPLATE.md))을 채운다.
2. 한 PR은 한 목적만 다룬다. 관련 없는 정리·포맷 변경을 섞지 않는다.
3. Git 관리자가 검토하고 머지한다. 작성자가 직접 머지하지 않는다.
4. 충돌이 나면 혼자 풀지 말고 Git 관리자와 함께 해결한다.

## 코드 리뷰 기준

- 변경이 요구사항과 연결되는가
- 테스트를 실제로 실행했고 결과가 PR에 적혀 있는가
- 비밀키·`.env`·개인 위치정보가 포함되지 않았는가
- 사고·충돌을 확정하는 표현이 없는가
- 요청하지 않은 기능·추상화·설정이 추가되지 않았는가

## 이슈

버그와 기능 요청은 [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE)의 양식을 사용한다. 보안 문제는 이슈로 올리지 않고 [SECURITY.md](SECURITY.md)를 따른다.
