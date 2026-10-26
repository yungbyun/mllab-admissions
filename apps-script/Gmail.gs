/**
 * 받은편지함 분석 — 나에게 온 메일 중 대학원 진학 희망 문의를 찾아 '이메일 문의' 시트에 정리합니다.
 *
 * - 메일은 읽기만 하고 수정·삭제·발송하지 않습니다.
 * - 스크립트 속성 CLAUDE_API_KEY가 있으면 Claude가 판별·요약하고, 없으면 키워드 규칙으로 판별합니다.
 * - setupScanTrigger를 한 번 실행하면 1시간마다 새 메일을 검사합니다.
 */

const INQUIRY_SHEET = '이메일 문의';
const SCANNED_SHEET = '_검사한 스레드';

// 검색 범위: 받은편지함, 최근 2년, 내가 보낸 메일·프로모션 제외, 진학 관련 단어 포함
const GMAIL_QUERY = 'in:inbox newer_than:2y -from:me -category:promotions -category:social ' +
  '(대학원 OR 석사 OR 박사 OR 진학 OR 입학 OR 연구실 OR 학부연구생 OR 컨택 OR 인턴 OR ' +
  'graduate OR master OR PhD OR "Ph.D" OR admission OR prospective OR "research intern")';
const MAX_THREADS_PER_SCAN = 200;  // 한 번에 훑어볼 스레드 수
const MAX_NEW_PER_SCAN = 40;       // 한 번에 새로 판별할 스레드 수 (Apps Script 6분 제한 대비)
const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';

const PROGRAMS = ['석사', '박사', '석·박사 통합', '아직 미정'];
// docs/config.js의 INTERESTS와 이름을 맞춥니다. 값은 키워드 판별에 쓰는 동의어입니다.
const INTEREST_KEYWORDS = {
  '인공지능·머신러닝': ['인공지능', '머신러닝', '딥러닝', 'AI', 'machine learning', 'deep learning', 'LLM', '강화학습'],
  '컴퓨터 비전': ['컴퓨터 비전', '비전', '영상처리', '이미지', 'computer vision', 'object detection', 'segmentation'],
  '자연어 처리': ['자연어', 'NLP', '언어 모델', 'language model', 'text mining'],
  '로보틱스': ['로봇', '로보틱스', 'robot', 'ROS', '드론', '자율주행'],
  '데이터 사이언스': ['데이터 분석', '데이터 사이언스', '빅데이터', 'data science', 'data analysis'],
  '보안': ['보안', '해킹', 'security', '암호'],
  '웹·모바일': ['웹', '앱 개발', '모바일', 'web', 'android', 'iOS', '프론트엔드', '백엔드'],
  'HCI': ['HCI', '사용자 경험', 'UX', '인터랙션', 'interaction'],
  '교육공학': ['교육공학', '에듀테크', 'edtech', '교육 데이터', '학습 분석'],
};

const INQ_COLUMNS = [
  ['ID', 'id'],
  ['수신일시', 'receivedAt'],
  ['이름', 'name'],
  ['이메일', 'email'],
  ['제목', 'subject'],
  ['소속 학교', 'school'],
  ['학과', 'major'],
  ['희망 과정', 'program'],
  ['관심 분야', 'interests'],
  ['요약', 'summary'],
  ['본문 일부', 'excerpt'],
  ['판별 방식', 'method'],
  ['신뢰도', 'confidence'],
  ['답장함', 'replied'],
  ['메일 수', 'messageCount'],
  ['상태', 'status'],
  ['메모', 'memo'],
];
const INQ_KEYS = INQ_COLUMNS.map(c => c[1]);

