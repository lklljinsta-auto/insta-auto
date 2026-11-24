import os,sys,time,subprocess,secrets,urllib.request,tempfile,io
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
from openpyxl import Workbook
# Run against a newly migrated, disposable test database.
# Set CHROMIUM_EXECUTABLE if Playwright should use an existing Chromium build.
from urllib.parse import urlsplit
if urlsplit(os.environ.get('DATABASE_URL','')).path != '/instaauto_test':
 raise SystemExit('Select a fresh instaauto_test database')

def start(cmd,env):
 return subprocess.Popen(cmd,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
def sql(statement):
 env=dict(os.environ,QA_SQL=statement)
 result=subprocess.check_output(['node','--input-type=module','-e',"""import {query,closePool} from './src/db.js';console.log(JSON.stringify((await query(process.env.QA_SQL)).rows));await closePool()"""],env=env,text=True)
 import json
 return json.loads(result)
if sql("SELECT (SELECT count(*) FROM operators)+(SELECT count(*) FROM ig_accounts) AS n")[0]['n'] != '0':
 raise SystemExit('Browser verification needs a fresh, empty test database')
env=dict(os.environ,PORT='48913',HOST='127.0.0.1',APP_ORIGIN='http://127.0.0.1:48913',ADMIN_EMAIL='qa@localhost',ADMIN_PASSWORD=secrets.token_urlsafe(32),WORKER_POLL_MS='250')
subprocess.run(['node','scripts/bootstrap-admin.js'],env=env,check=True,stdout=subprocess.DEVNULL)
server=start(['node','server.js'],env);worker=None
base=env['APP_ORIGIN']
try:
 for i in range(60):
  try:
   with urllib.request.urlopen(base+'/api/health',timeout=2) as r:assert r.status==200
   break
  except OSError:time.sleep(.15)
 with sync_playwright() as pw:
  browser=pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_EXECUTABLE','/usr/bin/chromium'),args=(os.environ.get('QA_CHROMIUM_ARGS','').split() or ['--disable-dev-shm-usage']))
  page=browser.new_page()
  errors=[];page.on('pageerror',lambda exc:errors.append(str(exc)))
  def login():
   page.locator('#email').fill(env['ADMIN_EMAIL'])
   page.locator('#password').fill(env['ADMIN_PASSWORD'])
   page.get_by_role('button',name='로그인',exact=True).click()
   expect(page.locator('#logout')).to_be_visible()
  def nav(v):
   page.locator('[data-view="'+v+'"]').click()
  page.goto(base);login()
  for view in ['dashboard','accounts','content','analysis','history','settings']:
   nav(view);expect(page.locator('#root h1')).to_be_visible();assert '불러오기 오류' not in page.locator('#root h1').inner_text()
  nav('accounts')
  f=page.locator('#account-form')
  f.locator('[name=username]').fill('e2e_local')
  f.locator('[name=displayName]').fill('운영 계정 검증')
  with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/api/accounts') and r.status==201): f.locator('button').click()
  page.reload();nav('accounts')
  expect(page.locator('[data-action=edit-account]')).to_have_count(1)
  page.locator('[data-action=edit-account]').click()
  f.locator('[name=displayName]').fill('바뀐 이름')
  with page.expect_response(lambda r:r.request.method=='PATCH' and r.status==200):f.locator('button').click()
  page.locator('#logout').click();login();nav('accounts')
  expect(page.locator('.record-card').filter(has_text='바뀐 이름')).to_have_count(1)
  print('PASS Chromium login, 6 menus, create, refresh, edit, logout / login; saved account ID', flush=True)
  button=page.get_by_role('button',name='성과 수집 설정',exact=True)
  button.click()
  editor=page.locator('[data-insight-editor] fieldset')
  editor.get_by_label('성과 자동 수집').check()
  editor.get_by_label('게시 후 대기시간(분)').fill('120')
  editor.get_by_label('도달',exact=True).check()
  with page.expect_response(lambda r:r.url.endswith('/insights') and r.request.method=='PUT' and r.status==200):
   editor.get_by_role('button',name='성과 설정 저장').click()
  page.reload();nav('accounts');button.click()
  expect(editor.get_by_label('게시 후 대기시간(분)')).to_have_value('120')
  expect(editor.get_by_label('도달',exact=True)).to_be_checked()
  expect(editor.get_by_label('공유',exact=True)).not_to_be_checked()
  print('PASS account insights settings persist after reload',flush=True)
  edit=page.get_by_role('button',name='원본·제작 지침')
  edit.click()
  panel=page.locator('[data-editorial] fieldset')
  panel.get_by_label('주제',exact=True).fill('지역 소식')
  panel.get_by_label('피드 제작 지침').fill('짧은 카드')
  panel.get_by_label('참고 원본 주소',exact=False).fill('https://example.invalid/source')
  panel.get_by_role('button',name='지침 저장').click()
  expect(panel).to_have_count(0)
  page.reload();nav('accounts');edit.click()
  expect(panel.get_by_label('주제',exact=True)).to_have_value('지역 소식')
  print('PASS account editorial guidelines survive reload',flush=True)
  wb=Workbook();ws=wb.active;ws.append(['username','display_name'])
  for i in range(200): ws.append([f'xlsx_{i:03d}',f'검증 {i}'])
  mem=io.BytesIO();wb.save(mem);payload=dict(name='accounts200.xlsx',mimeType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer=mem.getvalue())
  def upload():
   page.locator('#import-file').set_input_files(payload)
   page.locator('[data-action=preview-import]').click()
   with page.expect_response(lambda r:r.url.endswith('/accounts/import') and r.request.post_data_json['action']=='apply') as res:
    page.locator('[data-action=apply-import]').click()
   data=res.value.json()
   expect(page.locator('[data-action=apply-import]')).to_have_count(0)
   return data
  assert upload()['counts']['created']==200;assert upload()['alreadyApplied'] is True
  assert sql("SELECT count(*)::int n FROM ig_accounts WHERE profile_handle LIKE 'xlsx_%'")[0]['n']==200
  page.locator('[data-action=next-page]').click();expect(page.locator('#root')).to_contain_text('2 / 5')
  assert not errors,errors
  print('PASS real XLSX 200 rows via Preview & apply twice; account count remains 200, pagination',flush=True)
  nav('content')
  form=page.locator('#content-form')
  form.locator('[name=accountId]').select_option(label='바뀐 이름')
  form.locator('[name=title]').fill('서울 야경')
  form.locator('[name=caption]').fill('저장 흐름 확인')
  form.locator('[name=manual]').check()
  with page.expect_response(lambda r:r.url.endswith('/contents') and r.request.method=='POST' and r.status==201):
   form.locator('button').click()
  import base64
  png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7ZfjcAAAAASUVORK5CYII=')
  for name in ['draft.png','renamed.png']:
   page.locator('[data-file-for]').set_input_files(dict(name=name,mimeType='image/png',buffer=png))
   with page.expect_response(lambda r:'/assets?slot=manual' in r.url and r.status==202):
    page.locator('[data-action=attach-media]').click()
   expect(page.locator('#root')).to_contain_text('서울 야경.png')
  assert sql("SELECT count(*)::int n FROM storage_uploads WHERE state='pending'")[0]['n']==1
  print('PASS browser creates content and attaches the same PNG twice; one pending account file',flush=True)
  link=page.get_by_role('link',name='파일 내려받기')
  response=page.request.get(base+link.get_attribute('href'))
  assert response.status==200 and response.body()==png
  anon=browser.new_context()
  assert anon.request.get(base+link.get_attribute('href')).status==401
  anon.close()
  assert sql("SELECT editorial_snapshot->'editorial'->>'topic' AS topic FROM content_versions")[0]['topic']=='지역 소식'
  print('PASS authentic file bytes, private download and account policy snapshot',flush=True)
  browser.close()
 a=sql("SELECT id FROM ig_accounts WHERE profile_handle='e2e_local'")[0]['id']
 worker=start(['node','worker.js'],env)
 for i in range(60):
  if sql('SELECT count(*)::int n FROM worker_heartbeats')[0]['n']:break
  time.sleep(.1)
 assert worker.poll() is None
 job=sql(f"INSERT INTO scheduled_jobs(account_id,kind,scheduled_at,idempotency_key) VALUES('{a}','source_scan',now()+interval '1 hour','ui-restart-test') RETURNING id")[0]['id']
 worker.terminate();worker.wait(8);worker=None
 sql(f"UPDATE scheduled_jobs SET scheduled_at=now() WHERE id='{job}'")
 worker=start(['node','worker.js'],env)
 for i in range(50):
  row=sql(f"SELECT status,attempts,hold_reason FROM scheduled_jobs WHERE id='{job}'")[0]
  if row['status']=='held':break
  time.sleep(.12)
 assert row=={'status':'held','attempts':1,'hold_reason':'source_connector_not_configured'},row
 worker.terminate();worker.wait(8);worker=start(['node','worker.js'],env);time.sleep(.7)
 assert sql(f"SELECT attempts FROM scheduled_jobs WHERE id='{job}'")[0]['attempts']==1
 print('PASS actual worker stop / restart, expired schedule processed once with no browser, held on missing connector',flush=True)
finally:
 if worker and worker.poll() is None:worker.terminate();worker.wait(8)
 server.terminate();server.wait(8)
