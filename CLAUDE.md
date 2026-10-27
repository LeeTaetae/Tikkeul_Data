# Tikkeul_Data 팀 규칙

## 실행법
TBD — 코드 추가 시 채워넣기 (예: `python app.py` / `streamlit run app.py`)

## 브랜치 규칙
| 브랜치 | 용도 | 누가 |
|---|---|---|
| `main` | 항상 돌아가는 상태만 | 직접 푸시 금지 |
| `feat/기능명` | 기능 개발 | 각자 |
| `fix/버그명` | 버그 수정 | 각자 |

## 작업 흐름
```
git switch main
git pull
git switch -c feat/기능명
# ... 작업 ...
git add .
git commit -m "feat: 설명"
git push -u origin feat/기능명
```
푸시 후 PR을 올리고 깃 관리자가 머지한다. 충돌나면 혼자 풀지 말고 깃 관리자와 같이.

## 커밋 메시지 규칙
`feat:` 기능 추가 · `fix:` 버그 수정 · `docs:` 문서 · `style:` 서식 · `refactor:` 구조 정리
한 줄로, 무엇을 왜 바꿨는지 알아볼 수 있게.

## 건드리면 안 되는 파일·폴더
TBD

## 쓰는 라이브러리 / 쓰지 않는 라이브러리
TBD