/** 받은편지함을 검사해 새 문의를 추가하고, 기존 문의의 답장 여부를 갱신합니다. */
function scanInbox() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) return { ok: false, error: '이미 검사가 진행 중입니다. 잠시 후 다시 시도해 주세요.' };
  try {
    const me = Session.getEffectiveUser().getEmail().toLowerCase();
    const sheet = getInquirySheet();
    const existing = {};
    const byEmail = {};
    readInquiries().forEach(r => { existing[r.id] = r; byEmail[String(r.email).toLowerCase()] = r; });
    const scannedSheet = getScannedSheet();
    const scanned = new Set(scannedSheet.getDataRange().getValues().map(r => String(r[0])));

    const threads = GmailApp.search(GMAIL_QUERY, 0, MAX_THREADS_PER_SCAN);
    let added = 0, checked = 0, refreshed = 0;
    const newlyScanned = [];

    for (const thread of threads) {
      const id = thread.getId();
      const messages = thread.getMessages();
      const replied = messages.some(m => fromAddress(m.getFrom()) === me) ? '예' : '아니오';

      if (existing[id]) {
        const row = existing[id];
        if (row.replied !== replied || Number(row.messageCount) !== messages.length) {
          sheet.getRange(row._row, INQ_KEYS.indexOf('replied') + 1, 1, 2).setValues([[replied, messages.length]]);
          refreshed++;
        }
        continue;
      }
      if (scanned.has(id) || checked >= MAX_NEW_PER_SCAN) continue;

      const first = messages.find(m => fromAddress(m.getFrom()) !== me);
      if (!first) continue;
      checked++;
      newlyScanned.push([id]);

      const mail = {
        from: first.getFrom(),
        subject: first.getSubject(),
        date: first.getDate(),
        body: first.getPlainBody().replace(/\n{3,}/g, '\n\n').slice(0, 6000),
      };
      // 같은 학생이 "Follow-up" 등으로 새 스레드를 보내면 새 행을 만들지 않고 기존 행에 합칩니다.
      const dup = byEmail[fromAddress(mail.from)];
      if (dup) {
        const count = Number(dup.messageCount || 0) + messages.length;
        const mergedReplied = dup.replied === '예' || replied === '예' ? '예' : '아니오';
        sheet.getRange(dup._row, INQ_KEYS.indexOf('replied') + 1, 1, 2).setValues([[mergedReplied, count]]);
        dup.messageCount = count;
        dup.replied = mergedReplied;
        refreshed++;
        continue;
      }

      const result = classifyMail(mail);
      if (!result.isProspective) continue;

      const row = {
        id,
        receivedAt: mail.date.toISOString(),
        name: result.name || fromName(mail.from),
        email: fromAddress(mail.from),
        subject: mail.subject,
        school: result.school,
        major: result.major,
        program: result.program,
        interests: result.interests.join(', '),
        summary: result.summary,
        excerpt: mail.body.slice(0, 500),
        method: result.method,
        confidence: result.confidence,
        replied,
        messageCount: messages.length,
        status: '신규',
        memo: '',
      };
      sheet.appendRow(INQ_KEYS.map(k => clean(row[k], k === 'excerpt' ? 600 : 500)));
      row._row = sheet.getLastRow();
      byEmail[row.email] = row;
      added++;
    }
    if (newlyScanned.length) {
      scannedSheet.getRange(scannedSheet.getLastRow() + 1, 1, newlyScanned.length, 1).setValues(newlyScanned);
    }
    const more = threads.filter(t => !existing[t.getId()] && !scanned.has(t.getId())).length - checked;
    return { ok: true, added, checked, refreshed, remaining: Math.max(0, more) };
  } finally {
    lock.releaseLock();
  }
}

function setupScanTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'scanInbox')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('scanInbox').timeBased().everyHours(1).create();
}

/** 판별 기준을 바꾼 뒤 처음부터 다시 검사하고 싶을 때 실행합니다(이미 찾은 문의는 유지). */
function resetScannedThreads() {
  const sheet = getScannedSheet();
  if (sheet.getLastRow() > 0) sheet.getRange(1, 1, sheet.getLastRow(), 1).clearContent();
}

// ---------- 판별 ----------

function classifyMail(mail) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('CLAUDE_API_KEY');
  if (apiKey) {
    try {
      const r = classifyWithClaude(mail, apiKey);
      if (r) return r;
    } catch (err) {
      console.warn('Claude 판별 실패, 키워드 판별로 대체: ' + err);
    }
  }
  return classifyWithKeywords(mail);
}

const CLAUDE_SCHEMA = {
  type: 'object',
  properties: {
    is_prospective_student: { type: 'boolean' },
    confidence: { type: 'integer' },
    name: { type: 'string' },
    school: { type: 'string' },
    major: { type: 'string' },
    program: { type: 'string', enum: PROGRAMS },
    interests: { type: 'array', items: { type: 'string', enum: Object.keys(INTEREST_KEYWORDS).concat(['기타']) } },
    summary: { type: 'string' },
  },
  required: ['is_prospective_student', 'confidence', 'name', 'school', 'major', 'program', 'interests', 'summary'],
  additionalProperties: false,
};

const CLAUDE_SYSTEM = [
  '당신은 대학 교수의 받은편지함을 정리하는 조수입니다.',
  '메일 한 통을 읽고, 보낸 사람이 이 교수의 연구실이나 대학원(석사·박사) 진학, 학부연구생, 연구 인턴을 희망하거나 문의하는 학생인지 판단합니다.',
  '수업 질문, 행정 안내, 학회·광고·뉴스레터, 동료 교수의 업무 메일, 이미 소속된 대학원생의 업무 보고는 진학 희망자가 아닙니다.',
  'confidence는 판단의 확신도(0~100)입니다.',
  '이름·학교·학과는 메일에 드러난 경우에만 적고, 없으면 빈 문자열로 둡니다. 추측하지 않습니다.',
  'program은 메일에 드러난 희망 과정이며, 알 수 없으면 "아직 미정"입니다.',
  'summary는 교수가 목록에서 훑어볼 한두 문장의 한국어 요약입니다(배경, 관심 연구, 요청 사항).',
].join('\n');

