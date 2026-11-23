const STORAGE_KEY = 'instaauto-browser-workspace-v1';
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const viewNames = {
  dashboard: '요약', research: 'Instagram 계정 분석', accounts: '내 운영 계정',
  compose: '콘텐츠 작성', queue: '콘텐츠 목록', analytics: '성과 기록', settings: '연동 상태'
};
const freshState = () => ({ accounts: [], research: [], contents: [] });
let state = loadState();
let currentView = 'dashboard';
let editingAccountId = null;
let toastTimer;

function loadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
      research: Array.isArray(parsed.research) ? parsed.research : [],
      contents: Array.isArray(parsed.contents) ? parsed.contents : []
    };
  } catch {
    return freshState();
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    toast('브라우저 저장 공간에 기록하지 못했습니다. 입력 내용을 복사해 보관해 주세요.');
    return false;
  }
}

function toast(message) {
  const node = $('#toast-root');
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), 3600);
}

function button(label, action, primary = false, extra = '') {
  return `<button class="btn ${primary ? 'btn-primary' : ''}" data-action="${action}" ${extra}>${label}</button>`;
}

function heading(title, description, actions = '') {
  return `<div class="page-heading"><div><p class="eyebrow">인스타오토</p><h1>${title}</h1><p class="page-description">${description}</p></div>${actions ? `<div class="heading-actions">${actions}</div>` : ''}</div>`;
}

function infoBox(title, text, kind = 'notice') {
  return `<div class="info-box ${kind}"><strong>${title}</strong><p>${text}</p></div>`;
}

function emptyState(title, detail, action = '') {
  return `<div class="empty-state"><span class="empty-mark" aria-hidden="true">＋</span><h2>${title}</h2><p>${detail}</p>${action}</div>`;
}

function dashboardPage() {
  const counts = [
    ['내 운영 계정', state.accounts.length, '개'],
    ['분석 대상', state.research.length, '개'],
    ['저장한 콘텐츠', state.contents.length, '개']
  ];
  return `${heading('운영 현황', '인스타오토', '실제 입력한 내용만 표시합니다. 아직 연결된 Instagram 계정이나 수집된 통계는 없습니다.')}
    ${infoBox('사이트 공개 안내', '현재 GitHub Pages 주소는 공개되어 있습니다. 이 사이트에 입력하는 내용은 GitHub에 올라가지 않고 현재 브라우저의 로컬 저장소에만 저장됩니다. 민감한 정보나 비밀번호, API 키는 입력하지 마세요.', 'warning')}
    <section class="summary-grid" aria-label="현재 입력된 항목">${counts.map(([label, value, unit]) => `<article class="summary-card"><span>${label}</span><strong>${value}<small>${unit}</small></strong></article>`).join('')}</section>
    <section class="panel section-panel"><div class="panel-heading"><div><h2>먼저 할 일</h2><p>입력 목록은 이 브라우저 안에서만 유지됩니다.</p></div></div>
      <div class="action-grid">
        <button class="action-card" data-view="research"><span class="action-icon">⌕</span><strong>Instagram 계정 분석</strong><span>여러 프로필 주소나 아이디를 입력해 분석 대상으로 관리합니다.</span></button>
        <button class="action-card" data-view="accounts"><span class="action-icon">◎</span><strong>내 운영 계정 추가</strong><span>계정별 링크와 피드·릴스 지침을 따로 입력합니다.</span></button>
        <button class="action-card" data-view="compose"><span class="action-icon">＋</span><strong>콘텐츠 초안 작성</strong><span>실제 입력한 원본 링크와 계정별 지침으로 초안을 기록합니다.</span></button>
      </div>
    </section>
    ${infoBox('현재 기능 범위', 'Instagram 공식 API, 서버 저장, 자동 분석, AI 생성, 예약 게시, 실제 게시, Drive 연동은 아직 연결되지 않았습니다. 통계와 계정 상태를 임의로 채우지 않습니다.', 'warning')}`;
}

