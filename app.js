const $=(s,r=document)=>r.querySelector(s),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nav=[['dashboard','관제 홈'],['accounts','운영 계정'],['content','콘텐츠·예약'],['analysis','외부 계정 분석'],['history','성과·실행 기록'],['settings','설정·연동']];let csrf='',view='dashboard',groups=[],accounts=[],accountPage=1,pendingImport=null;
function toast(s){const e=$('#toast-root');e.textContent=s;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),3500)}
async function api(path,opt={}){const headers={'Content-Type':'application/json',...(opt.headers||{})};if(csrf&&opt.method&&opt.method!=='GET')headers['X-CSRF-Token']=csrf;const r=await fetch('/api'+path,{credentials:'include',...opt,headers});if(r.status===401)showLogin();if(r.status===204)return null;let j={};try{j=await r.json()}catch{}if(!r.ok)throw Error(j.error||`HTTP ${r.status}`);return j}
function showLogin(){csrf='';$('#app').innerHTML=`<main class="auth-wrap"><form id="login-form" class="panel auth-card"><img src="./instaauto-mark.svg" alt="" width="56"><h1>인스타오토 관리자 로그인</h1><p>인증된 관리자만 운영 데이터에 접근할 수 있습니다.</p><label for="email">이메일</label><input autocomplete="username" id="email" class="large-input" type="email" required><label for="password">비밀번호</label><input autocomplete="current-password" id="password" class="large-input" type="password" required><button class="btn btn-primary">로그인</button><p id="login-error" role="alert"></p></form></main>`}
async function login(e){e.preventDefault();const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({email:$('#email').value,password:$('#password').value})});const j=await r.json();if(!r.ok){$('#login-error').textContent='로그인 정보를 확인해 주세요.';return}csrf=j.csrfToken;await shell()}
function shell(){ $('#app').innerHTML=`<div class="app-shell"><aside class="sidebar"><a class="brand-row" href="#dashboard"><img class="brand-mark" src="./instaauto-mark.svg"><span class="brand-copy"><strong>인스타오토</strong><small>개인 운영 콘솔</small></span></a><div class="nav-caption">운영 메뉴</div><nav class="primary-nav">${nav.map(([id,n])=>`<button class="nav-item" data-view="${id}">${n}</button>`).join('')}</nav><div class="sidebar-note"><strong>개발 환경</strong><span>데이터는 PostgreSQL에 저장됩니다.</span></div></aside><main class="main-area"><header class="topbar"><div class="breadcrumb"><strong>인스타오토</strong><span>/</span><span id="crumb"></span></div><button class="btn btn-small" id="logout">로그아웃</button></header><section id="root" class="view-root"></section></main></div>`;render()}
const heading=(t,d)=>`<div class="page-heading"><div><p class="eyebrow">인스타오토 운영</p><h1>${t}</h1><p class="page-description">${d}</p></div></div>`;
function frame(title,desc,body){return heading(title,desc)+body}
async function render(){const root=$('#root');if(!root)return;$('#crumb').textContent=nav.find(x=>x[0]===view)?.[1]||'';$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===view));root.innerHTML='<div class="panel section-panel">불러오는 중…</div>';try{if(view==='dashboard'){const d=await api('/dashboard');root.innerHTML=frame('관제 홈','문제 계정과 대기 작업을 먼저 확인합니다.',`<section class="summary-grid">${[['운영 계정',d.stats.accounts],['대기·실행 작업',d.stats.jobs],['문제 작업',d.stats.problems]].map(x=>`<article class="summary-card"><span>${x[0]}</span><strong>${x[1]}<small>건</small></strong></article>`).join('')}</section><div class="panel section-panel"><h2>즉시 조치가 필요한 계정</h2>${d.issues.length?d.issues.map(x=>`<p><b>@${esc(x.profile_handle||'내부 ID')}</b> · ${esc(x.connection_status)} ${esc(x.hold_reason||'')}</p>`).join(''):'<p>현재 확인된 문제 계정이 없습니다.</p>'}</div><div class="panel section-panel"><h2>서버 상태</h2><p>워커: ${d.workers.length?'응답 확인':'미응답'} · 대기 작업 ${d.stats.jobs} · 긴급 정지 ${d.control?.emergency_paused?'켜짐':'꺼짐'}</p><button class="btn ${d.control?.emergency_paused?'':'btn-primary'}" data-action="pause" data-paused="${!d.control?.emergency_paused}">${d.control?.emergency_paused?'운영 재개':'긴급 일시정지'}</button></div><div class="panel section-panel"><h2>예약·보류·실패 작업</h2>${d.scheduled.map(x=>`<p>@${esc(x.profile_handle)} · ${esc(x.status)} · ${esc(x.hold_reason||'예약 대기')}</p>`).join('')||'<p>작업이 없습니다.</p>'}</div>`)}else if(view==='accounts'){pendingImport=null;const [a,g]=await Promise.all([api('/accounts?pageSize=50&page='+accountPage),api('/groups')]);accounts=a.accounts;groups=g.groups;root.innerHTML=frame('운영 계정','계정을 내부 ID로 먼저 등록하고, OAuth 연결은 나중에 계정별로 지정합니다.',`<div class="panel form-panel"><h2>CSV / XLSX 일괄 등록</h2><input id="import-file" type="file" accept=".csv,.xlsx"><button class="btn" data-action="preview-import">가져오기 미리보기</button><div id="import-preview"></div><p><a href="/api/accounts/template.csv">CSV 서식 내려받기</a></p></div><div class="panel form-panel"><h2>운영 계정 등록</h2><form id="account-form"><div class="form-grid"><div><label>Instagram 아이디 (선택)</label><input name="username" class="large-input" placeholder="@계정아이디 또는 비워 두기"></div><div><label>내부 표시 이름</label><input name="displayName" class="large-input" placeholder="내부 식별용 이름"></div><div><label>운영 그룹</label><select name="groupId" class="large-input"><option value="">그룹 없음</option>${groups.map(x=>`<option value="${x.id}">${esc(x.name)} (${x.account_count}/${x.target_size??'목표 없음'})</option>`).join('')}</select></div><div><label>계정별 로그인 IP 메모(선택)</label><input name="loginManagementIpNote" class="large-input"></div></div><button class="btn btn-primary">내부 운영 계정 만들기</button></form></div><div class="panel section-panel"><h2>그룹 추가</h2><form id="group-form"><input name="name" class="large-input" placeholder="그룹 이름" required><input name="targetSize" type="number" min="0" class="large-input" placeholder="목표 계정 수(선택)"><button class="btn">그룹 저장</button></form></div><div class="panel section-panel"><h2>운영 계정 목록 (${a.total})</h2>${a.accounts.map(x=>`<article class="record-card"><div class="record-main"><b>${esc(x.display_name||'운영 계정')} ${x.profile_handle?'@'+esc(x.profile_handle):'(Meta 연결 전)'}</b><span>${esc(x.group_name||'그룹 없음')} · ${esc(x.connection_status)} · ${esc(x.automation_mode)}</span><small>내부 ID: ${x.id}</small>${x.drive_folder_id?driveLink(x.drive_folder_id,'계정 폴더 열기',true):''}<button type="button" class="btn" data-action="edit-account" data-id="${x.id}">설정 수정</button> <button class="btn" type="button" data-action="edit-insights" data-id="${x.id}">성과 수집 설정</button><div data-insight-editor></div>${x.automation_mode==='review'?`<button type="button" class="btn" data-action="toggle-reviewed" data-on="${!x.publishing_enabled}" data-id="${x.id}">${x.publishing_enabled?'승인 게시 끄기':'승인 게시 켜기'}</button>`:''}<button class="btn" type="button" data-action="edit-editorial" data-id="${x.id}">원본·제작 지침</button><div data-editorial></div></div></article>`).join('')||'<p>등록된 운영 계정이 없습니다.</p>'}<div><button class="btn" data-action="prev-page" ${accountPage<=1?'disabled':''}>이전</button> ${accountPage} / ${Math.max(1,Math.ceil(a.total/a.pageSize))} <button class="btn" data-action="next-page" ${accountPage*a.pageSize>=a.total?'disabled':''}>다음</button></div></div>`)}else if(view==='content'){const [a,c,j,archive]=await Promise.all([allAccounts(),api('/contents'),api('/jobs'),api('/archive/files')]);accounts=a.accounts;root.innerHTML=frame('콘텐츠·예약','콘텐츠를 만들고 계정별 파일 보관 상태를 확인합니다.',`<div class="panel form-panel"><h2>콘텐츠 버전 입력</h2><form id="content-form"><label>운영 계정</label><select name="accountId" class="large-input" required>${a.accounts.map(x=>`<option value="${x.id}">${esc(x.display_name||x.profile_handle||x.id)}</option>`).join('')}</select><label>게시 형식</label><select name="finalFormat" class="large-input"><option value="feed_image">피드 이미지</option><option value="carousel">카드/캐러셀</option><option value="reel_mp4">릴스 MP4</option></select><label>콘텐츠 제목</label><input class="large-input" name="title" maxlength="300"><label>캡션 또는 이미지 생성 지시</label><textarea name="caption" class="large-input"></textarea><label>희망 예약 시각 (한국시간 · 최종 파일 승인 후 실행)</label><input name="scheduledAt" class="large-input" type="datetime-local"><label><input name="manual" type="checkbox"> 수동 승인 대상</label><button class="btn btn-primary">저장</button></form></div><div class="panel section-panel"><h2>예약 / 실행 작업</h2>${j.jobs.map(x=>`<article class="record-card"><div class="record-main"><b>@${esc(x.profile_handle||'계정')} · ${esc(x.status)}</b><span>${esc(x.scheduled_at)} · ${esc(x.hold_reason||'')}</span></div>${x.kind==='publish' && x.status==='held' && ['publishing_disabled','account_paused','emergency_pause','meta_connection_missing','meta_app_disabled','meta_publish_adapter_not_enabled','publishing_scope_missing','approved_media_or_account_unavailable'].includes(x.hold_reason)?`<button class="btn" data-action="resume-reviewed" data-id="${x.id}">해결 후 재개</button>`:''}${['queued','held'].includes(x.status)?`<button class="btn" data-action="cancel" data-id="${x.id}">취소</button>`:''}</article>`).join('')||'<p>작업이 없습니다.</p>'}<h2>콘텐츠 기록</h2>${c.contents.map(x=>`<p><b>${esc(x.title||x.caption||'제목 없음')}</b> · ${esc(x.profile_handle)} · ${esc(x.final_format)} · ${esc(x.status)} ${x.caption?`<details><summary>캡션 보기</summary><span class="caption-text">${esc(x.caption)}</span></details>`:''} ${x.version_id?mediaActions(x.version_id)+(x.final_format==='reel_mp4'?renderControls(x.version_id,archive.files):''):''} ${x.version&&!x.approved_at?`${finalAssetSelector(x,archive.files)}<label>예약 시각 (한국시간)<input type="datetime-local" id="when-${x.id}" value="${toKstInput(x.scheduled_at)}"></label><button class="btn" data-action="approve" data-id="${x.id}">승인하고 예약</button>`:''}</p>`).join('')}</div>${archiveFiles(archive.files)}`)}else if(view==='analysis'){const d=await api('/external-analysis');root.innerHTML=frame('외부 계정 분석','분석 대상을 등록합니다. 실제 지표 수집은 Meta 권한과 API 연결 뒤 검증합니다.',`<div class="panel form-panel"><form id="analysis-form"><label>Instagram 아이디·링크 (한 줄에 하나)</label><textarea class="large-input" name="inputs" rows="5"></textarea><button class="btn btn-primary">분석 대상 등록</button></form></div><div class="panel section-panel"><h2>분석 대상</h2>${d.targets.map(x=>`<p>${esc(x.normalized_url)} · ${esc(x.state)} · ${esc(x.reason||'지표 미수집')}</p>`).join('')||'<p>등록된 대상이 없습니다.</p>'}</div>`)}else if(view==='history'){const d=await api('/execution');root.innerHTML=frame('성과·실행 기록','실제 수집된 값과 관리자 조작 기록만 표시합니다.',`<div class="panel section-panel"><h2>지표 스냅샷</h2>${d.metrics.map(x=>`<p>${esc(x.account_name)} · ${esc(insightNames[x.metric_key]||x.metric_key)} ${esc(x.metric_value??'—')} · ${esc(({actual_value:'수집 완료',api_unconnected:'API 미연결',unavailable:'조회 불가',not_collected:'미수집',collection_error:'수집 오류',insufficient_sample:'표본 부족'})[x.data_status]||x.data_status)} · ${esc(x.collected_at)}</p>`).join('')||'<p>성과 데이터 없음. 미수집은 0으로 처리하지 않습니다.</p>'}</div><div class="panel section-panel"><h2>실행·감사 기록</h2>${d.events.map(x=>`<p>${esc(x.event_type)} · ${esc(x.entity_type||'')} · ${esc(x.created_at)}</p>`).join('')||'<p>기록 없음</p>'}</div>`)}else{const [d,drive]=await Promise.all([api('/settings'),api('/archive/status')]);root.innerHTML=frame('설정·연동','외부 자격증명은 서버 환경변수/시크릿 참조로만 설정합니다. Meta 승인 전 연결 상태는 미연결입니다.',`<div class="panel section-panel"><h2>Meta 앱 등록 (Unified Login)</h2><form id="meta-form"><input class="large-input" name="displayName" placeholder="앱 표시 이름" required><input class="large-input" name="appId" placeholder="Meta App ID" required><input class="large-input" name="oauthConfigId" placeholder="Facebook Login for Business config ID"><input class="large-input" name="redirectUri" placeholder="등록된 HTTPS OAuth redirect URI" required><input class="large-input" name="secretRef" placeholder="Secret 환경변수 이름 (값은 입력하지 않음)"><button class="btn">메타 앱 설정 저장</button></form>${d.metaApps.map(x=>`<p>${esc(x.display_name)} · ${esc(x.app_id)} · Secret ${x.secretConfigured?'설정됨':'미설정'} · ${esc(x.review_status)}</p>`).join('')}</div><div class="panel section-panel"><h2>연동 상태</h2><p>Meta: ${d.adapters.meta?'설정 후보 존재':'미설정'} · AI: ${d.adapters.ai?'설정됨':'미설정'} · 저장소: ${d.adapters.objectStorage?'설정됨':'미설정'}</p></div>${driveSettings(drive)}`)} }catch(e){root.innerHTML=frame('불러오기 오류',esc(e.message),'<p>잠시 후 다시 시도하세요.</p>')}}
function $$(s,r=document){return [...r.querySelectorAll(s)]}
document.addEventListener('submit',async e=>{e.preventDefault();try{const f=e.target,d=Object.fromEntries(new FormData(f));if(f.id==='login-form')return await login(e);if(f.id==='account-form'){const editing=f.dataset.accountId;const r=await api(editing?'/accounts/'+editing:'/accounts',{method:editing?'PATCH':'POST',body:JSON.stringify({username:d.username,displayName:d.displayName,groupId:d.groupId,loginManagementIpNote:d.loginManagementIpNote})});toast(`저장 완료 · 내부 ID ${r.id}`)}if(f.id==='group-form'){await api('/groups',{method:'POST',body:JSON.stringify({name:d.name,targetSize:d.targetSize})});toast('그룹 저장 완료')}if(f.id==='content-form'){const when=d.scheduledAt?new Date(d.scheduledAt+'+09:00').toISOString():null;const r=await api('/contents',{method:'POST',body:JSON.stringify({accountId:d.accountId,finalFormat:d.finalFormat,title:d.title,caption:d.caption,scheduledAt:when,manual:Boolean(when)||f.elements.manual.checked,timezone:'Asia/Seoul'})});toast('콘텐츠와 예약 상태를 저장했습니다. 외부 게시 성공으로 표시하지 않습니다.')}if(f.id==='analysis-form'){const inputs=d.inputs.split(/[\n,]+/).map(x=>x.trim()).filter(Boolean);const r=await api('/external-analysis',{method:'POST',body:JSON.stringify({inputs})});toast(`분석 대상 ${r.registered.length}개 등록, 통계는 미수집`)}if(f.id==='meta-form'){await api('/settings/meta-apps',{method:'POST',body:JSON.stringify(d)});toast('Meta 앱 설정 저장 완료. 실제 연결은 별도 OAuth 동의 전까지 미연결입니다.')}render()}catch(e){toast('실패: '+e.message)}});
document.addEventListener('click',async e=>{const n=e.target.closest('[data-view]');if(n){view=n.dataset.view;render();return}const b=e.target.closest('[data-action]');if(!b)return;try{if(b.dataset.action==='toggle-reviewed'){
  await api('/accounts/'+b.dataset.id,{method:'PATCH',body:JSON.stringify({publishingEnabled:b.dataset.on==='true',automationMode:'review'})});
  await render();return;
}
if(b.dataset.action==='resume-reviewed'){
  await api('/jobs/'+b.dataset.id+'/resume-reviewed',{method:'POST',body:'{}'});await render();return;
}
if(b.dataset.action==='edit-editorial'){await openEditorial(b);return}
if(b.dataset.action==='save-editorial'){await saveEditorial(b);return}
if(b.dataset.action==='edit-insights'){await editInsights(b);return}
if(b.dataset.action==='save-insights'){await saveInsights(b);return}
if(b.dataset.action==='edit-account'){editAccount(b.dataset.id);return}
if(b.dataset.action==='next-page')accountPage++;
if(b.dataset.action==='prev-page')accountPage=Math.max(1,accountPage-1);
if(b.dataset.action==='connect-drive'){const c=await api('/archive/connect',{method:'POST',body:'{}'});location.assign(c.url);return}
if(b.dataset.action==='render-reel'){const form=b.closest('[data-render]');const value=n=>form.querySelector('[name="'+n+'"]').value;
  await api('/content-versions/'+b.dataset.id+'/render',{method:'POST',body:JSON.stringify({picture:value('picture'),music:value('music'),captions:value('captions'),seconds:Number(value('seconds'))})});toast('릴스 합성 예약 완료')}
if(b.dataset.action==='generate-image'){b.disabled=true;try{const job=await api('/content-versions/'+b.dataset.id+'/image',{method:'POST',body:'{}'});toast(job.status==='queued'?'서버에 이미지 생성 작업을 예약했습니다.':'이미지 작업 상태 · '+(job.hold_reason||job.status))}finally{b.disabled=false}}
if(b.dataset.action==='attach-media'){await attachMedia(b);toast('파일 보관 요청 완료')}
if(b.dataset.action==='pause')await api('/system/pause',{method:'POST',body:JSON.stringify({paused:b.dataset.paused==='true',reason:'admin_ui'})});if(b.dataset.action==='cancel')await api(`/jobs/${b.dataset.id}/cancel`,{method:'POST',body:'{}'});if(b.dataset.action==='approve'){const d=document.getElementById('when-'+b.dataset.id)?.value;if(!d)throw Error('한국시간 예약 시각을 선택하세요.');await api(`/contents/${b.dataset.id}/approve`,{method:'POST',body:JSON.stringify({scheduledAt:new Date(d+'+09:00').toISOString(),timezone:'Asia/Seoul',assetId:document.getElementById('final-'+b.dataset.id)?.value||null})})}if(b.dataset.action==='preview-import'){const f=$('#import-file').files[0];if(!f)throw Error('파일을 먼저 선택하세요');const base64=await new Promise((resolve,reject)=>{const rd=new FileReader();rd.onload=()=>resolve(rd.result.split(',')[1]);rd.onerror=reject;rd.readAsDataURL(f)});const p=await api('/accounts/import',{method:'POST',body:JSON.stringify({filename:f.name,base64,action:'preview'})});pendingImport={filename:f.name,base64};$('#import-preview').innerHTML=`<p>행 ${p.rows.length} · ${esc(JSON.stringify(p.counts))}</p><button class="btn btn-primary" data-action="apply-import">이 미리보기 적용</button>`;return}if(b.dataset.action==='apply-import'){if(!pendingImport)return;const p=await api('/accounts/import',{method:'POST',body:JSON.stringify({...pendingImport,action:'apply'})});toast(`가져오기 완료 · ${JSON.stringify(p.counts)}`)}render()}catch(e){toast('실패: '+e.message)}});
document.addEventListener('click',async e=>{if(e.target.id==='logout'){try{await api('/auth/logout',{method:'POST',body:'{}'})}finally{showLogin()}}});
window.addEventListener('DOMContentLoaded',async()=>{try{const s=await api('/auth/session');csrf=s.csrfToken;if(location.hash==='#settings')view='settings';await shell()}catch{showLogin()}});