function classifyWithClaude(mail, apiKey) {
  const model = PropertiesService.getScriptProperties().getProperty('CLAUDE_MODEL') || DEFAULT_CLAUDE_MODEL;
  const content = [
    '보낸 사람: ' + mail.from,
    '받은 날짜: ' + mail.date.toISOString(),
    '제목: ' + mail.subject,
    '',
    '<email_body>',
    mail.body,
    '</email_body>',
  ].join('\n');

  const res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2026-10-21',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    payload: JSON.stringify({
      model,
      max_tokens: 4000,
      system: CLAUDE_SYSTEM,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: CLAUDE_SCHEMA } },
      fallbacks: 'default',
    }),
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('HTTP ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 300));
  }
  const data = JSON.parse(res.getContentText());
  if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') return null;
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const out = JSON.parse(text);
  return {
    isProspective: out.is_prospective_student && out.confidence >= 50,
    confidence: out.confidence,
    name: out.name,
    school: out.school,
    major: out.major,
    program: out.program,
    interests: out.interests,
    summary: out.summary,
    method: 'Claude',
  };
}

// 내 소속 대학. 메일 서명·본문에 자주 나오므로 지원자 학교로 잘못 뽑지 않도록 제외합니다.
const MY_UNIVERSITY = /제주대학교|제주대|Jeju National University|\bJNU\b/i;

// 영문 키워드는 단어 단위로 찾습니다. 끝에 *가 있으면 그 단어로 시작하는 말을 모두 찾습니다(opportunit* → opportunity/opportunities).
// 실제 받은편지함 표본(진학 문의 10통, 기타 8통)으로 맞춘 목록입니다.
const STRONG_WORDS = ['대학원 진학', '대학원에 진학', '대학원 입학', '석사 과정', '석사과정', '박사 과정', '박사과정',
  '석박사', '석·박사', '통합과정', '학부연구생', '학부 연구생', '연구실에 지원', '연구실 지원', '컨택', '랩 인턴',
  '연구 인턴', '진학을 희망', '진학 희망', '입학을 희망', '정부초청',
  'prospective', 'graduate program', 'graduate school', 'international graduate student',
  "master's degree", "master’s degree", 'masters degree', "master's student*", "master’s student*", 'masters student*',
  'ms student', 'msc student', 'ms applicant', 'ms position', 'ms supervision', "master's research", "master’s research",
  'phd position', 'ph.d. position', 'phd opportunit*', 'phd student*', 'phd application', 'phd research inquiry',
  'under your supervision', 'supervising my', 'supervise my', 'accepting master*', 'accepting phd', 'accepting any international',
  'join your lab', 'join your research group', 'join your team', 'research internship*', 'intern', 'internship',
  'gks', 'global korea scholarship', 'acceptance letter'];
const WEAK_WORDS = ['연구실', '교수님', '관심이 많', '관심이 있', '면담', '상담', '졸업 예정', '졸업예정',
  '학년', '포트폴리오', '이력서', 'cv', 'curriculum vitae', 'transcript*', 'your lab', "your lab's", 'your research group',
  'research interests', 'scholarship', 'funding', 'graduate'];
const NEGATIVE_WORDS = ['수신거부', 'unsubscribe', 'newsletter', '뉴스레터', '광고', '세미나 안내', 'call for papers',
  'special issue*', '심사', 'review request', 'recommendation letter*', 'recommender*', 'green card',
  'partnership', 'collaboration between', '청구서', 'invoice', '결제', '공문', '과제 제출', '출석', '수강',
  '성적 정정', '중간고사', '기말고사'];

function classifyWithKeywords(mail) {
  const text = (mail.subject + '\n' + mail.body).toLowerCase();
  const count = words => words.filter(w => hasWord(text, w)).length;
  const score = count(STRONG_WORDS) * 3 + count(WEAK_WORDS) - count(NEGATIVE_WORDS) * 4;

  const major = (mail.body.match(/([가-힣]{2,15}(?:학과|학부|전공))/) || [])[1] || '';
  // 제목에 과정이 드러나면 그것을 우선합니다(본문의 "M.S. and Ph.D. students 모집" 같은 문구에 휘둘리지 않도록).
  const program = detectProgram(mail.subject) || detectProgram(mail.body) || '아직 미정';
  const interests = Object.keys(INTEREST_KEYWORDS)
    .filter(k => INTEREST_KEYWORDS[k].some(w => hasWord(text, w)));

  return {
    isProspective: score >= 4,
    confidence: Math.max(0, Math.min(100, score * 12)),
    name: '',
    school: findSchool(mail.body),
    major,
    program,
    interests,
    summary: '',
    method: '키워드',
  };
}

