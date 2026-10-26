(() => {
  const C = window.APP_CONFIG;
  const $ = id => document.getElementById(id);
  const form = $('form');
  let github = { repos: '', langs: '' };

  $('labName').textContent = C.LAB_NAME;
  $('retention').textContent = C.RETENTION_TEXT;
  $('contact').textContent = C.CONTACT_EMAIL;
  $('demoBanner').hidden = !API.demo;
  fillSelect($('program'), C.PROGRAMS);
  fillSelect($('term'), C.TERMS);
  $('interests').innerHTML = C.INTERESTS
    .map(v => `<label><input type="checkbox" value="${v}">${v}</label>`).join('');

  function fillSelect(el, items) {
    el.innerHTML = '<option value="">선택</option>' + items.map(v => `<option>${v}</option>`).join('');
  }

  // GitHub 공개 프로필 요약 — 학생 본인이 입력한 아이디만 조회합니다.
  $('github').addEventListener('change', async e => {
    const id = e.target.value.trim().replace(/^@/, '').replace(/^https?:\/\/github\.com\//, '').split('/')[0];
    e.target.value = id;
    const box = $('ghPreview');
    github = { repos: '', langs: '' };
    box.classList.remove('show');
    if (!/^[a-zA-Z0-9-]{1,39}$/.test(id)) return;
    try {
      const [user, repos] = await Promise.all([
        fetch(`https://api.github.com/users/${id}`).then(r => r.ok ? r.json() : null),
        fetch(`https://api.github.com/users/${id}/repos?per_page=100&sort=pushed`).then(r => r.ok ? r.json() : []),
      ]);
      if (!user) {
        box.textContent = 'GitHub에서 해당 아이디를 찾지 못했습니다.';
        box.classList.add('show');
        return;
      }
      const counts = {};
      repos.filter(r => !r.fork && r.language).forEach(r => { counts[r.language] = (counts[r.language] || 0) + 1; });
      const langs = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([l]) => l);
      github = { repos: String(user.public_repos), langs: langs.join(', ') };
      box.innerHTML = '';
      const img = document.createElement('img');
      img.src = user.avatar_url;
      img.alt = '';
      const txt = document.createElement('div');
      txt.innerHTML = `<b></b><br><span></span>`;
      txt.querySelector('b').textContent = user.name || user.login;
      txt.querySelector('span').textContent = `공개 저장소 ${user.public_repos}개` + (langs.length ? ` · ${langs.join(', ')}` : '');
      box.append(img, txt);
      box.classList.add('show');
    } catch {
      // 조회 실패해도 등록은 가능합니다.
    }
  });

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('msg');
    msg.className = 'msg';
    msg.textContent = '';

    const interests = [...$('interests').querySelectorAll('input:checked')].map(i => i.value);
    const invalid = [...form.querySelectorAll('[required]')].find(el => !el.checkValidity());
    if (invalid) return fail(`"${invalid.closest('div').querySelector('label').firstChild.textContent.trim()}" 항목을 확인해 주세요.`, invalid);
    if (!interests.length) return fail('관심 연구 분야를 하나 이상 선택해 주세요.');
    if (!$('portfolio').checkValidity()) return fail('포트폴리오 URL 형식을 확인해 주세요.', $('portfolio'));
    if (!$('consent').checked) return fail('개인정보 수집·이용에 동의해야 등록할 수 있습니다.', $('consent'));

    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    Object.assign(data, {
      interests: interests.join(', '),
      githubRepos: data.github ? github.repos : '',
      githubLangs: data.github ? github.langs : '',
      consent: true,
    });

    const btn = $('submit');
    btn.disabled = true;
    btn.textContent = '등록 중…';
    try {
      const res = await API.call({ action: 'register', data });
      if (!res.ok) return fail(res.error || '등록에 실패했습니다.');
      form.hidden = true;
      $('done').hidden = false;
      if (res.updated) $('doneText').textContent = '같은 이메일로 등록된 정보를 최신 내용으로 갱신했습니다. 감사합니다.';
      window.scrollTo({ top: 0 });
    } catch {
      fail('네트워크 오류로 등록하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      btn.disabled = false;
      btn.textContent = '등록하기';
    }

    function fail(text, el) {
      msg.className = 'msg err';
      msg.textContent = text;
      if (el) el.focus();
    }
  });
})();
