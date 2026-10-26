(() => {
  const C = window.APP_CONFIG;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tags = s => String(s || '').split(', ').filter(Boolean).map(t => `<span class="tag">${esc(t)}</span>`).join('');
  const day = s => String(s || '').slice(0, 10);
  let key = '';
  let rows = [];      // 등록 폼
  let mails = [];     // 이메일 문의
  let openId = null;

  $('labName').textContent = C.LAB_NAME;
  $('demoBanner').hidden = !API.demo;
  [['fProgram', C.PROGRAMS], ['fInterest', C.INTERESTS], ['fStatus', C.STATUSES],
    ['mProgram', C.PROGRAMS], ['mInterest', C.INTERESTS], ['mStatus', C.STATUSES]]
    .forEach(([id, items]) => $(id).insertAdjacentHTML('beforeend', items.map(v => `<option>${esc(v)}</option>`).join('')));

  // 관리자 키는 탭을 닫으면 사라지도록 sessionStorage에만 둡니다.
  try { key = sessionStorage.getItem('gradapp-admin-key') || ''; } catch { /* 무시 */ }
  if (key) load();

  $('loginForm').addEventListener('submit', e => {
    e.preventDefault();
    key = $('key').value;
    load();
  });
  $('reload').addEventListener('click', load);
  ['q', 'fProgram', 'fInterest', 'fStatus'].forEach(id => $(id).addEventListener('input', renderForm));
  ['mq', 'mProgram', 'mInterest', 'mStatus', 'mReplied'].forEach(id => $(id).addEventListener('input', renderMail));
  $('csv').addEventListener('click', () => exportCsv(FORM_CSV, filteredForm(), '등록폼'));
  $('mCsv').addEventListener('click', () => exportCsv(MAIL_CSV, filteredMail(), '이메일문의'));
  $('scan').addEventListener('click', scan);
  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    document.querySelectorAll('.tabs [data-tab]').forEach(t => t.setAttribute('aria-selected', t === b));
    $('tab-mail').hidden = b.dataset.tab !== 'mail';
    $('tab-form').hidden = b.dataset.tab !== 'form';
    openId = null;
    render();
  });

  async function load() {
    $('loginMsg').textContent = '';
    try {
      const [a, b] = await Promise.all([API.call({ action: 'inquiries', key }), API.call({ action: 'list', key })]);
      if (!a.ok) throw new Error(a.error);
      if (!b.ok) throw new Error(b.error);
      mails = a.rows.sort((x, y) => String(y.receivedAt).localeCompare(String(x.receivedAt)));
      rows = b.rows.sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
      try { sessionStorage.setItem('gradapp-admin-key', key); } catch { /* 무시 */ }
      $('login').hidden = true;
      $('main').hidden = false;
      render();
    } catch (err) {
      try { sessionStorage.removeItem('gradapp-admin-key'); } catch { /* 무시 */ }
      $('login').hidden = false;
      $('main').hidden = true;
      $('loginMsg').textContent = err.message || '불러오지 못했습니다.';
    }
  }

  async function scan() {
    const btn = $('scan'), msg = $('scanMsg');
    btn.disabled = true;
    btn.textContent = '검사 중…';
    msg.className = 'msg';
    msg.textContent = '받은편지함을 확인하고 있습니다. 메일이 많으면 1~2분 걸릴 수 있습니다.';
    try {
      const res = await API.call({ action: 'scan', key });
      if (!res.ok) throw new Error(res.error);
      msg.className = 'msg ok';
      msg.textContent = `새 메일 ${res.checked}건을 검사해 진학 문의 ${res.added}건을 찾았습니다.` +
        (res.refreshed ? ` 답장 여부 ${res.refreshed}건 갱신.` : '') +
        (res.remaining ? ` 아직 검사하지 않은 메일이 ${res.remaining}건 남아 있어 한 번 더 누르면 이어서 검사합니다.` : '');
      const a = await API.call({ action: 'inquiries', key });
      if (a.ok) mails = a.rows.sort((x, y) => String(y.receivedAt).localeCompare(String(x.receivedAt)));
      render();
    } catch (err) {
      msg.className = 'msg err';
      msg.textContent = err.message || '검사하지 못했습니다.';
    } finally {
      btn.disabled = false;
      btn.textContent = '지금 메일 검사';
    }
  }

  function render() {
    $('cntMail').textContent = mails.length;
    $('cntForm').textContent = rows.length;
    if (!$('tab-mail').hidden) renderMail(); else renderForm();
  }

  // ---------- 이메일 문의 ----------

  function filteredMail() {
    const q = $('mq').value.trim().toLowerCase();
    const p = $('mProgram').value, i = $('mInterest').value, s = $('mStatus').value, r = $('mReplied').value;
    return mails.filter(m =>
      (!p || m.program === p) &&
      (!i || String(m.interests).split(', ').includes(i)) &&
      (!s || m.status === s) &&
      (!r || m.replied === r) &&
      (!q || [m.name, m.email, m.school, m.major, m.subject, m.summary].join(' ').toLowerCase().includes(q)));
  }

  function renderMail() {
    const registered = new Set(rows.map(r => String(r.email).toLowerCase()));
    const thisMonth = new Date().toISOString().slice(0, 7);
    const stats = [
      ['전체 문의', mails.length],
      ['답장 안 함', mails.filter(m => m.replied !== '예').length, true],
      ['이번 달', mails.filter(m => String(m.receivedAt).startsWith(thisMonth)).length],
      ['신규 (미처리)', mails.filter(m => m.status === '신규').length],
      ['폼에도 등록', mails.filter(m => registered.has(String(m.email).toLowerCase())).length],
    ];
    $('mailStats').innerHTML = stats.map(([label, n, alert]) =>
      `<div class="stat${alert && n ? ' alert' : ''}"><b>${n}</b><span>${esc(label)}</span></div>`).join('');

    renderMonthChart();
    renderInterestChart();

    const list = filteredMail();
    $('mailRows').innerHTML = list.length ? list.map(m => `
      <tr class="row" data-id="${esc(m.id)}">
        <td>${esc(day(m.receivedAt))}</td>
        <td><b>${esc(m.name) || '(이름 없음)'}</b>${registered.has(String(m.email).toLowerCase()) ? '<span class="badge">폼 등록</span>' : ''}<br><small>${esc(m.email)}</small></td>
        <td><div class="subj">${esc(m.subject)}</div><div class="summ">${esc(m.summary || String(m.excerpt || '').slice(0, 90))}</div></td>
        <td>${esc(m.school)}<br><small>${esc(m.major)}</small></td>
        <td>${esc(m.program)}</td>
        <td>${tags(m.interests)}</td>
        <td>${m.replied === '예' ? '답장함' : '<span class="badge no">미답장</span>'}</td>
        <td><select data-kind="mail" data-status="${esc(m.id)}">${statusOptions(m.status)}</select></td>
      </tr>
      ${m.id === openId ? mailDetail(m) : ''}`).join('')
      : `<tr><td colspan="8" class="empty">${mails.length ? '조건에 맞는 문의가 없습니다.' : '아직 찾은 문의가 없습니다. "지금 메일 검사"를 눌러 보세요.'}</td></tr>`;
  }

  function mailDetail(m) {
    const gmail = `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(m.id)}`;
    return `<tr class="detail"><td colspan="8"><dl class="detail-grid">
      <div><dt>이메일</dt><dd><a href="mailto:${esc(m.email)}">${esc(m.email)}</a></dd></div>
      <div><dt>판별</dt><dd>${esc(m.method)} · 신뢰도 ${esc(m.confidence)} · 메일 ${esc(m.messageCount)}통</dd></div>
      ${m.summary ? `<div class="full"><dt>요약</dt><dd>${esc(m.summary)}</dd></div>` : ''}
      <div class="full"><dt>본문 일부</dt><dd>${esc(m.excerpt)}</dd></div>
      <div class="full"><dt>메모 (관리자만 보임)</dt><dd><textarea data-kind="mail" data-memo="${esc(m.id)}" style="min-height:70px">${esc(m.memo)}</textarea></dd></div>
      <div><a href="${gmail}" target="_blank" rel="noopener">Gmail에서 열기 ↗</a></div>
      <div style="text-align:right"><button class="danger" data-kind="mail" data-delete="${esc(m.id)}">목록에서 삭제</button></div>
    </dl></td></tr>`;
  }

  function renderMonthChart() {
    const months = [];
    const d = new Date();
    d.setDate(1);
    for (let i = 11; i >= 0; i--) {
      const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
      months.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
    }
    const counts = months.map(mo => mails.filter(m => String(m.receivedAt).startsWith(mo)).length);
    const max = Math.max(1, ...counts);
    const peak = counts.indexOf(Math.max(...counts));
    $('chartMonth').innerHTML = counts.map((n, i) => `
      <div class="col" data-tip="${months[i]} · ${n}건">
        <div class="bar" style="height:${(n / max) * 100}%">${i === peak && n ? `<span class="val">${n}</span>` : ''}</div>
      </div>`).join('');
    let labels = $('chartMonth').nextElementSibling;
    if (!labels || !labels.classList.contains('bar-labels')) {
      labels = document.createElement('div');
      labels.className = 'bar-labels';
      $('chartMonth').after(labels);
    }
    labels.innerHTML = months.map((mo, i) => `<span>${i % 2 === 1 ? '' : Number(mo.slice(5)) + '월'}</span>`).join('');
  }

  function renderInterestChart() {
    const counts = C.INTERESTS.map(name => [name, mails.filter(m => String(m.interests).split(', ').includes(name)).length])
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...counts.map(c => c[1]));
    $('chartInterest').innerHTML = counts.length ? counts.map(([name, n]) => `
      <div class="hrow" data-tip="${esc(name)} · ${n}건">
        <span>${esc(name)}</span>
        <div class="track"><div class="fill" style="width:${(n / max) * 100}%"></div></div>
        <span class="n">${n}</span>
      </div>`).join('') : '<div class="empty">데이터가 없습니다.</div>';
  }

  // ---------- 등록 폼 ----------

  function filteredForm() {
    const q = $('q').value.trim().toLowerCase();
    const p = $('fProgram').value, i = $('fInterest').value, s = $('fStatus').value;
    return rows.filter(r =>
      (!p || r.program === p) &&
      (!i || String(r.interests).split(', ').includes(i)) &&
      (!s || r.status === s) &&
      (!q || [r.name, r.email, r.school, r.major, r.intro, r.github].join(' ').toLowerCase().includes(q)));
  }

  function renderForm() {
    const count = st => rows.filter(r => r.status === st).length;
    $('formStats').innerHTML = [['전체', rows.length], ...C.STATUSES.map(st => [st, count(st)])]
      .map(([label, n]) => `<div class="stat"><b>${n}</b><span>${esc(label)}</span></div>`).join('');

    const list = filteredForm();
    $('rows').innerHTML = list.length ? list.map(r => `
      <tr class="row" data-id="${esc(r.id)}">
        <td>${esc(day(r.createdAt))}</td>
        <td><b>${esc(r.name)}</b></td>
        <td>${esc(r.school)}<br><small>${esc(r.major)}</small></td>
        <td>${esc(r.standing)}</td>
        <td>${esc(r.program)}</td>
        <td>${esc(r.term)}</td>
        <td>${tags(r.interests)}</td>
        <td>${r.github ? `<a href="https://github.com/${encodeURIComponent(r.github)}" target="_blank" rel="noopener">${esc(r.github)}</a>` : ''}</td>
        <td><select data-kind="form" data-status="${esc(r.id)}">${statusOptions(r.status)}</select></td>
      </tr>
      ${r.id === openId ? formDetail(r) : ''}`).join('')
      : '<tr><td colspan="9" class="empty">조건에 맞는 학생이 없습니다.</td></tr>';
  }

  function formDetail(r) {
    const portfolio = /^https?:\/\//.test(r.portfolio || '')
      ? `<a href="${esc(r.portfolio)}" target="_blank" rel="noopener">${esc(r.portfolio)}</a>` : esc(r.portfolio);
    return `<tr class="detail"><td colspan="9"><dl class="detail-grid">
      <div><dt>이메일</dt><dd><a href="mailto:${esc(r.email)}">${esc(r.email)}</a></dd></div>
      <div><dt>연락처</dt><dd>${esc(r.phone) || '-'}</dd></div>
      <div><dt>GitHub 공개 프로필 요약</dt><dd>${r.github ? `저장소 ${esc(r.githubRepos) || '?'}개 · ${esc(r.githubLangs) || '언어 정보 없음'}` : '-'}</dd></div>
      <div><dt>포트폴리오</dt><dd>${portfolio || '-'}</dd></div>
      <div class="full"><dt>자기소개</dt><dd>${esc(r.intro)}</dd></div>
      <div class="full"><dt>메모 (관리자만 보임)</dt><dd><textarea data-kind="form" data-memo="${esc(r.id)}" style="min-height:70px">${esc(r.memo)}</textarea></dd></div>
      <div><dt>동의 · 최종 수정</dt><dd>${esc(r.consent)} · ${esc(day(r.updatedAt))}</dd></div>
      <div style="text-align:right"><button class="danger" data-kind="form" data-delete="${esc(r.id)}">삭제 (학생 요청 시)</button></div>
    </dl></td></tr>`;
  }

  // ---------- 공통 동작 ----------

  function statusOptions(current) {
    return C.STATUSES.map(st => `<option${st === current ? ' selected' : ''}>${esc(st)}</option>`).join('');
  }

  const ACTIONS = {
    mail: { list: () => mails, set: v => { mails = v; }, update: 'updateInquiry', del: 'deleteInquiry', label: r => r.name || r.email },
    form: { list: () => rows, set: v => { rows = v; }, update: 'update', del: 'delete', label: r => r.name },
  };

  document.querySelectorAll('tbody').forEach(tb => {
    tb.addEventListener('click', async e => {
      const del = e.target.closest('[data-delete]');
      if (del) {
        const A = ACTIONS[del.dataset.kind];
        const r = A.list().find(x => x.id === del.dataset.delete);
        if (!confirm(`${A.label(r)} 항목을 삭제할까요? 되돌릴 수 없습니다.`)) return;
        const res = await API.call({ action: A.del, key, id: r.id });
        if (!res.ok) return alert(res.error);
        A.set(A.list().filter(x => x.id !== r.id));
        return render();
      }
      if (e.target.closest('select, textarea, a, button')) return;
      const tr = e.target.closest('tr.row');
      if (!tr) return;
      openId = openId === tr.dataset.id ? null : tr.dataset.id;
      render();
    });

    tb.addEventListener('change', async e => {
      const el = e.target;
      const id = el.dataset.status || el.dataset.memo;
      if (!id) return;
      const A = ACTIONS[el.dataset.kind];
      const field = el.dataset.status ? 'status' : 'memo';
      const res = await API.call({ action: A.update, key, id, fields: { [field]: el.value } });
      if (!res.ok) return alert(res.error);
      A.list().find(x => x.id === id)[field] = el.value;
      if (field === 'status') render();
    });
  });

  // 차트 툴팁
  const tip = $('tip');
  document.addEventListener('mousemove', e => {
    const t = e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    tip.style.left = Math.min(e.clientX + 12, innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = (e.clientY - 32) + 'px';
  });

  const MAIL_CSV = [['받은 날', 'receivedAt'], ['이름', 'name'], ['이메일', 'email'], ['제목', 'subject'],
    ['학교', 'school'], ['학과', 'major'], ['희망 과정', 'program'], ['관심 분야', 'interests'], ['요약', 'summary'],
    ['답장', 'replied'], ['판별', 'method'], ['신뢰도', 'confidence'], ['상태', 'status'], ['메모', 'memo']];
  const FORM_CSV = [['접수일시', 'createdAt'], ['이름', 'name'], ['이메일', 'email'], ['연락처', 'phone'],
    ['학교', 'school'], ['학과', 'major'], ['현재 상태', 'standing'], ['희망 과정', 'program'],
    ['입학 시기', 'term'], ['관심 분야', 'interests'], ['GitHub', 'github'], ['저장소 수', 'githubRepos'],
    ['주요 언어', 'githubLangs'], ['포트폴리오', 'portfolio'], ['자기소개', 'intro'], ['상태', 'status'], ['메모', 'memo']];

  function exportCsv(cols, list, name) {
    const cell = v => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = "'" + s;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = [cols.map(c => cell(c[0])).join(','), ...list.map(r => cols.map(c => cell(r[c[1]])).join(','))].join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${name}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
})();
