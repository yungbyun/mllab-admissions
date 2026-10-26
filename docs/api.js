// 백엔드 호출. APPS_SCRIPT_URL이 없으면 localStorage로 같은 동작을 흉내 냅니다(데모 모드).
const API = (() => {
  const url = window.APP_CONFIG.APPS_SCRIPT_URL;
  const demo = !url;
  const DEMO_KEY = 'gradapp-demo-rows';

  async function call(payload) {
    if (demo) return demoCall(payload);
    // text/plain 이면 CORS 사전 요청 없이 Apps Script로 보낼 수 있습니다.
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(DEMO_KEY)) || []; } catch { return []; }
  }
  function save(rows) {
    try { localStorage.setItem(DEMO_KEY, JSON.stringify(rows)); } catch { /* 저장 불가 환경 */ }
  }

  // ---------- 데모용 이메일 문의 (가상의 예시 데이터) ----------
  const MAIL_KEY = 'gradapp-demo-mails';
  const SAMPLES = [
    ['김서연', 'seoyeon.kim', '제주대학교', '컴퓨터공학과', '석사', '컴퓨터 비전', '석사 진학 관련하여 상담 요청드립니다', '학부 4학년이며 객체 탐지 프로젝트 경험이 있고, 2027년 봄 석사 입학과 연구실 면담을 희망함.'],
    ['이도윤', 'doyoon.lee', '한국외국어대학교', '언어인지과학과', '석사', '자연어 처리', '교수님 연구실 대학원 진학 문의', '언어학 전공으로 LLM 평가에 관심, 비전공 진학 가능 여부와 선수과목을 문의함.'],
    ['박지호', 'jiho.park', '부산대학교', '전자공학과', '박사', '로보틱스', 'PhD 과정 지원 관련 문의드립니다', '석사 졸업 예정이며 ROS 기반 자율주행 연구 경력, 박사과정 장학 지원 여부를 물음.'],
    ['Nguyen Van An', 'an.nguyen', 'Hanoi University of Science and Technology', 'Computer Science', '석사', '인공지능·머신러닝', 'Prospective master student — research interest in deep learning', '베트남 학부 졸업 예정, 정부초청장학생(GKS) 지원 예정이며 추천서와 연구계획 피드백을 요청함.'],
    ['최하은', 'haeun.choi', '제주대학교', '컴퓨터교육과', '석사', '교육공학', '학부연구생 및 대학원 진학 상담', '교육 데이터 분석에 관심, 3학년 2학기부터 학부연구생으로 참여 후 진학 희망.'],
    ['정우진', 'woojin.jung', '경북대학교', '컴퓨터학부', '석·박사 통합', '보안', '석박사 통합과정 문의', '보안 동아리 활동과 CTF 수상 경력, 통합과정 지원 절차와 연구실 TO를 문의함.'],
    ['한예린', 'yerin.han', '숙명여자대학교', '통계학과', '석사', '데이터 사이언스', '대학원 진학 희망 학생입니다', '통계 전공, 헬스케어 데이터 분석 연구를 희망하며 겨울방학 인턴 가능 여부를 물음.'],
    ['오준서', 'junseo.oh', '제주대학교', '컴퓨터공학과', '아직 미정', 'HCI', '연구실 인턴 가능할까요?', '2학년, 진학은 미정이나 연구 경험을 쌓고 싶어 방학 중 연구 인턴을 희망함.'],
  ];

  function loadMails() {
    try {
      const saved = JSON.parse(localStorage.getItem(MAIL_KEY));
      if (saved) return saved;
    } catch { /* 무시 */ }
    const now = Date.now();
    const mails = [];
    for (let i = 0; i < 26; i++) {
      const s = SAMPLES[i % SAMPLES.length];
      const daysAgo = Math.floor(((i * 37) % 340) + (i % 3) * 3);
      mails.push(sampleMail(s, i, new Date(now - daysAgo * 86400000)));
    }
    saveMails(mails);
    return mails;
  }
  function sampleMail(s, i, date) {
    const [name, user, school, major, program, interest, subject, summary] = s;
    return {
      id: 'demo' + i + '-' + date.getTime().toString(36),
      receivedAt: date.toISOString(),
      name: i >= SAMPLES.length ? `${name} (${Math.floor(i / SAMPLES.length) + 1})` : name,
      email: `${user}${i >= SAMPLES.length ? i : ''}@example.com`,
      subject,
      school,
      major,
      program,
      interests: interest,
      summary,
      excerpt: `교수님 안녕하십니까. ${school} ${major} ${name}입니다. ${summary} (데모용 예시 메일입니다.)`,
      method: i % 4 === 0 ? '키워드' : 'Claude',
      confidence: 60 + ((i * 13) % 40),
      replied: i % 3 === 0 ? '아니오' : '예',
      messageCount: 1 + (i % 4),
      status: ['신규', '연락함', '면담 예정', '지원 완료', '보류'][i % 5],
      memo: '',
    };
  }
  function saveMails(m) {
    try { localStorage.setItem(MAIL_KEY, JSON.stringify(m)); } catch { /* 저장 불가 환경 */ }
  }

  function demoMailCall({ action, id, fields }) {
    const mails = loadMails();
    if (action === 'inquiries') return { ok: true, rows: mails };
    if (action === 'scan') {
      const n = 1 + Math.floor(Math.random() * 2);
      for (let k = 0; k < n; k++) {
        const s = SAMPLES[Math.floor(Math.random() * SAMPLES.length)];
        const m = sampleMail(s, mails.length + 100, new Date());
        m.status = '신규';
        m.replied = '아니오';
        mails.push(m);
      }
      saveMails(mails);
      return { ok: true, checked: 12, added: n, refreshed: 1, remaining: 0 };
    }
    if (action === 'updateInquiry') {
      const m = mails.find(x => x.id === id);
      if (m) Object.assign(m, fields);
      saveMails(mails);
      return { ok: true };
    }
    if (action === 'deleteInquiry') {
      saveMails(mails.filter(x => x.id !== id));
      return { ok: true };
    }
    return null;
  }

  function demoCall(payload) {
    const mailResult = demoMailCall(payload);
    if (mailResult) return mailResult;
    const { action, data, id, fields } = payload;
    const rows = load();
    const now = new Date().toISOString();
    if (action === 'register') {
      if (data.website) return { ok: true };
      if (data.consent !== true) return { ok: false, error: '개인정보 수집·이용 동의가 필요합니다.' };
      const email = String(data.email).trim().toLowerCase();
      const record = { ...data, email, consent: '동의 (' + now.slice(0, 10) + ')', updatedAt: now };
      delete record.website;
      const i = rows.findIndex(r => r.email === email);
      if (i >= 0) {
        rows[i] = { ...rows[i], ...record };
      } else {
        rows.push({ id: Math.random().toString(16).slice(2, 10), createdAt: now, status: '신규', memo: '', ...record });
      }
      save(rows);
      return { ok: true, updated: i >= 0 };
    }
    if (action === 'list') return { ok: true, rows };
    if (action === 'update') {
      const r = rows.find(x => x.id === id);
      if (r) Object.assign(r, fields);
      save(rows);
      return { ok: true };
    }
    if (action === 'delete') {
      save(rows.filter(x => x.id !== id));
      return { ok: true };
    }
    return { ok: false, error: '알 수 없는 요청입니다.' };
  }

  return { call, demo };
})();