function parseInstagramTarget(raw, allowMedia = true) {
  const value = raw.trim();
  if (!value) return null;
  let url;
  if (/^https?:\/\//i.test(value)) {
    try { url = new URL(value); } catch { return null; }
  } else if (/^(www\.)?instagram\.com\//i.test(value)) {
    try { url = new URL(`https://${value}`); } catch { return null; }
  }

  if (url) {
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    if (!segments.length) return null;
    const reserved = new Set(['p', 'reel', 'reels', 'tv', 'stories', 'explore', 'accounts', 'direct', 'about']);
    const first = segments[0].toLowerCase();
    if (reserved.has(first)) {
      if (!allowMedia || !['p', 'reel', 'reels', 'tv'].includes(first)) return null;
      return { input: value, profile: null, href: `https://www.instagram.com${url.pathname}`, kind: '게시물 링크' };
    }
    const username = segments[0].replace(/^@/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return null;
    return { input: value, profile: username, href: `https://www.instagram.com/${encodeURIComponent(username)}/`, kind: '프로필 링크' };
  }

  const username = value.replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return null;
  return { input: value, profile: username, href: `https://www.instagram.com/${encodeURIComponent(username)}/`, kind: '아이디' };
}

function safeExternalLink(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function researchPage() {
  const list = state.research.length ? `<div class="record-list">${state.research.map((item) => `
    <article class="record-card">
      <div class="record-main"><span class="record-type">${escapeHtml(item.kind)}</span><strong>${escapeHtml(item.profile ? `@${item.profile}` : item.input)}</strong><a href="${escapeHtml(item.href)}" target="_blank" rel="noopener noreferrer">Instagram에서 열기 ↗</a></div>
      <div class="record-state"><span class="state-chip">통계 미수집</span><span>수집 기능 미연결</span></div>
      <button class="btn btn-small" data-action="remove-research" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.input)} 삭제">삭제</button>
    </article>`).join('')}</div>` : emptyState('등록된 분석 대상이 없습니다', 'Instagram 프로필 주소나 아이디를 입력하면 여기에 저장됩니다. 아직 통계 수집 API가 연결되지 않아 실제 수치는 표시할 수 없습니다.');
  return `${heading('Instagram 계정 분석', '여러 계정을 한 번에 등록하고 관리합니다.', '계정 유형을 먼저 선택할 필요 없이 프로필 링크, 게시물 링크 또는 아이디를 입력할 수 있습니다.')}
    ${infoBox('통계 수집은 아직 연결되지 않았습니다', '이 페이지는 입력 목록만 이 브라우저에 저장합니다. Instagram의 공식 API 또는 허용된 공개 데이터 수집 경로가 연결되기 전에는 게시 빈도, 조회수, 좋아요, 댓글, 평균·중앙값을 가져오지 않으며 임의의 분석 결과도 만들지 않습니다. 로그인 세션을 이용한 무단 수집은 하지 않습니다.', 'warning')}
    <section class="panel form-panel"><form id="research-form">
      <label for="research-input">분석할 Instagram 주소 또는 아이디</label>
      <textarea id="research-input" class="large-input" rows="5" placeholder="한 줄에 하나씩 입력\nhttps://www.instagram.com/계정아이디/\n@계정아이디" required></textarea>
      <p class="field-help">여러 개를 줄바꿈이나 쉼표로 구분해 입력할 수 있습니다. 비즈니스·크리에이터 여부를 요구하지 않습니다.</p>
      <div class="form-actions"><button class="btn btn-primary" type="submit">분석 대상 목록에 등록</button></div>
    </form></section>
    <section class="panel section-panel"><div class="panel-heading"><div><h2>분석 대상</h2><p>실제 수집이 완료된 지표만 추후 여기에 표시합니다.</p></div><span class="count-chip">${state.research.length}개</span></div>${list}</section>`;
}

