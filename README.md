# Dead Zone

속초고 2026 게임 수정 수업용 프로토타입입니다. 학생 번호 12의 게임입니다.

## 받기와 실행

~~~powershell
git clone https://github.com/yoon2566/sokcho-2026-12-dead-zone.git
cd sokcho-2026-12-dead-zone
opencode
~~~

Git과 OpenCode를 미리 설치하고 OpenCode의 AI 모델을 연결합니다. index.html을 Chrome 또는 Edge로 열어 플레이합니다. 실행에 필요한 자산을 HTML에 포함했으며 별도 서버 없이 실행하도록 제작했습니다.

## 수정할 파일

`game.js`의 게임 코드와 `source.template.html`의 화면을 수정합니다.

- assets/: 원본 게임의 모델 또는 스프라이트
- assets.json: 자산 이름과 저장소 안의 경로
- build.ps1: 수정한 소스를 실행용 HTML로 묶는 도구
- index.html: 최종 실행 파일

vendor 폴더가 있는 게임은 실행 라이브러리와 Three.js 라이선스가 포함됩니다. 라이브러리를 직접 수정할 필요는 없습니다.

수정 후 프로젝트 폴더에서 다음 명령으로 index.html을 다시 만듭니다. Python 설치는 필요하지 않습니다.

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
~~~

## OpenCode에 요청하기

~~~text
README.md와 source.template.html을 읽고 게임 구조와 조작 방법을 설명해 줘.
이번에는 내가 원하는 기능 하나만 수정해 줘.
수정한 뒤 build.ps1로 index.html을 다시 만들고, 직접 확인할 방법을 알려 줘.
~~~

기존 HTML 프로토타입을 수업용으로 옮겼습니다. 최신 훈위안 리깅 통합본은 아닙니다. 제출 주소는 수업 노션에서 안내합니다.
