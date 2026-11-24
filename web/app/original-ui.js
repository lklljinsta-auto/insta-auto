export function mountConsole(root,manageUsers,select){
 const $=(q,within=root)=>within.querySelector(q);
 const escapeHtml=(v='')=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const state={accounts:[],contents:[],files:[]};
 let currentView='dashboard',editingAccountId=null,editingDraft=null,toastTimer,busy=false,ready=false;
 const controller=new AbortController(),signal=controller.signal;
 const kst=v=>v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'';
 const paths={dashboard:dashboardPage,accounts:accountsPage,compose:composePage,queue:queuePage,analytics:analyticsPage,settings:settingsPage};
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
    ['보관 파일', state.files.length, '개'],
    ['저장한 콘텐츠', state.contents.length, '개']
  ];
  return `${heading('운영 현황', '인스타오토', '운영 계정과 계정별 콘텐츠를 확인합니다.')}
    <section class="summary-grid" aria-label="현재 입력된 항목">${counts.map(([label, value, unit]) => `<article class="summary-card"><span>${label}</span><strong>${value}<small>${unit}</small></strong></article>`).join('')}</section>
    <section class="panel section-panel"><div class="panel-heading"><div><h2>먼저 할 일</h2><p>등록된 계정의 지침과 콘텐츠를 관리합니다.</p></div></div>
      <div class="action-grid">
        <button class="action-card" data-view="research"><span class="action-icon">⌕</span><strong>Instagram 계정 분석</strong><span>프로필이나 게시물 링크로 공개 정보와 지표를 바로 조회합니다.</span></button>
        <button class="action-card" data-view="accounts"><span class="action-icon">◎</span><strong>내 운영 계정 추가</strong><span>계정별 링크와 피드·릴스 지침을 따로 입력합니다.</span></button>
        <button class="action-card" data-view="compose"><span class="action-icon">＋</span><strong>콘텐츠 초안 작성</strong><span>실제 입력한 원본 링크와 계정별 지침으로 초안을 기록합니다.</span></button>
      </div>
    </section>
    ${infoBox('현재 기능 범위', '계정·초안·예정 시각·파일은 서버에 저장됩니다. Instagram 자동 게시, AI 생성, Google Drive는 미연결입니다.', 'warning')}`;
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
    const username = segments[0].toLowerCase().replace(/^@/, '');
    if (!/^[A-Za-z0-9._]{1,30}$/.test(username)) return null;
    return { input: value, profile: username, href: `https://www.instagram.com/${encodeURIComponent(username)}/`, kind: '프로필 링크' };
  }

  const username = value.toLowerCase().replace(/^@/, '');
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
    ${infoBox('현재는 설정 입력·저장만 가능합니다', '계정 지침은 운영 서버에 저장됩니다. Meta 게시 권한은 아직 연결되지 않았습니다. 계정 비밀번호·인증코드·API 키는 입력하지 마세요.', 'warning')}
    <section class="panel form-panel"><div class="panel-heading"><div><h2>${editing ? '계정 설정 수정' : '운영 계정 등록'}</h2><p>실제 사용할 계정 5개의 아이디를 하나씩 등록하세요.</p></div><span class="count-chip">${state.accounts.length}개</span></div><form id="account-form">${accountFields(editing || {})}</form></section>
    <section class="panel section-panel"><div class="panel-heading"><div><h2>등록된 계정</h2><p>작업공간에 저장한 운영 계정입니다.</p></div></div>${list}</section>`;
}

function composePage() {
  const options = state.accounts.map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name || `@${account.profile}`)} (@${escapeHtml(account.profile)})</option>`).join('');
  const noAccounts = state.accounts.length === 0;
  return `${heading('콘텐츠 작성', '실제 원본으로 콘텐츠 초안을 기록합니다.', '저장한 초안은 같은 작업공간에서 열 수 있습니다. 자동 생성이나 게시 요청은 실행하지 않습니다.')}
    ${noAccounts ? emptyState('운영 계정을 먼저 등록해 주세요', '계정별로 서로 다른 참고 링크와 프롬프트를 저장한 다음 초안을 작성할 수 있습니다.', button('내 운영 계정 등록', 'go-accounts')) : ''}
    ${infoBox('AI 생성·게시 연결 전', '원본 링크, 제목, 캡션과 게시 형식을 계정별 초안으로 저장할 수 있습니다. 게시 예정 시각과 파일을 저장할 수 있습니다. 자동 생성과 실제 게시는 미연결입니다.', 'warning')}
    <section class="panel form-panel"><form id="content-form">
      <div class="form-field"><label for="content-account">사용할 운영 계정</label><select id="content-account" class="large-input" name="accountId" ${noAccounts ? 'disabled' : ''} required><option value="">계정 선택</option>${options}</select></div>
      <div class="form-field"><label for="content-type">콘텐츠 형식</label><select id="content-type" class="large-input" name="type"><option value="feed">피드</option><option value="reels">릴스</option></select><span class="field-help">저장된 계정의 해당 형식 전용 프롬프트를 참고 지침으로 표시합니다.</span></div>
      <section class="guidance-box" id="account-guidance" aria-live="polite"><strong>계정별 제작 지침</strong><p>운영 계정을 선택하면 해당 계정의 참고 링크와 피드·릴스 지침이 여기에 표시됩니다.</p></section>
      <div class="form-field"><label for="content-source">이 계정에 사용할 원본 링크</label><input id="content-source" class="large-input" name="source" type="url" placeholder="https://..."></div>
      <div class="form-field"><label for="content-title">초안 제목</label><input id="content-title" class="large-input" name="title" maxlength="120" placeholder="직접 입력" required></div>
      <div class="form-field"><label for="content-caption">캡션 또는 제작 메모</label><textarea id="content-caption" class="large-input" name="caption" rows="6" placeholder="직접 입력"></textarea></div>
      <label for="draft-schedule">게시 예정 시각 (한국시간)</label><input class="large-input" id="draft-schedule" type="datetime-local" name="schedule"><div class="form-actions"><button class="btn btn-primary" type="submit" ${noAccounts ? 'disabled' : ''}>초안 저장</button></div>
    </form></section>`;
}