async function allAccounts() {
  const first=await api('/accounts?pageSize=100');
  for(let page=2;(page-1)*100<first.total;page++) {
    const next=await api('/accounts?pageSize=100&page='+page);
    first.accounts.push(...next.accounts);
  }
  return first;
}
function editAccount(id) {
  const account=accounts.find(x=>x.id===id), f=$('#account-form');
  if(!account || !f)return;
  f.dataset.accountId=id;
  f.elements.username.value=account.profile_handle||'';
  f.elements.displayName.value=account.display_name||'';
  f.elements.groupId.value=account.group_id||'';
  f.elements.loginManagementIpNote.value=account.login_management_ip_note||'';
  f.querySelector('button').textContent='변경사항 저장';
  f.elements.displayName.focus();
}
function driveLink(id,label,folder=false) {
  const base=folder?'https://drive.google.com/drive/folders/':'https://drive.google.com/open?id=';
  return '<a target="_blank" rel="noreferrer" href="'+base+encodeURIComponent(id)+'">'+esc(label)+'</a>';
}
function driveSettings(drive) {
  const status=drive.credentialConfigured?'자격증명 설정됨':'미연결';
  return '<section class="panel section-panel"><h2>Google Drive 보관</h2><p>'+status+
    ' · 대기 '+drive.waiting+'건 · 보관 검증 '+drive.verified+'건 · 폴더 오류 '+drive.folder_errors+'건</p>'+
    (drive.root_id?driveLink(drive.root_id,'보관 폴더 열기',true)+' ':'')+
    (drive.canConnect?'<button class="btn" data-action="connect-drive">Google Drive 연결</button>':
    '<p>연결하려면 서버에 Google OAuth 클라이언트와 콜백 주소를 설정하세요.</p>')+'</section>';
}
function archiveFiles(files) {
  const states={pending:'보관 대기',verified:'Drive 보관 확인',retryable_error:'재시도 대기',unknown_result:'결과 확인 중'};
  return '<section class="panel section-panel"><h2>계정별 파일 보관</h2>'+
    (files.map(f=>'<p>'+esc(f.profile_handle||'계정')+' · '+esc(f.filename)+' · '+esc(states[f.state]||f.state)+
      (f.last_error_code?' · '+esc(f.last_error_code):'')+' <a href="/api/archive/files/'+encodeURIComponent(f.asset_id)+'/download">파일 내려받기</a> '+(f.drive_file_id?driveLink(f.drive_file_id,'파일 열기'):'')+'</p>').join('')||'<p>보관을 요청한 파일이 없습니다.</p>')+'</section>';
}
function mediaActions(id) {
  return '<span><label>제작 파일 <input type="file" data-file-for="'+esc(id)+'"></label> '+
    '<button class="btn" data-action="attach-media" data-id="'+esc(id)+'">파일 보관</button> '+
    '<button class="btn" data-action="generate-image" data-id="'+esc(id)+'">설정한 AI로 이미지 생성 (유료)</button></span>';
}
async function attachMedia(button) {
  const id=button.dataset.id;
  const file=document.querySelector('[data-file-for="'+id+'"]').files[0];
  if(!file)throw Error('보관할 제작 파일을 선택하세요.');
  const slot='manual';
  const fallback={srt:'application/x-subrip',vtt:'text/vtt',mp4:'video/mp4',wav:'audio/wav'};
  const extension=file.name.split('.').pop().toLowerCase();
  const mime=fallback[extension]||file.type||'application/octet-stream';
  const response=await fetch('/api/content-versions/'+id+'/assets?slot='+slot,{
    method:'POST',credentials:'include',headers:{'Content-Type':mime,'X-CSRF-Token':csrf},body:file});
  if(!response.ok)throw Error((await response.json()).error||'파일 저장 실패');
}
function renderControls(id,allFiles) {
  const files=allFiles.filter(f=>f.content_version_id===id);
  const options=items=>items.map(f=>'<option value="'+esc(f.asset_id)+'">'+esc(f.filename)+'</option>').join('');
  const images=files.filter(f=>/^(image|video)\//.test(f.mime_type));
  const music=files.filter(f=>f.mime_type.startsWith('audio/'));
  if(!images.length || !music.length)return '<span>릴스 합성에 사용할 이미지 또는 영상과 음원을 먼저 보관하세요.</span>';
  return '<span data-render><label>이미지 또는 영상 <select name="picture">'+options(images)+'</select></label> '+
    '<label>사용 권리가 있는 음원 <select name="music">'+options(music)+'</select></label> '+
    '<label>자막 <select name="captions"><option value="">없음</option>'+
    options(files.filter(f=>['application/x-subrip','text/vtt'].includes(f.mime_type)))+'</select></label> '+
    '<label>길이(초) <input type="number" name="seconds" value="15" min="1" max="180"></label> '+
    '<button class="btn" data-action="render-reel" data-id="'+esc(id)+'">릴스 MP4 합성</button></span>';
}

function finalAssetSelector(item,files){
  const mime=item.final_format==='feed_image'?'image/jpeg':item.final_format==='reel_mp4'?'video/mp4':null;
  const choices=files.filter(f=>f.content_version_id===item.version_id && f.mime_type===mime);
  if(!choices.length) return '';
  const id='final-'+esc(item.id);
  return '<label for="'+id+'">게시할 최종 파일</label><select class="large-input" id="'+id+'">'+
    choices.map(f=>'<option value="'+esc(f.asset_id)+'">'+esc(f.filename)+'</option>').join('')+'</select>';
}

const insightNames={reach:'도달',saved:'저장',shares:'공유'};
async function editInsights(button){
  const panel=button.closest('article').querySelector('[data-insight-editor]');
  if(panel.childElementCount){panel.replaceChildren();return;}
  const setting=await api('/accounts/'+button.dataset.id+'/insights');
  const keys=setting.metrics||[];
  panel.innerHTML='<fieldset><legend>이 계정의 다음 게시물부터 적용</legend>'+
    '<label><input type="checkbox" name="enabled" '+(keys.length?'checked':'')+'> 성과 자동 수집</label>'+
    '<label>게시 후 대기시간(분)<input class="large-input" type="number" min="1" step="1" name="delay" value="'+esc(setting.delay_minutes??'')+'"></label>'+
    Object.entries(insightNames).map(([key,label])=>'<label><input name="metric" type="checkbox" value="'+key+'" '+(keys.includes(key)?'checked':'')+'> '+label+'</label>').join(' ')+
    ' <button class="btn" type="button" data-action="save-insights" data-id="'+esc(button.dataset.id)+'">성과 설정 저장</button></fieldset>';
}
async function saveInsights(button){
  const box=button.closest('fieldset');
  const enabled=box.querySelector('[name=enabled]').checked;
  const delayMinutes=Number(box.querySelector('[name=delay]').value);
  const metrics=[...box.querySelectorAll('[name=metric]:checked')].map(e=>e.value);
  if(enabled && (!Number.isSafeInteger(delayMinutes)||delayMinutes<1||!metrics.length))
    throw Error('대기시간(분)과 수집할 지표를 입력해 주세요.');
  await api('/accounts/'+button.dataset.id+'/insights',{method:'PUT',body:JSON.stringify({enabled,delayMinutes,metrics})});
  button.closest('[data-insight-editor]').replaceChildren();
  toast('성과 수집 설정을 저장했습니다.');
}

function toKstInput(instant) {
  return instant ? new Date(new Date(instant).getTime()+9*3600000).toISOString().slice(0,16) : '';
}
const editorialLabels={topic:'주제',audience:'대상 독자',voice:'말투',avoid:'금지 표현',
  feed:'피드 제작 지침',reel:'릴스 제작 지침',references:'참고 원본 주소 (한 줄에 하나씩)'};
async function openEditorial(button) {
  const panel=button.closest('article').querySelector('[data-editorial]');
  if(panel.childElementCount){panel.replaceChildren();return;}
  const data=await api('/accounts/'+button.dataset.id+'/editorial');
  panel.dataset.version=data.version;
  panel.innerHTML='<fieldset><legend>이 계정 전용 원본과 제작 지침</legend>'+
    Object.entries(editorialLabels).map(([key,label])=>'<label for="guide-'+button.dataset.id+'-'+key+'">'+label+'</label>'+
      '<textarea id="guide-'+button.dataset.id+'-'+key+'" name="'+key+'" class="large-input" maxlength="6000">'+esc(data.editorial[key])+'</textarea>').join('')+
    '<button class="btn" type="button" data-action="save-editorial" data-id="'+esc(button.dataset.id)+'">지침 저장</button></fieldset>';
}
async function saveEditorial(button) {
  const panel=button.closest('[data-editorial]');
  const editorial=Object.fromEntries([...panel.querySelectorAll('textarea')].map(x=>[x.name,x.value]));
  await api('/accounts/'+button.dataset.id+'/editorial',{method:'PUT',
    body:JSON.stringify({editorial,version:Number(panel.dataset.version)})});
  panel.replaceChildren();
  toast('이 계정의 원본과 제작 지침을 저장했습니다.');
}