function accountFields(account = {}) {
  return `<input type="hidden" name="id" value="${escapeHtml(account.id || '')}">
    <div class="form-grid">
      <div class="form-field"><label for="account-link">Instagram 계정 아이디 또는 프로필 링크</label><input id="account-link" class="large-input" name="profile" value="${escapeHtml(account.profile || '')}" placeholder="@계정아이디 또는 프로필 주소" required></div>
      <div class="form-field"><label for="account-name">내부에서 부를 이름</label><input id="account-name" class="large-input" name="name" value="${escapeHtml(account.name || '')}" placeholder="선택 입력"></div>
      <div class="form-field"><label for="account-topic">주제·프로필 지침</label><textarea class="large-input" name="topic" rows="3" placeholder="이 계정에서 다룰 주제">${escapeHtml(account.topic || '')}</textarea></div>
      <div class="form-field"><label for="account-audience">대상 독자와 말투</label><textarea class="large-input" name="audience" rows="3" placeholder="대상 독자, 어조, 표현 방식">${escapeHtml(account.audience || '')}</textarea></div>
      <div class="form-field full-width"><label>이 계정 전용 참고 링크</label><textarea class="large-input" name="references" rows="3" placeholder="이 계정 콘텐츠에 참고할 뉴스 또는 Instagram 주소를 한 줄에 하나씩">${escapeHtml((account.references || []).join('\n'))}</textarea><p class="field-help">여기에 입력한 링크는 다른 계정에 복사되지 않습니다.</p></div>
      <div class="form-field full-width"><label>피드 전용 프롬프트</label><textarea class="large-input" name="feedPrompt" rows="3" placeholder="피드 이미지·카드 콘텐츠 생성 지침">${escapeHtml(account.feedPrompt || '')}</textarea></div>
      <div class="form-field full-width"><label>릴스 전용 프롬프트</label><textarea class="large-input" name="reelsPrompt" rows="3" placeholder="릴스 영상·내레이션 콘텐츠 생성 지침">${escapeHtml(account.reelsPrompt || '')}</textarea></div>
    </div>
    <div class="form-actions"><button class="btn btn-primary" type="submit">${account.id ? '계정 설정 저장' : '운영 계정 등록'}</button>${account.id ? '<button class="btn" type="button" data-action="cancel-account-edit">새 계정 입력</button>' : ''}</div>`;
}

function accountsPage() {
  const list = state.accounts.length ? `<div class="record-list">${state.accounts.map((account) => `<article class="record-card account-record"><div class="record-main"><span class="record-type">내 운영 계정</span><strong>${escapeHtml(account.name || `@${account.profile}`)}</strong><span class="plain-handle">@${escapeHtml(account.profile)}</span><span class="status-text">Meta 계정 연결 안 됨 · 게시 기능 꺼짐</span></div><div class="record-actions"><button class="btn btn-small" data-action="edit-account" data-id="${escapeHtml(account.id)}">수정</button><button class="btn btn-small" data-action="remove-account" data-id="${escapeHtml(account.id)}">삭제</button></div></article>`).join('')}</div>` : emptyState('운영 계정이 없습니다', '계정 아이디를 직접 등록하세요. 비밀번호나 로그인 코드는 여기에 입력하지 마세요.');
  const editing = state.accounts.find((account) => account.id === editingAccountId);
  return `${heading('내 운영 계정', '계정별 프로필과 지침을 관리합니다.', '한 계정의 원본 링크와 피드·릴스 프롬프트는 해당 계정에만 저장됩니다.')}
    ${infoBox('현재는 설정 입력·저장만 가능합니다', '등록 정보는 이 브라우저에만 저장됩니다. Meta 로그인, 게시 권한, 서버 저장은 아직 연결되지 않았습니다. 계정 비밀번호·인증코드·API 키는 입력하지 마세요.', 'warning')}
    <section class="panel form-panel"><div class="panel-heading"><div><h2>${editing ? '계정 설정 수정' : '운영 계정 등록'}</h2><p>최대 100개까지 계정 프로필을 준비할 수 있습니다. 이 화면에서 실제 Instagram 연결은 이루어지지 않습니다.</p></div><span class="count-chip">${state.accounts.length} / 100</span></div><form id="account-form">${accountFields(editing || {})}</form></section>
    <section class="panel section-panel"><div class="panel-heading"><div><h2>등록된 계정</h2><p>이 브라우저에 저장한 계정만 나열합니다.</p></div></div>${list}</section>`;
}