function queuePage() {
  const records = state.contents.length ? `<div class="record-list">${state.contents.map((item) => {
    const account = state.accounts.find((entry) => entry.id === item.accountId);
    return `<article class="record-card"><div class="record-main"><span class="record-type">${item.type === 'reels' ? '릴스' : '피드'} 초안 · ${escapeHtml(account?.name || (account ? `@${account.profile}` : '계정 삭제됨'))}</span><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.savedAt)}</span><p class="caption">${escapeHtml(item.caption)}</p>${item.schedule ? '<span>게시 예정 · '+escapeHtml(kst(item.schedule))+' · 게시 보류</span>' : ''}${filesMarkup(item.id)}${safeExternalLink(item.source) ? `<a href="${escapeHtml(item.source)}" target="_blank" rel="noopener noreferrer">원본 링크 열기 ↗</a>` : ''}</div><div class="record-actions"><span class="state-chip">서버 저장</span><button class="btn btn-small" data-action="edit-content" data-id="${escapeHtml(item.id)}">수정</button><button class="btn btn-small" data-action="remove-content" data-id="${escapeHtml(item.id)}">삭제</button></div></article>`;
  }).join('')}</div>` : emptyState('저장된 콘텐츠가 없습니다', '사용자가 작성한 초안만 여기에 표시됩니다.', button('콘텐츠 작성', 'go-compose'));
  return `${heading('콘텐츠 목록', '작성한 초안을 확인합니다.', '예약 실행이나 게시 완료로 표시되는 임의 데이터는 없습니다.')}
    ${infoBox('Instagram 게시 미연결', '예정 시각은 한국시간입니다. 실제 게시가 확인된 기록만 게시 완료로 표시합니다.', 'warning')}
    <section class="panel section-panel"><div class="panel-heading"><div><h2>저장된 초안</h2></div><span class="count-chip">${state.contents.length}개</span></div>${records}</section>`;
}

