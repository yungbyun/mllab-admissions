# 대학원 진학 희망자 대시보드

**내 Gmail로 온 메일을 분석**해 대학원 진학·연구실 지원 문의를 자동으로 찾아 대시보드로 보여 줍니다. 학생이 직접 남기는 **등록 폼**도 함께 관리합니다.

- **화면**: GitHub Pages(무료 정적 호스팅)
- **메일 분석 + 데이터 저장**: 내 Google 계정의 Apps Script + 스프레드시트. 별도 서버가 필요 없습니다.
- **판별**: 키워드 규칙(기본, 무료) 또는 Claude API(선택, 더 정확하고 요약까지 작성)

```
docs/                 ← GitHub Pages로 배포하는 폴더
  admin.html          교수용 대시보드 (이메일 문의 + 등록 폼)
  index.html          학생용 등록 폼 (개인정보 동의 포함)
  config.js           연구실 이름, 선택지, Apps Script URL 설정
apps-script/
  Code.gs             API 진입점, 등록 폼 저장
  Gmail.gs            받은편지함 검사·판별 (키워드 / Claude)
```

## 대시보드 기능

**이메일 문의 탭**
- 받은편지함에서 진학 관련 메일을 검색하고(최근 2년), 진학 희망 문의인지 판별합니다.
- 보낸 사람, 학교·학과, 희망 과정, 관심 분야, 한두 문장 요약을 정리합니다.
- **답장 여부를 자동으로 추적**합니다. 내가 답장하면 "답장함"으로 바뀌고, "답장 안 함" 필터로 놓친 메일을 찾을 수 있습니다.
- 통계(전체·미답장·이번 달·신규·폼 등록), 월별 문의 추이, 관심 분야 분포를 차트로 보여 줍니다.
- 상태(신규 → 연락함 → 면담 예정 → 지원 완료), 메모, Gmail에서 바로 열기, CSV 내보내기
- 같은 학생이 등록 폼에도 등록했다면 "폼 등록" 표시가 붙습니다.
- 1시간마다 자동으로 검사하고, "지금 메일 검사" 버튼으로 바로 검사할 수도 있습니다.

**등록 폼 탭**: 학생이 직접 등록한 정보(GitHub 공개 프로필 요약 포함)의 검색, 상태, 메모, CSV, 삭제

## 1. 바로 써 보기 (데모 모드)

`config.js`의 `APPS_SCRIPT_URL`이 비어 있으면 **가상의 예시 문의 데이터**로 대시보드가 동작합니다. `docs/admin.html`을 열고 아무 키나 넣어 확인하세요.

## 2. 백엔드 만들기 (내 Google 계정)

1. 분석할 Gmail과 **같은 Google 계정**으로 새 스프레드시트를 만듭니다.
2. **확장 프로그램 → Apps Script**를 엽니다.
   - `Code.gs`에 `apps-script/Code.gs` 내용을 붙여 넣습니다.
   - 왼쪽 **파일 +** → 스크립트 → 이름 `Gmail` → `apps-script/Gmail.gs` 내용을 붙여 넣습니다.
3. **프로젝트 설정(⚙) → 스크립트 속성**에 추가합니다.
   - `ADMIN_KEY`: 대시보드 비밀번호(길고 추측하기 어렵게)
   - `CLAUDE_API_KEY` (선택): Anthropic API 키. 넣으면 Claude가 판별·요약합니다.
   - `CLAUDE_MODEL` (선택): 기본값은 `claude-opus-5-5`입니다. 메일이 많아 비용을 줄이려면 `claude-haiku-5-5`로 바꿀 수 있습니다.
4. 편집기 위쪽 함수 목록에서 `scanInbox`를 선택해 **실행**합니다. Gmail·스프레드시트 권한 승인 창이 뜨면 본인 계정으로 승인합니다. 첫 검사 결과가 `이메일 문의` 시트에 쌓입니다.
5. 같은 방법으로 `setupScanTrigger`(1시간마다 자동 검사)와 `setupRetentionTrigger`(등록 폼 보유기간 자동 파기)를 한 번씩 실행합니다.
6. **배포 → 새 배포 → 유형: 웹 앱**, 실행 계정 **나**, 액세스 **모든 사용자**로 배포합니다.
7. 발급된 `https://script.google.com/macros/s/…/exec` URL을 `docs/config.js`의 `APPS_SCRIPT_URL`에 넣습니다.

> `.gs` 파일을 고친 뒤에는 **배포 → 배포 관리 → 수정(연필) → 버전: 새 버전**으로 다시 배포해야 반영됩니다.

## 3. GitHub Pages로 배포

1. GitHub에 새 저장소를 만들고 이 폴더를 올립니다.
   ```bash
   git init
   git add .
   git commit -m "대학원 진학 희망자 대시보드"
   git branch -M main
   git remote add origin https://github.com/<아이디>/<저장소>.git
   git push -u origin main
   ```
2. 저장소 **Settings → Pages**에서 Branch `main`, 폴더 `/docs`를 선택합니다.
3. `https://<아이디>.github.io/<저장소>/admin.html`이 대시보드, `…/`가 학생용 등록 폼입니다.

## 판별 기준 조정

- **검색 범위**: `Gmail.gs`의 `GMAIL_QUERY`(Gmail 검색 문법)를 고칩니다. 예: 학교 메일만 보려면 `to:me@univ.ac.kr`를 추가합니다.
- **키워드 판별**: `STRONG_WORDS`(+3점), `WEAK_WORDS`(+1점), `NEGATIVE_WORDS`(−4점)를 고칩니다. 4점 이상이면 진학 문의로 봅니다. 기본 목록은 실제 받은편지함 표본 24통(진학 문의 14, 기타 10)으로 맞췄고, 표본에서는 모두 맞게 판별했습니다. 해외 학생의 영문 문의("Master's degree under your supervision", "PhD opportunities", "GKS" 등)를 잘 잡도록 되어 있습니다.
- **내 소속 대학**: `MY_UNIVERSITY`에 적힌 학교(기본: 제주대학교/JNU)는 지원자 학교로 뽑지 않습니다.
- **후속 메일**: 같은 학생이 "Follow-up" 등으로 새 스레드를 보내면 새 행을 만들지 않고 기존 문의의 메일 수에 합칩니다.
- **Claude 판별**: `CLAUDE_SYSTEM`의 기준 문장을 고칩니다. 신뢰도 50 이상만 목록에 올립니다.
- **관심 분야**: `Gmail.gs`의 `INTEREST_KEYWORDS`와 `docs/config.js`의 `INTERESTS` 이름을 같게 맞춥니다.
- 기준을 바꾼 뒤 지난 메일을 다시 검사하려면 `resetScannedThreads`를 실행한 다음 `scanInbox`를 실행합니다.

## 보안·개인정보

- 메일은 **읽기만** 합니다. 수정·삭제·발송은 하지 않습니다. 결과는 내 스프레드시트에만 저장됩니다.
- 대시보드 데이터는 `ADMIN_KEY`를 아는 사람만 볼 수 있습니다. 키가 유출되면 스크립트 속성에서 바로 바꾸세요.
- `CLAUDE_API_KEY`를 쓰면 판별 대상 메일 본문이 Anthropic API로 전송됩니다. 학교 정책상 외부 전송이 어렵다면 키를 넣지 말고 키워드 판별만 쓰세요.
- 스프레드시트를 다른 사람과 공유하면 키 없이도 데이터가 보이므로 공유 범위를 최소로 유지하세요.
