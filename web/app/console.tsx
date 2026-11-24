'use client';
import {useEffect,useRef,useState} from 'react';
import Viewers from './viewers';
import {mountConsole} from './original-ui';
const menus=[
 ['dashboard','⌂','요약'],['research','⌕','Instagram 계정 분석'],['accounts','◎','내 운영 계정'],
 ['compose','＋','콘텐츠 작성'],['queue','▤','콘텐츠 목록'],['analytics','▥','성과 기록'],['settings','⚙','연동 상태']
];
export default function Console({manageUsers,loginId}:{manageUsers:boolean,loginId:string}){
 const shell=useRef<HTMLDivElement>(null);
 const [view,select]=useState('dashboard');
 useEffect(()=>mountConsole(shell.current!,manageUsers,select),[manageUsers]);
 const nav=manageUsers?[...menus,['admin','⚙','관리자']]:menus;
 return <div ref={shell} className="app-shell">
  <aside className="sidebar"><a className="brand-row" href="#dashboard" data-view="dashboard"><img className="brand-mark" src="/favicon.svg" alt=""/><span className="brand-copy"><strong>인스타오토</strong><small>INSTAGRAM OPERATIONS</small></span></a>
  <div className="workspace-switch"><strong className="login-id" aria-label={'로그인 아이디 '+loginId}>{loginId}</strong></div>
  <div className="nav-caption">운영 메뉴</div><nav className="primary-nav" aria-label="운영 메뉴">{nav.map(([id,icon,title])=><button type="button" key={id} data-view={id} className={'nav-item'+(id===view?' active':'')} aria-current={id===view?'page':undefined}><span className="nav-icon">{icon}</span><span>{title}</span></button>)}</nav>
  <div className="sidebar-note"><strong>현재 저장 방식</strong><span>운영 서버에 저장됩니다.</span></div></aside>
  <main className="main-area"><header className="topbar"><div className="breadcrumb"><strong>인스타오토</strong><span>/</span><span>{nav.find(([id])=>id===view)?.[2]}</span></div><div className="topbar-status"><span className="status-dot"/><span>Instagram API 미연결</span></div></header>
  <section className="view-root" id="view-root" hidden={view==='admin'} aria-live="polite"/>
  {manageUsers&&view==='admin'&&<div className="view-root"><div className="page-heading"><div><p className="eyebrow">인스타오토</p><h1>관리자</h1></div></div><Viewers/></div>}</main>
  <div id="toast-root" className="toast-root" role="status" aria-live="polite"/></div>;
}