function analyticsPage() {
  return `${heading('성과 기록', '수집된 Instagram 성과만 표시합니다.', '아직 연결된 계정과 수집 데이터가 없으므로 성과 수치를 표시하지 않습니다.')}
    ${infoBox('성과 분석 API 미연결', '게시물 조회수·좋아요·댓글과 기간별 평균·중앙값을 계산하려면 실제 계정 권한과 지원되는 Meta 인사이트 API 연결이 필요합니다. 공개 타 계정 분석 지표는 확보 가능한 범위가 다를 수 있습니다.', 'warning')}
    ${emptyState('성과 데이터가 없습니다', '실제로 수집한 원본 기록이 생기면 그 값으로만 요약합니다.')}`;
}

function settingsPage() {
  const rows = [
    ['운영 서버', '연결됨', '운영 계정과 초안을 작업공간에 저장합니다.'],
    ['파일 보관', '서버 저장소', '콘텐츠 목록에서 피드·릴스 파일을 첨부하거나 내려받을 수 있습니다.'],
    ['Instagram·Meta API', '미연결', '자동 게시와 성과 수집은 보류됩니다.'],
    ['AI 제공자', '미연결', '생성 요청 전 공급자 설정이 필요합니다.'],
    ['Google Drive', '미연결', 'Drive 자동 보관은 아직 연결되지 않았습니다.']
  ];
  return `${heading('연동 상태', '현재 실제 연결 상태를 확인합니다.', '연결이 되지 않은 항목을 준비 완료로 표시하지 않습니다.')}
    <section class="panel section-panel"><div class="panel-heading"><div><h2>연동 현황</h2><p>실제 연결 여부만 표시합니다.</p></div></div><div class="integration-list">${rows.map(([label, status, detail]) => `<div class="integration-row"><strong>${label}</strong><span class="state-chip">${status}</span><p>${detail}</p></div>`).join('')}</div></section>`;
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

 function filesMarkup(id){
  const files=state.files.filter(f=>f.draft===id);
  return '<div>'+files.map(f=>'<p><a href="/api/files?id='+encodeURIComponent(f.id)+'">'+escapeHtml(f.name)+'</a></p>').join('')+
   '<label>제작 파일 첨부 <input type="file" data-upload="'+escapeHtml(id)+'"></label></div>';
 }
 async function request(url,options={}){
  const r=await fetch(url,{cache:'no-store',signal,...options});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||'저장 서버에 접근할 수 없습니다.');
  return d;
 }
 const save=b=>request('/api/console',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
 async function load(){
  const d=await request('/api/console');
  state.accounts=d.accounts.map(a=>{
   const g=JSON.parse(a.guide);
   return {id:a.id,profile:a.handle,name:a.alias,topic:g.topic,audience:g.audience,voice:g.voice,avoid:g.avoid,
    references:(g.sources||'').split('\n').filter(Boolean),feedPrompt:g.feed,reelsPrompt:g.reel};
  });
  state.contents=d.drafts.map(x=>({id:x.id,accountId:x.account,type:x.format==='reel'?'reels':'feed',source:x.source,
   title:x.title,caption:x.caption,schedule:x.schedule,savedAt:kst(x.updated)}));
  state.files=d.files;
  ready=true;
 }
 function render(){
  if(!ready||currentView==='admin'||currentView==='research')return;
  $('#view-root').innerHTML=paths[currentView]();
  if(currentView==='compose'){
   const f=$('#content-form');
   if(editingDraft){
    const d=editingDraft;
    Object.entries({accountId:d.accountId,type:d.type,source:d.source||'',title:d.title,caption:d.caption,
     schedule:d.schedule?new Date(Date.parse(d.schedule)+9*3600000).toISOString().slice(0,16):''})
     .forEach(([key,value])=>{f.elements.namedItem(key).value=value;});
    f.elements.accountId.disabled=true;
   }
   updateComposeGuidance();
  }
 }
 function go(view){
  if(!Object.hasOwn(paths,view)&&view!=='research'&&!(manageUsers&&view==='admin'))view='dashboard';
  currentView=view;if(view!=='compose')editingDraft=null;if(view!=='accounts')editingAccountId=null;
  select(view);history.replaceState(null,'','#'+view);render();window.scrollTo(0,0);
 }
 async function change(fn,done){
  if(busy)return;busy=true;
  try{await fn();await load();if(!signal.aborted)done();}
  catch(e){if(!signal.aborted)toast(e.message);}
  finally{busy=false;}
 }
 root.addEventListener('click',e=>{
  const nav=e.target.closest('[data-view]');
  if(nav){e.preventDefault();editingDraft=null;go(nav.dataset.view);return;}
  const el=e.target.closest('[data-action]');
  if(!el)return;
  const {action,id}=el.dataset;
  if(action==='go-accounts')go('accounts');
  if(action==='go-compose')go('compose');
  if(action==='edit-account'||action==='cancel-account-edit'){editingAccountId=action==='edit-account'?id:null;go('accounts');}
  if(action==='edit-content'){editingDraft=state.contents.find(x=>x.id===id);go('compose');}
  if(action.startsWith('remove-')&&window.confirm('선택한 항목을 삭제할까요?')){
   const kind=action==='remove-content'?'draft':action.slice(7);
   change(()=>save({type:'remove',kind,id}),()=>{editingAccountId=null;render();toast('삭제했습니다.');});
  }
  if(action==='retry-load')load().then(()=>go(currentView)).catch(e=>toast(e.message));
 },{signal});
 root.addEventListener('change',e=>{
  const el=e.target;
  if(el.id==='content-account'||el.id==='content-type')updateComposeGuidance();
  if(el.dataset.upload&&el.files?.length){
   const file=el.files[0];
   change(()=>request('/api/files?'+new URLSearchParams({draft:el.dataset.upload,name:file.name}),{method:'POST',body:file}),()=>{render();toast('파일을 저장했습니다.');});
  }
 },{signal});
 root.addEventListener('submit',e=>{
  const f=e.target;
  if(!['account-form','content-form'].includes(f.id))return;
  e.preventDefault();
  const b=Object.fromEntries(new FormData(f));
  if(f.id==='account-form'){
   const profile=parseInstagramTarget(b.profile,false);
   if(!profile?.profile){toast('Instagram 아이디 또는 프로필 주소를 확인하세요.');return;}
   const old=state.accounts.find(a=>a.id===b.id);
   change(()=>save({id:b.id,type:'account',handle:profile.profile,alias:b.name,topic:b.topic,audience:b.audience,
    voice:old?.voice||'',avoid:old?.avoid||'',feed:b.feedPrompt,reel:b.reelsPrompt,sources:b.references}),
    ()=>{editingAccountId=null;render();toast('운영 계정을 저장했습니다.');});
  }else{
   const source=safeExternalLink(b.source);
   if(source===null){toast('원본 주소를 확인하세요.');return;}
   change(()=>save({id:editingDraft?.id,type:'draft',account:editingDraft?.accountId||b.accountId,format:b.type==='reels'?'reel':'feed',
    source,title:b.title,caption:b.caption,schedule:b.schedule?new Date(b.schedule+':00+09:00').toISOString():null}),
    ()=>{go('queue');toast('콘텐츠를 저장했습니다.');});
  }
 },{signal});
 $('#view-root').textContent='운영 기록을 불러오는 중입니다.';
 const initial=location.hash.slice(1)||'dashboard';
 load().then(()=>{if(!signal.aborted)go(initial);}).catch(e=>{
  if(!signal.aborted)$('#view-root').innerHTML=infoBox('운영 기록 조회 실패',escapeHtml(e.message))+button('다시 불러오기','retry-load');
 });
 return ()=>{controller.abort();clearTimeout(toastTimer);};
}