function composePage() {
  const options = state.accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name || `@${account.profile}`)} (@${escapeHtml(account.profile)})</option>`).join('');
  const noAccounts = state.accounts.length === 0;
  return `${heading('콘텐츠 작성', '실제 원본으로 콘텐츠 초안을 기록합니다.', '저장한 초안은 현재 브라우저 안에서만 보관됩니다. 자동 생성이나 게시 요청은 실행하지 않습니다.')}
    ${noAccounts ? emptyState('운영 계정을 먼저 등록해 주세요', '계정별로 서로 다른 참고 링크와 프롬프트를 저장한 다음 초안을 작성할 수 있습니다.', button('내 운영 계정 등록', 'go-accounts')) : ''}
    ${infoBox('AI 생성·게시 연결 전', '원본 링크, 제목, 캡션과 게시 형식을 로컬 초안으로 저장할 수 있습니다. 실제 이미지·영상·음악 생성, 예약, Instagram 게시 기능은 연결되지 않았습니다.', 'warning')}
    <section class="panel form-panel"><form id="content-form">
      <div class="form-field"><label for="content-account">사용할 운영 계정</label><select id="content-account" class="large-input" name="accountId" ${noAccounts ? 'disabled' : ''} required><option value="">계정 선택</option>${options}</select></div>
      <div class="form-field"><label for="content-type">콘텐츠 형식</label><select id="content-type" class="large-input" name="type"><option value="feed">피드</option><option value="reels">릴스</option></select><span class="field-help">저장된 계정의 해당 형식 전용 프롬프트를 참고 지침으로 표시합니다.</span></div>
      <section class="guidance-box" id="account-guidance" aria-live="polite"><strong>계정별 제작 지침</strong><p>운영 계정을 선택하면 해당 계정의 참고 링크와 피드·릴스 지침이 여기에 표시됩니다.</p></section>
      <div class="form-field"><label for="content-source">이 계정에 사용할 원본 링크</label><input id="content-source" class="large-input" name="source" type="url" placeholder="https://..."></div>
      <div class="form-field"><label for="content-title">초안 제목</label><input id="content-title" class="large-input" name="title" maxlength="120" placeholder="직접 입력" required></div>
      <div class="form-field"><label for="content-caption">캡션 또는 제작 메모</label><textarea id="content-caption" class="large-input" name="caption" rows="6" placeholder="직접 입력"></textarea></div>
      <div class="form-actions"><button class="btn btn-primary" type="submit" ${noAccounts ? 'disabled' : ''}>초안 저장</button></div>
    </form></section>`;
}

function queuePage() {
  const records = state.contents.length ? `<div class="record-list">${state.contents.map((item) => {
    const account = state.accounts.find((entry) => entry.id === item.accountId);
    return `<article class="record-card"><div class="record-main"><span class="record-type">${item.type === 'reels' ? '릴스' : '피드'} 초안 · ${escapeHtml(account?.name || (account ? `@${account.profile}` : '계정 삭제됨'))}</span><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.savedAt)}</span>${item.source ? `<a href="${escapeHtml(item.source)}" target="_blank" rel="noopener noreferrer">원본 링크 열기 ↗</a>` : ''}</div><div class="record-actions"><span class="state-chip">브라우저 저장</span><button class="btn btn-small" data-action="remove-content" data-id="${escapeHtml(item.id)}">삭제</button></div></article>`;
  }).join('')}</div>` : emptyState('저장된 콘텐츠가 없습니다', '사용자가 작성한 초안만 여기에 표시됩니다.', button('콘텐츠 작성', 'go-compose'));
  return `${heading('콘텐츠 목록', '작성한 초안을 확인합니다.', '예약 실행이나 게시 완료로 표시되는 임의 데이터는 없습니다.')}
    ${infoBox('예약 실행은 아직 사용할 수 없습니다', 'GitHub Pages는 정적 웹 호스팅이라 사이트를 닫은 뒤에도 실행되는 예약 작업이나 서버 저장을 제공하지 않습니다. 지금은 초안 저장만 지원합니다.', 'warning')}
    <section class="panel section-panel"><div class="panel-heading"><div><h2>저장된 초안</h2></div><span class="count-chip">${state.contents.length}개</span></div>${records}</section>`;
}

function analyticsPage() {
  return `${heading('성과 기록', '수집된 Instagram 성과만 표시합니다.', '아직 연결된 계정과 수집 데이터가 없으므로 성과 수치를 표시하지 않습니다.')}
    ${infoBox('성과 분석 API 미연결', '게시물 조회수·좋아요·댓글과 기간별 평균·중앙값을 계산하려면 실제 계정 권한과 지원되는 Meta 인사이트 API 연결이 필요합니다. 공개 타 계정 분석 지표는 확보 가능한 범위가 다를 수 있습니다.', 'warning')}
    ${emptyState('성과 데이터가 없습니다', '실제로 수집한 원본 기록이 생기면 그 값으로만 요약합니다.')}`;
}

function settingsPage() {
  const rows = [
    ['호스팅', 'GitHub Pages', '사이트는 공개 상태입니다.'],
    ['GitHub 저장소', '공개 저장소', '코드와 설정 파일은 누구나 볼 수 있습니다.'],
    ['서버·데이터베이스', '연결 안 됨', '계정 정보는 이 브라우저에만 저장됩니다.'],
    ['Instagram·Meta API', '연결 안 됨', '계정 조회·게시·인사이트 수집은 비활성입니다.'],
    ['AI 제공자', '연결 안 됨', '이미지·영상·음악·문구 생성은 실행되지 않습니다.'],
    ['Google Drive', '연결 안 됨', '파일 업로드와 보관은 아직 사용할 수 없습니다.'],
    ['국내 고정 IP·예약 실행 서버', '연결 안 됨', '게시 작업을 실행할 서버가 없습니다.']
  ];
  return `${heading('연동 상태', '현재 실제 연결 상태를 확인합니다.', '연결이 되지 않은 항목을 준비 완료로 표시하지 않습니다.')}
    ${infoBox('공개 사이트 주의', '현재 사이트와 저장소가 공개되어 있습니다. 입력 목록과 초안은 이 브라우저의 로컬 저장소에만 기록되지만, 누구나 코드와 화면을 볼 수 있습니다. 비밀번호, 토큰, API 키 또는 민감한 개인 정보를 입력하지 마세요.', 'warning')}
    <section class="panel section-panel"><div class="panel-heading"><div><h2>연동 현황</h2><p>실제 연결 여부만 표시합니다.</p></div></div><div class="integration-list">${rows.map(([label, status, detail]) => `<div class="integration-row"><strong>${label}</strong><span class="state-chip">${status}</span><p>${detail}</p></div>`).join('')}</div></section>`;
}

function render() {
  const pages = { dashboard: dashboardPage, research: researchPage, accounts: accountsPage, compose: composePage, queue: queuePage, analytics: analyticsPage, settings: settingsPage };
  $('#view-root').innerHTML = (pages[currentView] || dashboardPage)();
  $('#crumb-current').textContent = viewNames[currentView] || viewNames.dashboard;
  $$('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === currentView));
  if (currentView === 'compose') {
    $('#content-account')?.addEventListener('change', updateComposeGuidance);
    $('#content-type')?.addEventListener('change', updateComposeGuidance);
    updateComposeGuidance();
  }
}

function updateComposeGuidance() {
  const panel = $('#account-guidance');
  const accountId = $('#content-account')?.value;
  const type = $('#content-type')?.value || 'feed';
  if (!panel) return;
  const account = state.accounts.find((entry) => entry.id === accountId);
  if (!account) {
    panel.innerHTML = '<strong>계정별 제작 지침</strong><p>운영 계정을 선택하면 해당 계정의 참고 링크와 피드·릴스 지침이 여기에 표시됩니다.</p>';
    return;
  }
  const promptLabel = type === 'reels' ? '릴스 프롬프트' : '피드 프롬프트';
  const prompt = type === 'reels' ? account.reelsPrompt : account.feedPrompt;
  const references = (account.references || []).map((reference) => {
    const href = safeExternalLink(reference);
    return href
      ? `<li><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reference)}</a></li>`
      : `<li>${escapeHtml(reference)}</li>`;
  }).join('');
  panel.innerHTML = `<strong>${escapeHtml(account.name || `@${account.profile}`)} · 계정 전용 지침</strong>
    <p><b>주제</b> ${escapeHtml(account.topic || '저장된 주제 없음')}</p>
    <p><b>대상 독자·말투</b> ${escapeHtml(account.audience || '저장된 설명 없음')}</p>
    <p><b>${promptLabel}</b> ${escapeHtml(prompt || '이 형식의 프롬프트가 아직 입력되지 않았습니다.')}</p>
    <div class="guidance-references"><b>계정 전용 참고 링크</b>${references ? `<ul>${references}</ul>` : '<p>등록된 참고 링크가 없습니다.</p>'}</div>`;
}

function go(view) {
  currentView = view;
  if (view !== 'accounts') editingAccountId = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function handleAccountSubmit(form) {
  const data = new FormData(form);
  const parsed = parseInstagramTarget(String(data.get('profile') || ''), false);
  if (!parsed?.profile) {
    toast('Instagram 프로필 주소 또는 계정 아이디를 확인해 주세요.');
    return;
  }
  const existingId = String(data.get('id') || '');
  const duplicate = state.accounts.find((entry) => entry.profile.toLowerCase() === parsed.profile.toLowerCase() && entry.id !== existingId);
  if (duplicate) {
    toast('이 Instagram 아이디는 이미 등록되어 있습니다.');
    return;
  }
  if (!existingId && state.accounts.length >= 100) {
    toast('운영 계정은 최대 100개까지 등록할 수 있습니다.');
    return;
  }
  const account = {
    id: existingId || crypto.randomUUID(),
    profile: parsed.profile,
    profileUrl: parsed.href,
    name: String(data.get('name') || '').trim(),
    topic: String(data.get('topic') || '').trim(),
    audience: String(data.get('audience') || '').trim(),
    references: String(data.get('references') || '').split(/\n+/).map((line) => line.trim()).filter(Boolean),
    feedPrompt: String(data.get('feedPrompt') || '').trim(),
    reelsPrompt: String(data.get('reelsPrompt') || '').trim(),
    savedAt: new Date().toISOString()
  };
  if (existingId) state.accounts = state.accounts.map((entry) => entry.id === existingId ? account : entry);
  else state.accounts.push(account);
  persist();
  editingAccountId = null;
  render();
  toast('입력한 계정 설정을 이 브라우저에 저장했습니다. Instagram 연결은 아직 되지 않았습니다.');
}

function handleResearchSubmit(form) {
  const value = $('#research-input').value;
  const pieces = value.split(/[\n,]+/).map((part) => part.trim()).filter(Boolean);
  const valid = pieces.map((piece) => parseInstagramTarget(piece, true)).filter(Boolean);
  const invalidCount = pieces.length - valid.length;
  if (!valid.length) {
    toast('Instagram 프로필 주소, 게시물 주소 또는 아이디를 확인해 주세요.');
    return;
  }
  let added = 0;
  for (const item of valid) {
    const key = item.profile ? `profile:${item.profile.toLowerCase()}` : `url:${item.href.toLowerCase()}`;
    const exists = state.research.some((record) => record.key === key);
    if (exists) continue;
    state.research.unshift({
      id: crypto.randomUUID(), key, input: item.input, profile: item.profile,
      href: item.href, kind: item.kind, addedAt: new Date().toISOString(), status: 'not-collected'
    });
    added += 1;
  }
  persist();
  render();
  toast(`${added}개 분석 대상을 브라우저에 저장했습니다.${invalidCount ? ` 형식 확인 필요 ${invalidCount}개는 제외했습니다.` : ''} 실제 통계 수집은 API 연결 전까지 되지 않습니다.`);
}

document.addEventListener('click', (event) => {
  const nav = event.target.closest('[data-view]');
  if (nav) { go(nav.dataset.view); return; }
  const action = event.target.closest('[data-action]');
  if (!action) return;
  const id = action.dataset.id;
  if (action.dataset.action === 'go-accounts') go('accounts');
  else if (action.dataset.action === 'go-compose') go('compose');
  else if (action.dataset.action === 'edit-account') { editingAccountId = id; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  else if (action.dataset.action === 'cancel-account-edit') { editingAccountId = null; render(); }
  else if (action.dataset.action === 'remove-account') {
    const account = state.accounts.find((entry) => entry.id === id);
    if (!account || !window.confirm(`${account.name || `@${account.profile}`} 계정 설정을 이 브라우저에서 삭제할까요?`)) return;
    state.accounts = state.accounts.filter((entry) => entry.id !== id);
    persist(); render(); toast('브라우저에 저장된 계정 설정을 삭제했습니다.');
  } else if (action.dataset.action === 'remove-research') {
    state.research = state.research.filter((entry) => entry.id !== id);
    persist(); render(); toast('분석 대상 목록에서 삭제했습니다.');
  } else if (action.dataset.action === 'remove-content') {
    state.contents = state.contents.filter((entry) => entry.id !== id);
    persist(); render(); toast('저장된 초안을 삭제했습니다.');
  }
});

document.addEventListener('submit', (event) => {
  if (event.target.id === 'account-form') {
    event.preventDefault();
    handleAccountSubmit(event.target);
  } else if (event.target.id === 'research-form') {
    event.preventDefault();
    handleResearchSubmit(event.target);
  } else if (event.target.id === 'content-form') {
    event.preventDefault();
    const data = new FormData(event.target);
    if (!data.get('accountId')) { toast('운영 계정을 먼저 등록해 주세요.'); return; }
    const source = safeExternalLink(data.get('source'));
    if (source === null) { toast('원본 링크는 http 또는 https 주소만 사용할 수 있습니다.'); return; }
    state.contents.unshift({
      id: crypto.randomUUID(), accountId: String(data.get('accountId')),
      type: String(data.get('type') || 'feed'), source,
      title: String(data.get('title') || '').trim(), caption: String(data.get('caption') || '').trim(),
      savedAt: new Date().toLocaleString('ko-KR')
    });
    persist(); go('queue'); toast('콘텐츠 초안을 이 브라우저에 저장했습니다. 예약·게시되지 않았습니다.');
  }
});

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    go('compose');
  }
});

render();
