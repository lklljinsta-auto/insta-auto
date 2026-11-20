/* PostPilot control-center views. Preview-only settings; no provider credentials or publishing calls. */
const controlDefaults = {
  policies: {
    a1: {enabled:true,windowStart:'09:00',windowEnd:'10:00',maxPerDay:2,minGap:4,checkMode:'fixed',checkAfter:2,checkMin:2,checkMax:6,recheckAfter:4,minViews:1000,minLikes:50,minComments:5,rule:'all',extraPosts:1,below:'stop'},
    a2: {enabled:true,windowStart:'09:00',windowEnd:'10:00',maxPerDay:8,minGap:2,checkMode:'random',checkAfter:2,checkMin:2,checkMax:6,recheckAfter:4,minViews:1500,minLikes:80,minComments:8,rule:'any',extraPosts:2,below:'recheck'},
    a3: {enabled:true,windowStart:'09:00',windowEnd:'10:00',maxPerDay:5,minGap:3,checkMode:'fixed',checkAfter:4,checkMin:2,checkMax:6,recheckAfter:4,minViews:1200,minLikes:60,minComments:6,rule:'all',extraPosts:1,below:'stop'},
    a4: {enabled:false,windowStart:'09:00',windowEnd:'10:00',maxPerDay:2,minGap:6,checkMode:'fixed',checkAfter:6,checkMin:2,checkMax:6,recheckAfter:4,minViews:800,minLikes:40,minComments:4,rule:'all',extraPosts:1,below:'stop'}
  },
  ai: {provider:'openai',model:'선택 필요'},
  drive: {connected:false},
  security: {failClosed:true}
};
function cloneControlDefaults(){return JSON.parse(JSON.stringify(controlDefaults));}
function controlEscape(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function readControlState(){
  try {
    const saved=JSON.parse(localStorage.getItem('postpilot-control-center')||'{}');
    return {...cloneControlDefaults(),...saved,policies:{...cloneControlDefaults().policies,...(saved.policies||{})},ai:{...controlDefaults.ai,...(saved.ai||{})},drive:{...controlDefaults.drive,...(saved.drive||{})},security:{...controlDefaults.security,...(saved.security||{})}};
  } catch { return cloneControlDefaults(); }
}
let controlState=readControlState();
function saveControlState(){
  try {localStorage.setItem('postpilot-control-center',JSON.stringify(controlState));return true;}
  catch {return false;}
}
viewNames.automation='반응 자동화';
viewNames.integrations='연동 · 보안';
function policyCard(a){
  const p={...controlDefaults.policies.a1,...(controlState.policies[a.id]||{})};
  const safe=(key)=>controlEscape(p[key]);
  const fixedHidden=p.checkMode==='random'?'hidden':'';
  const randomHidden=p.checkMode==='fixed'?'hidden':'';
  return `<form class="panel policy-card policy-form" data-policy-account="${controlEscape(a.id)}">
    <div class="policy-header">${accountAvatar(a)}<div class="policy-heading"><strong>${controlEscape(a.name)}</strong><small>${controlEscape(a.handle)} · 이 계정에만 적용되는 규칙</small></div><label class="toggle-label"><input type="checkbox" name="enabled" ${p.enabled?'checked':''}><span>자동 판단 사용</span></label></div>
    <div class="policy-grid">
      <div class="form-field"><label>임의 게시 시간대</label><div class="time-range"><input name="windowStart" type="time" value="${safe('windowStart')}" class="form-input"><span>부터</span><input name="windowEnd" type="time" value="${safe('windowEnd')}" class="form-input"></div><small>서버가 이 범위 안에서 게시 시각을 고릅니다.</small></div>
      <div class="form-field"><label>하루 최대 게시 수</label><div class="input-unit"><input name="maxPerDay" type="number" min="1" max="20" value="${safe('maxPerDay')}" class="form-input"><span>건</span></div></div>
      <div class="form-field"><label>게시 간 최소 간격</label><div class="input-unit"><input name="minGap" type="number" min="1" max="24" value="${safe('minGap')}" class="form-input"><span>시간</span></div></div>
      <div class="form-field delay-field"><label>반응 확인 시점</label><select name="checkMode" class="form-select"><option value="fixed" ${p.checkMode==='fixed'?'selected':''}>고정 시간</option><option value="random" ${p.checkMode==='random'?'selected':''}>범위 내 임의 시간</option></select><div class="delay-values fixed-delay" ${fixedHidden}><select name="checkAfter" class="form-select"><option value="2" ${p.checkAfter==2?'selected':''}>2시간 후</option><option value="4" ${p.checkAfter==4?'selected':''}>4시간 후</option><option value="5" ${p.checkAfter==5?'selected':''}>5시간 후</option><option value="6" ${p.checkAfter==6?'selected':''}>6시간 후</option></select></div><div class="delay-values random-delay" ${randomHidden}><input name="checkMin" type="number" min="1" max="48" value="${safe('checkMin')}" class="form-input"><span>~</span><input name="checkMax" type="number" min="1" max="48" value="${safe('checkMax')}" class="form-input"><span>시간</span></div><small>고정값 또는 설정 범위에서 확인 시점을 정합니다.</small></div>
    </div>
    <div class="policy-divider"><span>추가 게시 판단 기준</span><small>반응 조회에 실패하면 추가 게시하지 않습니다.</small></div>
    <div class="threshold-grid">
      <div class="form-field"><label>최소 조회수</label><input name="minViews" type="number" min="0" value="${safe('minViews')}" class="form-input"></div>
      <div class="form-field"><label>최소 좋아요</label><input name="minLikes" type="number" min="0" value="${safe('minLikes')}" class="form-input"></div>
      <div class="form-field"><label>최소 댓글</label><input name="minComments" type="number" min="0" value="${safe('minComments')}" class="form-input"></div>
      <div class="form-field"><label>기준 결합 방식</label><select name="rule" class="form-select"><option value="all" ${p.rule==='all'?'selected':''}>모두 충족</option><option value="any" ${p.rule==='any'?'selected':''}>하나 이상 충족</option></select></div>
    </div>
    <div class="policy-actions"><label>반응 기준 충족 시 <span class="input-unit inline-unit"><input name="extraPosts" type="number" min="0" max="8" value="${safe('extraPosts')}" class="form-input"><span>개까지 추가 게시</span></span></label><label class="below-label">기준 미달 시 <select name="below" class="form-select"><option value="stop" ${p.below==='stop'?'selected':''}>오늘은 중지</option><option value="recheck" ${p.below==='recheck'?'selected':''}>한 번 더 확인 후 결정</option></select></label><label class="recheck-label">재확인 간격 <select name="recheckAfter" class="form-select"><option value="2" ${p.recheckAfter==2?'selected':''}>2시간</option><option value="4" ${p.recheckAfter==4?'selected':''}>4시간</option><option value="5" ${p.recheckAfter==5?'selected':''}>5시간</option><option value="6" ${p.recheckAfter==6?'selected':''}>6시간</option></select></label><button type="submit" class="btn btn-primary">이 계정 규칙 저장</button></div>
  </form>`;
}
function automationPage(){
  return `${heading('ACCOUNT AUTOMATION','계정별 반응 자동화','게시 시각, 일일 한도와 반응 확인 결과에 따른 다음 행동을 계정마다 따로 정합니다.',button('전체 규칙 저장','save-all-policies',true,'✓'))}
    ${notice('개발 Preview 전용 설정입니다. 저장한 값은 현재 브라우저에만 보관되며 실제 게시·인사이트 API와 예약 서버는 연결되지 않았습니다.')}
    <div class="policy-summary"><div><strong>판단 방식</strong><span>각 게시물의 반응을 지정 시점에 확인하고, 해당 계정 규칙으로 추가 게시 또는 중지를 결정합니다.</span></div><div class="policy-safety"><span class="status-orb pending"></span><strong>운영 전 서버 구현 필요</strong><small>현재는 화면 설정만 저장</small></div></div>
    ${accounts.map(policyCard).join('')}
    <div class="policy-footnote">반응 지표의 종류와 제공 여부는 실제 Instagram 연결 후 계정·게시물 형식별로 확인합니다. 이 화면의 임계값과 예시 계정은 실제 운영 데이터가 아닙니다.</div>`;
}
function statusLine(label,status,desc,action=''){return `<div class="integration-row"><div class="integration-status"><span class="status-orb pending"></span><div><strong>${label}</strong><small>${desc}</small></div></div><span class="status-pill review">${status}</span>${action}</div>`;}
function integrationsPage(){
  const providerLabel={openai:'OpenAI API',manus:'Manus 제공 모델',google:'Google Gemini',anthropic:'Anthropic'}[controlState.ai.provider]||'OpenAI API';
  return `${heading('CONNECTIONS & SAFETY','연동 · 보안','AI·Drive·Instagram 연결과 게시 출구의 준비 상태를 확인합니다.',button('설정 저장','save-integrations',true,'✓'))}
    ${notice('아직 실제 외부 계정이나 API가 연결되지 않았습니다. 이 Preview는 운영 사이트 로그인이나 Cloudflare Access 설정을 대신하지 않습니다.')}
    <div class="settings-grid">
      <section class="panel integration-panel"><div class="panel-head"><div><div class="panel-title">AI 제공자</div><div class="panel-subtitle">공급자 어댑터를 통해 나중에 교체할 수 있습니다.</div></div><span class="topic-pill">현재 선택 · ${providerLabel}</span></div>
        <div class="settings-body"><div class="form-field"><label>콘텐츠 생성 제공자</label><select id="ai-provider" class="form-select"><option value="openai" ${controlState.ai.provider==='openai'?'selected':''}>OpenAI API</option><option value="manus" ${controlState.ai.provider==='manus'?'selected':''}>Manus 제공 모델</option><option value="google" ${controlState.ai.provider==='google'?'selected':''}>Google Gemini (추후 연결)</option><option value="anthropic" ${controlState.ai.provider==='anthropic'?'selected':''}>Anthropic (추후 연결)</option></select></div>
        <div class="form-field"><label>모델 이름 (선택)</label><input id="ai-model" class="form-input" value="${controlEscape(controlState.ai.model)}" placeholder="예: 연결 후 사용 가능한 모델 선택"></div>
        <div class="credential-note"><strong>API 키는 이 화면에 입력하지 않습니다.</strong><span>서버 측 비밀 설정으로만 등록하며 브라우저 저장소·페이지 코드에는 저장하지 않습니다.</span></div>
        <div class="pro-credit-note">ChatGPT Pro는 ChatGPT 앱 구독이며 API 키와 별개입니다. 일부 Pro 가입자는 계정에서 API 크레딧 혜택을 신청할 수 있으니 Billing에서 자격과 활성화 상태를 확인해야 합니다. <a href="https://help.openai.com/en/articles/20001626-api-credits-benefit-for-eligible-chatgpt-subscriptions" target="_blank" rel="noreferrer">OpenAI 안내 ↗</a></div>
        ${statusLine('AI API 인증','미연동','실제 키와 모델 확인 후 활성화')}</div>
      </section>
      <section class="panel integration-panel"><div class="panel-head"><div><div class="panel-title">Google Drive</div><div class="panel-subtitle">원본 기사 자료와 생성 파일 보관</div></div><span class="topic-pill">${controlState.drive.connected?'연결됨':'미연동'}</span></div>
        <div class="settings-body"><p class="settings-copy">Google OAuth를 연결하면 서버가 지정한 Drive 파일만 읽고 저장하도록 구성합니다. 인증 토큰은 서버에만 보관합니다.</p>
          ${statusLine('운영자 Google 계정','미연동','OAuth 동의 및 토큰 저장 미설정',`<button class="btn" data-action="connect-drive-preview">Drive 연결 준비</button>`)}
          <div class="credential-note"><strong>브라우저·GitHub에 Drive 토큰을 저장하지 않습니다.</strong><span>실제 게시 시에는 Instagram이 가져갈 수 있는 미디어 주소를 서버에서 준비합니다.</span></div>
        </div>
      </section>
      <section class="panel integration-panel"><div class="panel-head"><div><div class="panel-title">Instagram 계정</div><div class="panel-subtitle">계정 연결과 게시 권한</div></div><span class="topic-pill">${accounts.length}개 · 전부 예시</span></div>
        <div class="settings-body">${accounts.map(a=>statusLine(`${controlEscape(a.name)} ${controlEscape(a.handle)}`,'미연동','Meta 계정 권한과 게시 API 미연결')).join('')}</div>
      </section>
      <section class="panel integration-panel"><div class="panel-head"><div><div class="panel-title">사이트 접근 보호</div><div class="panel-subtitle">배포 시 운영자 이메일만 허용</div></div><span class="status-pill review">아직 미설정</span></div>
        <div class="settings-body"><div class="security-callout"><span class="security-icon">!</span><div><strong>이 Preview는 비공개 운영 사이트가 아닙니다.</strong><p>GitHub 비공개 저장소와 Cloudflare Pages를 연결한 뒤, pages.dev 및 미리보기 주소에 Cloudflare Access 허용 이메일 정책을 적용하고 외부 비허용 세션이 차단되는지 확인해야 합니다.</p></div></div>
        ${statusLine('Cloudflare Access','미설정','배포 계정·허용 이메일 확인 후 적용')}
        </div>
      </section>
      <section class="panel integration-panel network-panel"><div class="panel-head"><div><div class="panel-title">계정별 고정 출구 IP</div><div class="panel-subtitle">준비 상태가 확인되지 않으면 게시 중지</div></div><span class="status-pill review">실제 라우팅 미검증</span></div>
        <div class="settings-body"><div class="security-callout"><span class="security-icon">!</span><div><strong>화면에 적힌 IP는 실제 발신 경로가 아닙니다.</strong><p>서울 서버와 고정 IP를 연결하고, 계정별 출구 IP 확인 테스트를 통과하기 전에는 게시할 수 없습니다. 불일치 시 다른 IP로 대체하지 않는 정책을 기본으로 합니다.</p></div></div>
          ${accounts.map(a=>`<div class="integration-row"><div class="integration-status">${accountAvatar(a)}<div><strong>${controlEscape(a.name)} ${controlEscape(a.handle)}</strong><small>할당 IP · 미연결 / 검증 불가</small></div></div><span class="status-pill paused">게시 차단</span></div>`).join('')}
        </div>
      </section>
      <section class="panel integration-panel"><div class="panel-head"><div><div class="panel-title">AWS 서울 서버와 예약 실행</div><div class="panel-subtitle">PC가 꺼져 있어도 서버에서 실행</div></div><span class="status-pill review">미연결</span></div>
        <div class="settings-body"><p class="settings-copy">예약 큐, 게시 중복 방지, IP 검사, 반응 측정, 계정별 결정 결과를 서버에 저장하는 구조로 연결할 예정입니다.</p>
        ${statusLine('AWS 서울 리전 EC2','미연결','AWS 계정·서버 인스턴스·Elastic IP 미설정')}
        ${statusLine('예약 실행과 감사 기록','준비 전','DB·백업·헬스체크·변경 이력 미구현')}</div>
      </section>
    </div>`;
}
const previousRender=render;
render=function(){
  if(currentView!=='automation'&&currentView!=='integrations'){previousRender();return;}
  const root=$('#view-root');
  root.innerHTML=currentView==='automation'?automationPage():integrationsPage();
  $('#crumb-current').textContent=viewNames[currentView];
  $$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.view===currentView));
};
function formToPolicy(form){
  const d=new FormData(form);
  const num=(key,min,max)=>Math.max(min,Math.min(max,Number(d.get(key))||0));
  let checkMin=num('checkMin',1,48),checkMax=num('checkMax',1,48);
  if(checkMin>checkMax)[checkMin,checkMax]=[checkMax,checkMin];
  const allowed=[2,4,5,6];
  return {enabled:d.get('enabled')==='on',windowStart:d.get('windowStart')||'09:00',windowEnd:d.get('windowEnd')||'10:00',maxPerDay:num('maxPerDay',1,20),minGap:num('minGap',1,24),checkMode:d.get('checkMode')==='random'?'random':'fixed',checkAfter:allowed.includes(Number(d.get('checkAfter')))?Number(d.get('checkAfter')):2,checkMin,checkMax,recheckAfter:allowed.includes(Number(d.get('recheckAfter')))?Number(d.get('recheckAfter')):4,minViews:num('minViews',0,1000000000),minLikes:num('minLikes',0,1000000000),minComments:num('minComments',0,1000000000),rule:d.get('rule')==='any'?'any':'all',extraPosts:num('extraPosts',0,8),below:d.get('below')==='recheck'?'recheck':'stop'};
}
document.addEventListener('change',e=>{
  if(e.target.name!=='checkMode')return;
  const form=e.target.closest('.policy-form');
  if(!form)return;
  form.querySelector('.fixed-delay').hidden=e.target.value==='random';
  form.querySelector('.random-delay').hidden=e.target.value!=='random';
});
document.addEventListener('submit',e=>{
  const form=e.target.closest('.policy-form');
  if(!form)return;
  e.preventDefault();
  controlState.policies[form.dataset.policyAccount]=formToPolicy(form);
  toast(saveControlState()?`${acct(form.dataset.policyAccount).name} 규칙을 이 브라우저에 저장했습니다. 실제 서버에는 아직 저장되지 않습니다.`:'브라우저 저장이 차단되었습니다. 현재 화면 값은 서버에 저장되지 않았습니다.');
});
document.addEventListener('click',e=>{
  const el=e.target.closest('[data-action]'); if(!el)return;
  if(el.dataset.action==='save-all-policies'){
    $$('.policy-form').forEach(form=>controlState.policies[form.dataset.policyAccount]=formToPolicy(form));
    toast(saveControlState()?'계정별 규칙을 이 브라우저에 저장했습니다. 운영 서버에는 아직 동기화되지 않습니다.':'브라우저 저장이 차단되었습니다. 운영 서버에 동기화되지 않았습니다.');
  } else if(el.dataset.action==='save-integrations'){
    controlState.ai.provider=$('#ai-provider').value;
    controlState.ai.model=$('#ai-model').value.trim()||'선택 필요';
    const saved=saveControlState(); render(); toast(saved?'AI 선택을 현재 브라우저에 저장했습니다. API 키와 연결 상태는 변경되지 않았습니다.':'브라우저 저장이 차단되었습니다. API 키나 연결 상태는 변경되지 않았습니다.');
  } else if(el.dataset.action==='connect-drive-preview') toast('Drive OAuth는 아직 연결되지 않았습니다. Google 인증 설정 단계에서 연결합니다.');
});
