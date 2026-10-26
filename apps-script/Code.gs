/**
 * 대학원 진학 희망자 등록 — Google Apps Script 백엔드
 *
 * 1) Google 스프레드시트를 새로 만들고 [확장 프로그램] → [Apps Script]를 엽니다.
 * 2) 이 파일 내용을 Code.gs에 붙여 넣습니다.
 * 3) [프로젝트 설정] → [스크립트 속성]에 ADMIN_KEY(관리자 비밀번호)를 추가합니다.
 * 4) [배포] → [새 배포] → 유형 "웹 앱", 실행 계정 "나", 액세스 "모든 사용자"로 배포합니다.
 * 5) 발급된 웹 앱 URL을 docs/config.js의 APPS_SCRIPT_URL에 넣습니다.
 * 6) (권장) 편집기에서 setupRetentionTrigger를 한 번 실행해 보유기간 자동 파기를 켭니다.
 *
 * 받은편지함 분석은 Gmail.gs에 있습니다. 두 파일을 같은 Apps Script 프로젝트에 넣으세요.
 */

const SHEET_NAME = '지원자';
const RETENTION_DAYS = 365; // 개인정보 보유기간 — 동의서 문구와 맞춰야 합니다.

// [시트 열 제목, 데이터 키]
const COLUMNS = [
  ['ID', 'id'],
  ['접수일시', 'createdAt'],
  ['수정일시', 'updatedAt'],
  ['이름', 'name'],
  ['이메일', 'email'],
  ['연락처', 'phone'],
  ['소속 학교', 'school'],
  ['학과', 'major'],
  ['현재 상태', 'standing'],
  ['희망 과정', 'program'],
  ['희망 입학 시기', 'term'],
  ['관심 분야', 'interests'],
  ['GitHub ID', 'github'],
  ['GitHub 공개 저장소', 'githubRepos'],
  ['GitHub 주요 언어', 'githubLangs'],
  ['포트폴리오 URL', 'portfolio'],
  ['자기소개', 'intro'],
  ['개인정보 동의', 'consent'],
  ['상태', 'status'],
  ['메모', 'memo'],
];
const KEYS = COLUMNS.map(c => c[1]);
const STUDENT_FIELDS = ['name', 'email', 'phone', 'school', 'major', 'standing', 'program',
  'term', 'interests', 'github', 'githubRepos', 'githubLangs', 'portfolio', 'intro'];

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: '잘못된 요청입니다.' });
  }
  // 메일 검사는 수십 초 걸릴 수 있어 등록 요청을 막지 않도록 별도 잠금(Gmail.gs)을 씁니다.
  if (body.action === 'scan') return json(requireAdmin(body.key, scanInbox));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    switch (body.action) {
      case 'register': return json(register(body.data || {}));
      case 'list': return json(requireAdmin(body.key, () => ({ ok: true, rows: readAll() })));
      case 'update': return json(requireAdmin(body.key, () => updateAdminFields(body.id, body.fields || {})));
      case 'delete': return json(requireAdmin(body.key, () => deleteById(body.id)));
      case 'inquiries': return json(requireAdmin(body.key, () => ({ ok: true, rows: readInquiries() })));
      case 'updateInquiry': return json(requireAdmin(body.key, () => updateInquiry(body.id, body.fields || {})));
      case 'deleteInquiry': return json(requireAdmin(body.key, () => deleteInquiry(body.id)));
      default: return json({ ok: false, error: '알 수 없는 요청입니다.' });
    }
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return json({ ok: true, message: '대학원 진학 희망자 등록 API가 동작 중입니다.' });
}

function register(data) {
  if (data.website) return { ok: true }; // 허니팟: 봇은 조용히 무시
  if (data.consent !== true) return { ok: false, error: '개인정보 수집·이용 동의가 필요합니다.' };
  const name = clean(data.name, 50);
  const email = clean(data.email, 120).toLowerCase();
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: '이름과 올바른 이메일을 입력해 주세요.' };
  }

  const sheet = getSheet();
  const rows = readAll();
  const existing = rows.find(r => String(r.email).toLowerCase() === email);
  const now = new Date().toISOString();
  const record = {};
  STUDENT_FIELDS.forEach(k => { record[k] = clean(data[k], k === 'intro' ? 2000 : 300); });
  record.email = email;
  record.consent = '동의 (' + now.slice(0, 10) + ')';

  if (existing) {
    // 같은 이메일로 다시 등록하면 기존 정보를 갱신합니다(관리자 상태·메모는 유지).
    const merged = Object.assign({}, existing, record, { updatedAt: now });
    sheet.getRange(existing._row, 1, 1, KEYS.length).setValues([KEYS.map(k => merged[k] ?? '')]);
    return { ok: true, updated: true };
  }
  const row = Object.assign({}, record, {
    id: Utilities.getUuid().slice(0, 8),
    createdAt: now,
    updatedAt: now,
    status: '신규',
    memo: '',
  });
  sheet.appendRow(KEYS.map(k => row[k] ?? ''));
  return { ok: true, updated: false };
}

function updateAdminFields(id, fields) {
  const target = readAll().find(r => r.id === id);
  if (!target) return { ok: false, error: '대상을 찾을 수 없습니다.' };
  const sheet = getSheet();
  ['status', 'memo'].forEach(k => {
    if (k in fields) sheet.getRange(target._row, KEYS.indexOf(k) + 1).setValue(clean(fields[k], 1000));
  });
  return { ok: true };
}

function deleteById(id) {
  const target = readAll().find(r => r.id === id);
  if (!target) return { ok: false, error: '대상을 찾을 수 없습니다.' };
  getSheet().deleteRow(target._row);
  return { ok: true };
}

/** 보유기간이 지난 행을 파기합니다. setupRetentionTrigger로 매일 자동 실행됩니다. */
function purgeExpired() {
  const sheet = getSheet();
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 3600 * 1000;
  readAll()
    .filter(r => new Date(r.updatedAt || r.createdAt).getTime() < cutoff)
    .map(r => r._row)
    .sort((a, b) => b - a)
    .forEach(rowNum => sheet.deleteRow(rowNum));
}

function setupRetentionTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'purgeExpired')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('purgeExpired').timeBased().everyDays(1).atHour(3).create();
}

// ---------- helpers ----------

function requireAdmin(key, fn) {
  const adminKey = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!adminKey) return { ok: false, error: '스크립트 속성에 ADMIN_KEY가 설정되지 않았습니다.' };
  if (key !== adminKey) return { ok: false, error: '관리자 키가 올바르지 않습니다.' };
  return fn();
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(COLUMNS.map(c => c[0]));
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
  }
  return sheet;
}

function readAll() {
  const values = getSheet().getDataRange().getValues();
  return values.slice(1).map((row, i) => {
    const obj = { _row: i + 2 };
    KEYS.forEach((k, j) => {
      const v = row[j];
      obj[k] = v instanceof Date ? v.toISOString() : v;
    });
    return obj;
  });
}

function clean(v, max) {
  let s = String(v ?? '').trim().slice(0, max);
  // 스프레드시트 수식 주입 방지
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