/**
 * 영문 키워드는 단어 단위로만 찾습니다("prospective" 속 "ros", "international" 속 "intern" 같은 오탐 방지).
 * 끝에 *가 붙은 키워드는 그 말로 시작하는 단어를 모두 찾습니다. 한글 키워드는 부분 일치로 찾습니다.
 */
function hasWord(lowerText, word) {
  let w = word.toLowerCase();
  if (/[가-힣]/.test(w)) return lowerText.includes(w);
  const prefix = w.endsWith('*');
  if (prefix) w = w.slice(0, -1);
  const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('(^|[^a-z])' + escaped + (prefix ? '' : '($|[^a-z])')).test(lowerText);
}

function detectProgram(text) {
  if (/석\s*[·.]?\s*박사|통합\s*과정|integrated|masters?['’]?s?\s*(?:-|–|to|\/)\s*ph\.?\s?d|\bms[\s-]+ph\.?\s?d/i.test(text)) return '석·박사 통합';
  if (/박사|ph\.?\s?d/i.test(text)) return '박사';
  if (/석사|master|\bm\.?\s?sc?\b/i.test(text)) return '석사';
  return '';
}

/** 본문에서 지원자의 학교를 찾습니다. 내 소속 대학(MY_UNIVERSITY)은 건너뜁니다. */
function findSchool(body) {
  const STOP = /^(?:Could|From|At|The|I|My|In|And|Of|Currently|Dear)\s+/;
  const candidates = [];
  (body.match(/[가-힣]{2,15}(?:대학교|대학)/g) || []).forEach(s => candidates.push(s));
  (body.match(/(?:[A-Z][A-Za-z.\-'’]*\s){1,5}University(?:\s(?:of|and|[A-Z][A-Za-z\-]+)){0,5}/g) || [])
    .forEach(s => candidates.push(s.replace(/\s(?:of|and)$/, '')));
  (body.match(/University of(?:\s(?:and|[A-Z][A-Za-z\-]+)){1,5}/g) || []).forEach(s => candidates.push(s.replace(/\sand$/, '')));
  (body.match(/(?:[A-Z][A-Za-z.\-]*\s){1,4}Institute of(?:\s(?:and|[A-Z][A-Za-z\-]+)){1,4}/g) || []).forEach(s => candidates.push(s));
  const found = candidates
    .map(s => { let t = s.trim(); while (STOP.test(t)) t = t.replace(STOP, ''); return t; })
    .find(s => !MY_UNIVERSITY.test(s));
  return found || '';
}

// ---------- 시트 ----------

function getInquirySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INQUIRY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(INQUIRY_SHEET);
    sheet.appendRow(INQ_COLUMNS.map(c => c[0]));
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, INQ_COLUMNS.length).setFontWeight('bold');
  }
  return sheet;
}

function getScannedSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SCANNED_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SCANNED_SHEET);
    sheet.hideSheet();
  }
  return sheet;
}

function readInquiries() {
  const values = getInquirySheet().getDataRange().getValues();
  return values.slice(1).map((row, i) => {
    const obj = { _row: i + 2 };
    INQ_KEYS.forEach((k, j) => {
      const v = row[j];
      obj[k] = v instanceof Date ? v.toISOString() : v;
    });
    return obj;
  });
}

function updateInquiry(id, fields) {
  const target = readInquiries().find(r => r.id === id);
  if (!target) return { ok: false, error: '대상을 찾을 수 없습니다.' };
  const sheet = getInquirySheet();
  ['status', 'memo'].forEach(k => {
    if (k in fields) sheet.getRange(target._row, INQ_KEYS.indexOf(k) + 1).setValue(clean(fields[k], 1000));
  });
  return { ok: true };
}

function deleteInquiry(id) {
  const target = readInquiries().find(r => r.id === id);
  if (!target) return { ok: false, error: '대상을 찾을 수 없습니다.' };
  getInquirySheet().deleteRow(target._row);
  return { ok: true };
}

function fromAddress(from) {
  const m = String(from).match(/<([^>]+)>/);
  return (m ? m[1] : String(from)).trim().toLowerCase();
}

function fromName(from) {
  const m = String(from).match(/^\s*"?([^"<]*?)"?\s*</);
  return m && m[1] ? m[1].trim() : '';
}
