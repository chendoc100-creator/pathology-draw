(async function(){
'use strict';
/* Same-origin auth: the app is served from the auth domain so sign-in works in Safari/iOS too. */
var HOME='pathology-draw.firebaseapp.com';
if(location.hostname==='pathology-draw.web.app'){location.replace('https://'+HOME+location.pathname+location.search+location.hash);return}
var UA=navigator.userAgent;
if(/\bLine\//i.test(UA)&&!/openExternalBrowser=1/.test(location.search)){location.replace(location.href.split('#')[0]+(location.search?'&':'?')+'openExternalBrowser=1');return}
var IN_APP=/\bLine\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger|KAKAOTALK|Threads|Twitter|; wv\)/i.test(UA);
var MOBILE=/Android|iPhone|iPad|iPod|Mobile/i.test(UA)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);

var FB='https://www.gstatic.com/firebasejs/10.14.1/';
var CFG={apiKey:"AIzaSyC1V6sxv106LZcaWZ3aSxtnBhzHL6aez2U",authDomain:HOME,projectId:"pathology-draw",storageBucket:"pathology-draw.firebasestorage.app",messagingSenderId:"1077378446876",appId:"1:1077378446876:web:3297bee90fa287e7c211d9"};
if(window.__EMU){CFG.authDomain=location.host;CFG.projectId="demo-pd"}
/* microteaching: slide list (https) and slide viewer (http, port 9002) */
var PORTAL=window.__PORTAL||'https://microteaching.ntu.edu.tw/';
var VIEWURL=window.__VIEWURL||'http://microteaching.ntu.edu.tw:9002/EBMViewer';
var LIST_ORIGIN=window.__LIST_ORIGIN||'https://microteaching.ntu.edu.tw';
var VIEW_ORIGIN=window.__VIEW_ORIGIN||'http://microteaching.ntu.edu.tw:9002';
var QS=new URLSearchParams(location.search);
var PANEL=(QS.get('p')||'').toUpperCase().replace(/[^A-Z0-9_]/g,'')||null;   /* answer panel next to the slide viewer */
var FIELD={4:5500,10:2200,40:550};

var $=function(id){return document.getElementById(id)};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
function fmt(s){return esc(s).replace(/==([^=\n]+?)==/g,'<mark>$1</mark>').replace(/__([^_\n]+?)__/g,'<b>$1</b>')}
function strip(s){return String(s||'').replace(/==([^=\n]+?)==/g,'$1').replace(/__([^_\n]+?)__/g,'$1')}
function hasMark(s){return /==[^=\n]+?==|__[^_\n]+?__/.test(s)}
function numOf(id){var m=String(id).match(/\d+/);return m?parseInt(m[0],10):1e9}
function byNum(a,b){return numOf(a)-numOf(b)||(a<b?-1:a>b?1:0)}
function hash(s){var h=0;s=String(s||'');for(var i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0}return h.toString(36)}
function uniq(a){var o=[],k={};(a||[]).forEach(function(x){if(!k[x]){k[x]=1;o.push(x)}});return o}
function note(t){$('notice').hidden=!t;$('notice').textContent=t||'';if(t&&PANEL)$('notice').scrollIntoView({block:'nearest'})}
function el(tag,cls,html){var e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e}
function fsz(um){return um>=1000?(um/1000)+' mm':um+' µm'}

/* ---------- state ---------- */
var fb=null,user=null,isAdmin=false,adm=false;
var SL=[],BY={},CAT=[],CBY={};          /* quiz slides; catalog of every slide (physical + online) */
var P={seen:[],review:[],rseen:[],last:'',rlast:'',units:null,alt:true};
var U={overrides:{},notes:{}};
var IMG={};                              /* slideId -> [{id,data,w,h,at,note,view}] */
var REPORTS=[],FLD={},META={};
var DEFGROUPS=[{name:'Micro 1',units:['Cell injury and adaption','Inflammation','Hemodynamic derangement','Infection']}];                   /* FLD: answer points {id:{pts:[{k,x,y,obj,conf,note}]}} */
var tab='draw',pool='all',rvHide=false,rvKey=false;
var live=[];

function cleanP(o){var b={seen:[],review:[],rseen:[],last:'',rlast:'',units:null,alt:true};if(o){['seen','review','rseen'].forEach(function(k){if(Array.isArray(o[k]))b[k]=o[k].filter(function(x){return BY[x]})});b.last=o.last||'';b.rlast=o.rlast||'';if(Array.isArray(o.units))b.units=o.units;if(o.alt===false)b.alt=false}return b}

/* ---------- firebase ---------- */
async function fbLoad(){
  var m=await Promise.all([import(FB+'firebase-app.js'),import(FB+'firebase-auth.js'),import(FB+'firebase-firestore.js')]);
  var app=m[0].initializeApp(CFG);
  fb={au:m[1],fs:m[2],auth:m[1].getAuth(app),db:m[2].getFirestore(app)};
  if(window.__EMU){m[1].connectAuthEmulator(fb.auth,'http://127.0.0.1:9099',{disableWarnings:true});m[2].connectFirestoreEmulator(fb.db,'127.0.0.1',8080);
    window.__emuLogin=function(o){return m[1].signInWithCredential(fb.auth,m[1].GoogleAuthProvider.credential(JSON.stringify({sub:o.sub,email:o.email,email_verified:true,name:o.name})))}}
}
function D(){var a=[fb.db].concat([].slice.call(arguments));return fb.fs.doc.apply(null,a)}
function C(){var a=[fb.db].concat([].slice.call(arguments));return fb.fs.collection.apply(null,a)}
var wq=Promise.resolve();
function queue(f){wq=wq.then(f).catch(function(e){note('雲端儲存失敗（'+(e.code||e.message)+'）。請重新整理後再試。')});return wq}
function saveP(){if(!user)return;var snap=JSON.parse(JSON.stringify(P));queue(function(){return fb.fs.setDoc(D('progress',user.uid),snap)})}
function saveU(field,id){if(!user)return;var v=U[field][id];var fp=new fb.fs.FieldPath(field,id);
  queue(function(){return fb.fs.updateDoc(D('users',user.uid),fp,v===undefined?fb.fs.deleteField():v)})}

/* ---------- auth ---------- */
function showGate(){
  $('app').hidden=true;$('gate').hidden=false;$('login').hidden=true;$('acct').textContent='未登入';$('admbtn').hidden=true;
  if(IN_APP){$('inapp').hidden=false;$('inapp').innerHTML='你現在是在 App 內建的瀏覽器（LINE、IG、FB 等）裡，Google 不允許在這裡登入。請按右上角「…」選「用瀏覽器開啟」，或複製網址貼到 Safari / Chrome。<div class="row" style="margin-top:6px"><button type="button" class="btn sm" id="cpy">複製網址</button></div>';
    $('cpy').onclick=function(){copy('https://'+HOME+'/').then(function(ok){$('cpy').textContent=ok?'已複製':'請長按網址列複製'})}}
}
async function copy(t){try{await navigator.clipboard.writeText(t);return true}catch(e){try{var x=el('textarea');x.value=t;document.body.appendChild(x);x.select();var ok=document.execCommand('copy');x.remove();return ok}catch(e2){return false}}}
async function login(){
  if(!fb)return;
  if(user){await fb.au.signOut(fb.auth);return}
  if(IN_APP){note('請先改用 Safari / Chrome 開啟本頁再登入。');return}
  var p=new fb.au.GoogleAuthProvider();p.setCustomParameters({prompt:'select_account'});
  try{
    if(MOBILE&&!window.__EMU)await fb.au.signInWithRedirect(fb.auth,p);
    else await fb.au.signInWithPopup(fb.auth,p);
  }catch(e){
    if(e.code==='auth/popup-blocked'||e.code==='auth/operation-not-supported-in-this-environment'){try{await fb.au.signInWithRedirect(fb.auth,p)}catch(e2){note('登入失敗：'+(e2.code||e2.message))}}
    else if(e.code!=='auth/popup-closed-by-user'&&e.code!=='auth/cancelled-popup-request')note('登入失敗：'+(e.code||e.message));
  }
}
async function onUser(u){
  user=u;isAdmin=false;adm=false;IMG={};
  if(!u){SL=[];BY={};CAT=[];CBY={};P=cleanP(null);U={overrides:{},notes:{}};FLD={};showGate();return}
  $('gate').hidden=true;$('acct').textContent='讀取中…';$('login').hidden=false;$('login').textContent='登出';
  try{
    var r=await Promise.all([
      fb.fs.getDoc(D('content','slides')),
      fb.fs.getDoc(D('progress',u.uid)),
      fb.fs.getDoc(D('users',u.uid)),
      fb.fs.getDoc(D('admin','flag')).then(function(){return true},function(){return false}),
      fb.fs.getDoc(D('content','fields')).then(function(x){return x.exists()?x.data():{}},function(){return {}}),
      fb.fs.getDoc(D('content','catalog')).then(function(x){return x.exists()?(x.data().list||[]):[]},function(){return []}),
      fb.fs.getDoc(D('content','meta')).then(function(x){return x.exists()?x.data():{}},function(){return {}})
    ]);
    META=r[6]||{};
    FLD=r[4]||{};CAT=r[5];CBY={};CAT.forEach(function(c){CBY[c.id]=c});
    SL=(r[0].exists()&&r[0].data().list)||[];BY={};SL.forEach(function(d){if(!d.units)d.units=[d.unit||'未分類'];BY[d.id]=d});
    P=cleanP(r[1].exists()?r[1].data():null);
    if(r[2].exists()){var x=r[2].data();U={overrides:x.overrides||{},notes:x.notes||{}}}
    else{U={overrides:{},notes:{}};await fb.fs.setDoc(D('users',u.uid),{overrides:{},notes:{}})}
    isAdmin=r[3];
  }catch(e){
    $('acct').textContent='已登入';note('讀取資料失敗（'+(e.code||e.message)+'）。請重新整理；一直失敗的話告訴管理者。');return
  }
  $('acct').textContent=(u.displayName||u.email||'已登入')+'（資料只有你看得到）';
  note(SL.length?'':'題庫還是空的。');
  $('app').hidden=false;$('admbtn').hidden=!isAdmin;setAdm(false);
  if(isAdmin)loadReports();
  if(PANEL){renderPanel();return}
  renderUnits();setPool(pool);showTab(tab==='adm'?'draw':tab);counts();
}

/* ---------- admin mode: hidden behind one button so the admin's normal view matches everyone's ---------- */
function setAdm(on){adm=!!(on&&isAdmin);document.body.classList.toggle('adm',adm);$('admbtn').setAttribute('aria-pressed',adm);$('admbtn').textContent=adm?'離開管理':'管理';
  $('t-adm').hidden=!adm;if(!adm&&tab==='adm')showTab('draw');refreshLive();if(PANEL&&user)renderPanel()}

/* ---------- units ---------- */
function unitsOf(d){return d.units||[d.unit||'未分類']}
function allUnits(){var a=[];SL.forEach(function(d){a=a.concat(unitsOf(d))});return uniq(a)}
function selUnits(){var a=allUnits();if(!P.units)return a;var s=P.units.filter(function(x){return a.indexOf(x)>=0});return s.length?s:a}
function inUnits(id){var d=BY[id];if(!d)return false;var s=selUnits();return unitsOf(d).some(function(u){return s.indexOf(u)>=0})}
function groups(){var a=allUnits(),used=[];
  var G=((META.groups&&META.groups.length)?META.groups:DEFGROUPS).map(function(g){return {name:g.name,units:(g.units||[]).filter(function(u){return a.indexOf(u)>=0})}}).filter(function(g){return g.units.length});
  G.forEach(function(g){used=used.concat(g.units)});var rest=a.filter(function(u){return used.indexOf(u)<0});
  if(rest.length)G.push({name:'其他單元',units:rest,rest:true});return G}
function setUnits(s){var a=allUnits();s=uniq(s).filter(function(u){return a.indexOf(u)>=0});P.units=s.length&&s.length<a.length?s:null;saveP();unitsChanged()}
function renderUnits(){
  var box=$('units');box.innerHTML='';
  var top=el('div','grp');var all=el('button','gb','全部');all.type='button';all.setAttribute('aria-pressed',!P.units);
  all.onclick=function(){P.units=null;saveP();unitsChanged()};top.appendChild(el('span','lb','範圍'));top.appendChild(all);box.appendChild(top);
  var cur=P.units||[];
  groups().forEach(function(g){var row=el('div','grp');
    var on=!!P.units&&g.units.every(function(u){return cur.indexOf(u)>=0});
    var gb=el('button','gb',esc(g.name));gb.type='button';gb.setAttribute('aria-pressed',on);gb.title='整次 '+g.name+' 的單元一起選或取消';
    gb.onclick=function(){var s=cur.slice();if(on)s=s.filter(function(u){return g.units.indexOf(u)<0});else s=s.concat(g.units);setUnits(s)};
    row.appendChild(gb);
    g.units.forEach(function(u){var b=el('button',null,esc(u));b.type='button';b.setAttribute('aria-pressed',!!P.units&&cur.indexOf(u)>=0);
      b.onclick=function(){var s=cur.slice(),i=s.indexOf(u);if(i>=0)s.splice(i,1);else s.push(u);setUnits(s)};row.appendChild(b)});
    box.appendChild(row)});
}
function unitsChanged(){renderUnits();setPool(pool);renderAll()}

/* ---------- slide info ---------- */
function info(id){if(BY[id])return BY[id];var c=CBY[id];if(!c)return null;
  return {id:id,n:c.n||'',dxfull:c.dx||c.pdx||'',dx:c.dx||c.pdx||'',organ:'',desc:'',note:c.on?'':'線上沒有這張，只有實體片。',units:[],cat:true}}
function viewId(id){var d=BY[id];return (d&&d.view)||id}
function isOnline(vid){var c=CBY[vid];return c?!!c.on:!!(BY[vid])}
function headOf(d){return esc(d.id)+(d.n?' <small>('+esc(d.n)+')</small>':'')}
function eff(id){var d=info(id),o=U.overrides[id];
  return {dx:o&&o.dxfull!=null?o.dxfull:d.dxfull,organ:o&&o.organ!=null?o.organ:d.organ,desc:o&&o.desc!=null?o.desc:d.desc,note:d.note,mine:!!o,stale:!!(o&&o.base!==baseOf(d))}}
function baseOf(d){return hash([d.dxfull,d.organ,d.desc].join('|'))}
function lineKey(l){return strip(l).replace(/\s+/g,' ').trim()}
function ptsOf(id){var f=FLD[id];return (f&&f.pts)||[]}
function ptMap(id){var o={};ptsOf(id).forEach(function(p){o[p.k]=p});return o}

/* ---------- slide card ---------- */
function mk(id,opt){
  opt=opt||{};
  var d=info(id);if(!d){var x=el('div','it','<div class="empty">找不到 '+esc(id)+'</div>');return {el:x,id:id,upd:function(){},ans:function(){},opt:opt}}
  var vid=viewId(id),can=isOnline(vid),par=d.parent&&BY[d.parent];
  var e=el('div','it'+(opt.big?' big':''));
  e.innerHTML='<div class="head">'+headOf(d)+(d.n?'':'<span class="badge on">線上</span>')+(par?'<span class="badge">類似 '+esc(par.id)+'</span>':'')+(opt.seen?'<span class="badge">已抽過</span>':'')+'</div>'+
   (d.warn?'<div class="warn">'+esc(d.warn)+'</div>':'')+
   (d.alt&&d.alt.length?'<div class="small alts">線上類似：'+d.alt.map(function(a){return '<button type="button" class="lk" data-v="'+esc(a)+'">'+esc(a)+'</button>'}).join('　')+'</div>':'')+
   '<div class="row">'+(d.cat?'':'<button type="button" class="btn sm q">作答</button>')+'<button type="button" class="btn sm r">'+(opt.open?'隱藏答案':'顯示答案')+'</button>'+
   (d.cat?'':'<button type="button" class="btn sm warn v"></button>')+
   '<button type="button" class="btn sm nb">筆記<span class="cnt"></span></button>'+
   '<button type="button" class="btn sm primary sv2"'+(can?'':' disabled title="線上沒有這張"')+'>看片'+(vid!==id?' '+esc(vid):'')+'</button>'+
   (d.cat?'':'<button type="button" class="reset rp">回報答案錯誤</button>')+'</div>'+
   '<div class="fm f" hidden><label>診斷</label><input class="a-dx" autocomplete="off">'+
   (d.organ?'<label>器官</label><input class="a-og" autocomplete="off">':'')+(d.desc?'<label>描述（英文關鍵字，一行一點或用逗號分開）</label><textarea class="a-ds"></textarea>':'')+
   '<div class="row"><button type="button" class="btn sm primary g">批改</button></div></div>'+
   '<div class="res-w" hidden></div><div class="ans-w"'+(opt.open?'':' hidden')+'></div><div class="nt-w" hidden></div><div class="rp-w" hidden></div>';
  var q=e.querySelector('.q'),r=e.querySelector('.r'),v=e.querySelector('.v'),f=e.querySelector('.f'),rw=e.querySelector('.res-w'),aw=e.querySelector('.ans-w'),nw=e.querySelector('.nt-w'),pw=e.querySelector('.rp-w');
  e.querySelector('.sv2').onclick=function(){openView(vid)};
  e.querySelectorAll('.alts .lk').forEach(function(b){b.onclick=function(){openView(b.dataset.v)}});
  if(q)q.onclick=function(){f.hidden=!f.hidden;if(!f.hidden)f.querySelector('.a-dx').focus()};
  var obj={el:e,id:id,big:!!opt.big,opt:opt,
    upd:function(){if(v)v.textContent=P.review.indexOf(id)>=0?'移出複習':'加入複習';var n=(IMG[id]||[]).length,t=(U.notes[id]||'').trim()?1:0;e.querySelector('.cnt').textContent=(n||t)?' ('+(t?'整題':'')+(t&&n?'＋':'')+(n?n+' 圖':'')+')':''},
    ans:function(){if(!aw.hidden)renderAns(aw,id,obj)},
    notes:function(){if(!nw.hidden)renderNotes(nw,id,obj)}};
  r.onclick=function(){aw.hidden=!aw.hidden;r.textContent=aw.hidden?'顯示答案':'隱藏答案';obj.ans()};
  if(!d.cat)e.querySelector('.g').onclick=function(){rw.innerHTML=gradeHTML(id,f);rw.hidden=false};
  if(v)v.onclick=function(){toggleRev(id)};
  e.querySelector('.nb').onclick=function(){nw.hidden=!nw.hidden;if(!nw.hidden)renderNotes(nw,id,obj)};
  var rp=e.querySelector('.rp');if(rp)rp.onclick=function(){pw.hidden=!pw.hidden;if(!pw.hidden)renderReport(pw,id)};
  obj.upd();obj.ans();
  if(opt.notes){nw.hidden=false;renderNotes(nw,id,obj)}
  live.push(obj);return obj;
}
function refreshLive(id){live=live.filter(function(o){return document.body.contains(o.el)});live.forEach(function(o){if(!id||o.id===id){o.upd();o.ans()}})}

/* ---------- answer panel ---------- */
function renderAns(box,id,obj){
  var d=info(id),a=eff(id),pm=ptMap(id),keyOnly=obj&&obj.opt.keyOnly,hide=obj&&obj.opt.hide;
  var showOrig=box.dataset.orig==='1';
  if(showOrig)a={dx:d.dxfull,organ:d.organ,desc:d.desc,note:d.note,mine:false};
  var h='<div class="ans ansblk"><div><span class="lab">診斷'+(a.mine?'<span class="mine">我的版本</span>':'')+(showOrig?'<span class="mine">原始答案</span>':'')+'</span>'+lineHTML(a.dx,'dx',pm)+'</div>';
  if(a.organ)h+='<div><span class="lab">器官</span>'+fmt(a.organ)+'</div>';
  if(d.site)h+='<div><span class="lab">取材部位（線上片說明）</span>'+esc(d.site)+'</div>';
  if(!d.cat&&unitsOf(d).length)h+='<div><span class="lab">單元</span>'+esc(unitsOf(d).join('、'))+'</div>';
  if(a.desc){
    var lines=String(a.desc||'').split('\n');
    if(keyOnly)lines=lines.filter(function(l){return /^\s*\*/.test(l)||hasMark(l)});
    h+='<div><span class="lab">說明</span><div class="pre">'+(lines.map(function(l){return lineHTML(l,lineKey(l),pm)}).join('')||'<span class="small">（沒有標記的重點）</span>')+'</div></div>';
  }else if(!d.parent&&!d.cat)h+='<div><span class="lab">說明</span><span class="small">這張的描述答案還沒有（目前只有 Micro 1 有答案，其他會陸續補上）。</span></div>';
  if(a.note&&!keyOnly)h+='<div><span class="lab">備註</span><div class="pre">'+fmt(a.note)+'</div></div>';
  h+='</div><div class="row" style="margin-top:8px"><button type="button" class="btn sm ed">編輯我的版本</button>'+
    (a.mine||showOrig?'<button type="button" class="btn sm og">'+(showOrig?'看我的版本':'看原始答案')+'</button>':'')+
    (adm&&!d.cat?'<button type="button" class="btn sm warn ad">編輯總答案</button>':'')+'</div>'+
    (a.stale&&!showOrig?'<div class="tag">提醒：你編輯之後，原始答案有更新過，可以按「看原始答案」比對。</div>':'')+
    (ptsOf(id).length?'<div class="tag">有標「視野」的點可以點，看片視窗會移到那裡（「信心」是位置判讀的把握程度）。</div>':'')+
    (adm&&!d.cat?'<div class="admpt"></div>':'')+'<div class="edw"></div>';
  box.innerHTML=h;box.className='ans-w'+(hide?' hid':'');
  var blk=box.querySelector('.ansblk');
  if(hide)blk.onclick=function(){box.classList.remove('hid')};
  box.querySelectorAll('.ln.vw').forEach(function(n){n.onclick=function(ev){if(box.classList.contains('hid'))return;ev.stopPropagation();gotoPt(id,pm[n.dataset.k])}});
  box.querySelector('.ed').onclick=function(){editor(box.querySelector('.edw'),id,false)};
  var og=box.querySelector('.og');if(og)og.onclick=function(){box.dataset.orig=showOrig?'':'1';renderAns(box,id,obj)};
  var ad=box.querySelector('.ad');if(ad)ad.onclick=function(){showTab('adm');admForm(id)};
  var ap=box.querySelector('.admpt');if(ap)admPoints(ap,id,a);
}
function lineHTML(text,key,pm){var v=key&&pm[key];if(!String(text).trim())return '<div class="ln">&nbsp;</div>';
  return '<div class="ln'+(v?' vw':'')+'"'+(v?' data-k="'+esc(key)+'" title="在看片視窗移到這裡"':'')+'>'+fmt(text)+(v?'<span class="go">'+v.obj+'× 視野'+(v.conf?'・信心'+esc(v.conf):'')+'</span>':'')+'</div>'}

/* ---------- editor (personal or master) ---------- */
function editor(box,id,master){
  var d=info(id),a=master?{dx:d.dxfull,organ:d.organ,desc:d.desc}:eff(id);
  box.innerHTML='<div class="fm" style="margin-top:8px"><label>診斷</label><input class="e-dx"><label>器官</label><input class="e-og"><label>說明（一行一點；開頭 * = 必寫）</label>'+
    '<div class="tb"><button type="button" data-m="==">螢光</button><button type="button" data-m="__"><b>粗體</b></button><button type="button" data-m="">清除格式</button></div>'+
    '<textarea class="e-ds" style="min-height:12rem"></textarea><div class="row"><button type="button" class="btn sm primary sv">儲存</button><button type="button" class="btn sm cx">取消</button>'+
    (!master&&U.overrides[id]?'<button type="button" class="btn sm warn rs">刪除我的版本（回到原始答案）</button>':'')+'</div><div class="msg"></div></div>';
  var dx=box.querySelector('.e-dx'),og=box.querySelector('.e-og'),ds=box.querySelector('.e-ds');
  dx.value=a.dx||'';og.value=a.organ||'';ds.value=a.desc||'';
  var last=ds;[dx,og,ds].forEach(function(x){x.addEventListener('focus',function(){last=x})});
  box.querySelectorAll('.tb button').forEach(function(b){b.onmousedown=function(ev){ev.preventDefault()};b.onclick=function(){wrap(last,b.dataset.m)}});
  box.querySelector('.cx').onclick=function(){box.innerHTML=''};
  var rs=box.querySelector('.rs');if(rs)rs.onclick=function(){delete U.overrides[id];saveU('overrides',id);refreshLive(id)};
  box.querySelector('.sv').onclick=async function(){
    if(master){d.dxfull=dx.value.trim();d.organ=og.value.trim();d.desc=ds.value.replace(/\s+$/,'');await saveSlides(box.querySelector('.msg'));refreshLive(id);return}
    U.overrides[id]={dxfull:dx.value.trim(),organ:og.value.trim(),desc:ds.value.replace(/\s+$/,''),base:baseOf(d),at:Date.now()};
    saveU('overrides',id);refreshLive(id)};
}
function wrap(t,m){
  var s=t.selectionStart,e=t.selectionEnd,v=t.value;
  if(!m){var seg=v.slice(s,e);if(s===e){var ls=v.lastIndexOf('\n',s-1)+1,le=v.indexOf('\n',s);if(le<0)le=v.length;s=ls;e=le;seg=v.slice(s,e)}
    var c=strip(seg);t.value=v.slice(0,s)+c+v.slice(e);t.setSelectionRange(s,s+c.length);t.focus();return}
  if(s===e){t.focus();return}
  var sel=v.slice(s,e);
  if(v.slice(s-2,s)===m&&v.slice(e,e+2)===m){t.value=v.slice(0,s-2)+sel+v.slice(e+2);t.setSelectionRange(s-2,e-2)}
  else{t.value=v.slice(0,s)+m+sel+m+v.slice(e);t.setSelectionRange(s+2,e+2)}
  t.focus();
}

/* ---------- notes: whole-slide note + images with captions ---------- */
async function loadImgs(id){
  if(IMG[id])return IMG[id];
  var q=fb.fs.query(C('users',user.uid,'images'),fb.fs.where('slide','==',id));
  var s=await fb.fs.getDocs(q);var a=[];s.forEach(function(x){var y=x.data();a.push({id:x.id,data:y.data,w:y.w,h:y.h,at:y.at||0,note:y.note||'',view:y.view||null})});
  a.sort(function(p,q){return p.at-q.at});IMG[id]=a;return a;
}
async function addImg(id,c,view,msg){
  var doc={slide:id,data:c.data,w:c.w,h:c.h,at:Date.now(),note:''};if(view)doc.view=view;
  var ref=await fb.fs.addDoc(C('users',user.uid,'images'),doc);
  doc.id=ref.id;(IMG[id]=IMG[id]||[]).push(doc);
  live.forEach(function(o){if(o.id===id){o.upd();o.notes()}});
  if(msg)msg.textContent='已加入。';
}
function renderNotes(box,id,obj){
  box.innerHTML='<div class="fm"><label>整題筆記（只有自己看得到，會自動存）</label><textarea class="n-t"></textarea><div class="small n-s"></div>'+
    '<label>圖片＋附註（點圖片可以放大、寫附註）</label><div class="thumbs"></div>'+
    '<div class="row"><label class="btn sm" style="cursor:pointer">上傳圖片<input type="file" accept="image/*" multiple hidden class="n-f"></label>'+
    '<button type="button" class="btn sm n-c">從看片畫面擷取</button></div><div class="msg n-m"></div></div>';
  var t=box.querySelector('.n-t'),st=box.querySelector('.n-s'),tm=null;
  t.value=U.notes[id]||'';
  t.oninput=function(){st.textContent='儲存中…';clearTimeout(tm);tm=setTimeout(function(){var v=t.value;if(v.trim())U.notes[id]=v;else delete U.notes[id];saveU('notes',id);queue(function(){st.textContent='已儲存'});obj&&obj.upd()},700)};
  var th=box.querySelector('.thumbs'),msg=box.querySelector('.n-m');
  function draw(){
    var a=IMG[id]||[];th.innerHTML=a.length?'':'<span class="small">還沒有圖片。</span>';
    a.forEach(function(im){var w=el('div','tw');var b=el('button','th');b.type='button';b.title='放大';
      b.innerHTML='<img alt="">';b.querySelector('img').src=im.data;b.onclick=function(){openLB(id,im.id)};
      w.appendChild(b);if(im.note)w.appendChild(el('div','tcap',esc(im.note.length>40?im.note.slice(0,38)+'…':im.note)));th.appendChild(w)});
  }
  th.innerHTML='<span class="small">讀取中…</span>';
  loadImgs(id).then(function(){draw();obj&&obj.upd()},function(e){th.innerHTML='';msg.textContent='讀取圖片失敗：'+(e.code||e.message)});
  box.querySelector('.n-f').onchange=async function(ev){
    var files=[].slice.call(ev.target.files||[]);ev.target.value='';
    for(var i=0;i<files.length;i++){
      msg.textContent='壓縮第 '+(i+1)+' / '+files.length+' 張…';
      try{var c=await shrink(files[i]);await addImg(id,c,null,null)}catch(e){msg.textContent='第 '+(i+1)+' 張上傳失敗：'+(e.code||e.message||e);return}
    }
    msg.textContent='上傳完成。';
  };
  box.querySelector('.n-c').onclick=function(){captureFromViewer(id,msg)};
}
function loadImage(src){return new Promise(function(res,rej){var i=new Image();i.onload=function(){res(i)};i.onerror=function(){rej('這個檔案讀不出來（HEIC 請先轉成 JPG）')};i.src=src})}
/* compress hard: free storage is shared by everyone */
async function shrink(file){
  var url=typeof file==='string'?file:URL.createObjectURL(file);
  try{var im=await loadImage(url);var W=im.naturalWidth,H=im.naturalHeight,max=1400,q=.8;
    for(var k=0;k<10;k++){var s=Math.min(1,max/Math.max(W,H)),w=Math.round(W*s),h=Math.round(H*s);
      var c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);x.drawImage(im,0,0,w,h);
      var data=c.toDataURL('image/jpeg',q);if(data.length<400000)return {data:data,w:w,h:h};
      if(q>.55)q-=.08;else max=Math.round(max*.8)}
    throw '圖片太大，壓縮後仍超過上限';
  }finally{if(typeof file!=='string')URL.revokeObjectURL(url)}
}
/* lightbox: big image + caption (附註) */
var LB=null;
function openLB(id,imgId){
  var a=IMG[id]||[],i=a.findIndex(function(x){return x.id===imgId});if(i<0)return;
  LB={id:id,i:i};$('lb').hidden=false;document.body.style.overflow='hidden';showLB();
}
function showLB(){
  var a=IMG[LB.id]||[];if(!a.length){closeLB();return}LB.i=(LB.i+a.length)%a.length;var im=a[LB.i];
  $('lb-t').textContent=LB.id+'　圖 '+(LB.i+1)+' / '+a.length;$('lb-img').src=im.data;$('lb-n').value=im.note||'';$('lb-s').textContent='';
  $('lb-go').hidden=!im.view;$('lb-prev').hidden=$('lb-next').hidden=a.length<2;
  $('lb-del').textContent='刪除這張';$('lb-del').dataset.a='';
}
function closeLB(){$('lb').hidden=true;document.body.style.overflow='';LB=null}
(function(){
  var tm=null;
  $('lb-x').onclick=closeLB;
  $('lb-prev').onclick=function(){LB.i--;showLB()};$('lb-next').onclick=function(){LB.i++;showLB()};
  $('lb-n').oninput=function(){var lb=LB,im=IMG[lb.id][lb.i],v=$('lb-n').value.slice(0,3000);$('lb-s').textContent='儲存中…';clearTimeout(tm);
    tm=setTimeout(function(){im.note=v;queue(function(){return fb.fs.updateDoc(D('users',user.uid,'images',im.id),{note:v})}).then(function(){if(LB===lb)$('lb-s').textContent='已儲存';live.forEach(function(o){if(o.id===lb.id)o.notes()})})},600)};
  $('lb-go').onclick=function(){var im=IMG[LB.id][LB.i];if(im.view)gotoPt(LB.id,im.view,im.view.vid)};
  $('lb-del').onclick=async function(){var b=$('lb-del');if(b.dataset.a!=='1'){b.dataset.a='1';b.textContent='確定刪除？';return}
    var id=LB.id,im=IMG[id][LB.i];try{await fb.fs.deleteDoc(D('users',user.uid,'images',im.id));IMG[id]=IMG[id].filter(function(z){return z.id!==im.id});live.forEach(function(o){if(o.id===id){o.upd();o.notes()}});showLB()}catch(e){$('lb-s').textContent='刪除失敗：'+(e.code||e.message)}};
  document.addEventListener('keydown',function(e){if(!LB||e.target===$('lb-n'))return;if(e.key==='Escape')closeLB();else if(e.key==='ArrowLeft'){LB.i--;showLB()}else if(e.key==='ArrowRight'){LB.i++;showLB()}});
})();

/* ---------- report ---------- */
function renderReport(box,id){
  box.innerHTML='<div class="fm"><label>哪裡有錯？（會通知管理者，只有管理者看得到你的名字和內容）</label><textarea class="r-t" maxlength="1500"></textarea><div class="row"><button type="button" class="btn sm primary r-s">送出</button></div><div class="msg r-m"></div></div>';
  box.querySelector('.r-s').onclick=async function(){
    var t=box.querySelector('.r-t').value.trim(),m=box.querySelector('.r-m');if(!t){m.textContent='請寫一下哪裡有錯。';return}
    try{await fb.fs.addDoc(C('reports'),{slide:id,text:t,uid:user.uid,name:user.displayName||user.email||'',at:Date.now(),done:false});
      box.innerHTML='<div class="msg">已送出，謝謝。</div>'}catch(e){m.textContent='送出失敗：'+(e.code||e.message)}};
}

/* ---------- slide viewer bridge (microteaching + bookmarklet) ---------- */
var VW=null,WANT='',CAPQ={};
function bmCode(){return 'javascript:(function(d){var s=d.createElement("script");s.src="https://'+HOME+'/h.js?"+Date.now();d.body.appendChild(s)})(document)'}
function alive(w){try{return w&&!w.closed}catch(e){return false}}
function viewHref(vid,go){return VIEWURL+'?pd='+encodeURIComponent(vid)+(go&&go.x!=null?'&x='+Math.round(go.x)+'&y='+Math.round(go.y)+'&o='+(go.obj||40):'')}
var VWIN=null;
function openView(vid,go){
  if(!isOnline(vid)){note(vid+' 線上沒有，只能看實體片。');return}
  WANT=vid;
  var msg={t:'open',id:vid};if(go&&go.x!=null){msg.x=go.x;msg.y=go.y;msg.obj=go.obj}
  if(VW&&alive(VW.win)){sendVW(msg);try{VW.win.focus()}catch(e){}note(VW.id===vid&&!(go&&go.x!=null)?'看片視窗已經是 '+vid+'。':'看片視窗換到 '+vid+(go&&go.x!=null?'，移到 '+go.obj+'× 視野':'')+'。');return}
  /* the viewer tab may still be open from before (e.g. after this page reloaded): ask it first, else load the slide there */
  var w=null;try{w=window.open('','pdview')}catch(e){}
  if(!w){note('看片視窗被瀏覽器擋住了，請允許這個網站開新視窗。');return}
  VWIN=w;var asked=Date.now(),fresh=false;
  try{fresh=w.location.href==='about:blank'}catch(e){}
  if(fresh){w.location.href=viewHref(vid,go);viewNote(vid);return}
  try{w.postMessage({pd:1,t:'hi'},VIEW_ORIGIN)}catch(e){}
  setTimeout(function(){
    if(VW&&alive(VW.win)&&VW.win===w&&VW.at>=asked){sendVW(msg);try{w.focus()}catch(e){};return}
    try{w.location.href=viewHref(vid,go)}catch(e){window.open(viewHref(vid,go),'pdview')}
    viewNote(vid);
  },700);
}
function viewNote(vid){
    note((MOBILE?'手機不適合看片，建議用電腦。':'')+'已開看片分頁（要校內網路或台大 VPN）。在那個分頁按一次書籤「抽號器看片」就會開 '+vid+'，之後按「看片」或答案的視野點都會直接在那個分頁換片。第一次用請先到「看片設定」裝書籤。');
}
function sendVW(m){if(!VW||!alive(VW.win))return false;m.pd=1;try{VW.win.postMessage(m,VIEW_ORIGIN);return true}catch(e){return false}}
function gotoPt(id,p,vidOverride){
  var vid=vidOverride||viewId(id);
  if(VW&&alive(VW.win)&&VW.id===vid){sendVW({t:'goto',x:p.x,y:p.y,obj:p.obj});try{VW.win.focus()}catch(e){}note(PANEL?'':'已移到 '+p.obj+'× 視野，請切到看片分頁。');return}
  openView(vid,{x:p.x,y:p.y,obj:p.obj});
}
function captureFromViewer(id,msg){
  var vid=viewId(id);
  if(!VW||!alive(VW.win)){msg.textContent='先按「看片」開這張（第一次要在看片分頁按書籤「抽號器看片」）。';return}
  if(VW.id!==vid&&VW.id!==id){msg.textContent='看片視窗現在是 '+VW.id+'，不是 '+vid+'。';return}
  var req=Math.random().toString(36).slice(2);CAPQ[req]={id:id,msg:msg};msg.textContent='擷取中…';
  if(!sendVW({t:'cap',req:req}))msg.textContent='連不到看片視窗。';
  setTimeout(function(){if(CAPQ[req]){delete CAPQ[req];msg.textContent='看片分頁沒有回應，請在看片分頁再按一次書籤。'}},8000);
}
/* the panel/app keeps the slide id the viewer reports, and which quiz slide it belongs to */
function slideForView(vid){var hit=null;SL.forEach(function(d){if(!hit&&d.view===vid)hit=d.id});if(!hit&&BY[vid])hit=vid;return hit||vid}
window.addEventListener('message',async function(ev){
  var m=ev.data;if(!m||m.pd!==1)return;
  if((ev.origin===LIST_ORIGIN||ev.origin===VIEW_ORIGIN)&&m.t==='want'){try{ev.source.postMessage({pd:1,t:'want-r',id:WANT},ev.origin)}catch(e){}return}
  if(ev.origin!==VIEW_ORIGIN)return;
  var vid=String(m.id||'').toUpperCase().replace(/[^A-Z0-9_]/g,'');
  if(m.t==='hello'||m.t==='view'){
    var isNew=!VW||VW.win!==ev.source||VW.id!==vid;
    VW={win:ev.source,id:vid,x:+m.x,y:+m.y,obj:+m.obj,at:Date.now()};
    if(m.t==='hello'&&!PANEL&&isNew)note('已連上看片分頁（'+vid+'）。答案裡標「視野」的點可以直接點。');
    if(isNew&&PANEL&&user)renderPanel();
    if(PANEL){var s=$('pn-pos');if(s)s.textContent='目前：'+VW.obj+'× 視野　中心 ('+VW.x+', '+VW.y+')'}
    return;
  }
  if(m.t==='cap'&&user){
    var q=m.req&&CAPQ[m.req];if(m.req)delete CAPQ[m.req];
    if(m.err){if(q)q.msg.textContent=m.err;return}
    if(typeof m.data!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/.test(m.data)||m.data.length>990000)return;
    var id=q?q.id:slideForView(vid);
    try{var c=m.data.length<400000?{data:m.data,w:+m.w||0,h:+m.h||0}:await shrink(m.data);
      await addImg(id,c,{vid:vid,x:Math.round(+m.x)||0,y:Math.round(+m.y)||0,obj:FIELD[+m.obj]?+m.obj:4},q&&q.msg);
      if(!q)note('已把擷取的視野存進 '+id+' 的筆記。');
    }catch(e){var t='存圖失敗：'+(e.code||e.message||e);if(q)q.msg.textContent=t;else note(t)}
  }
});

/* ---------- panel mode: one slide beside the viewer ---------- */
function renderPanel(){
  document.body.classList.add('panel');
  var vid=VW?VW.id:PANEL,id=slideForView(vid);
  var box=$('panel');box.hidden=false;box.innerHTML='';
  var c=CBY[vid];
  box.appendChild(el('div','small','看片：<b>'+esc(vid)+'</b>'+(c&&c.n?'（實體 '+esc(c.n)+' 號）':'')+(c?'　'+esc(c.dx||c.pdx):'')+'<div id="pn-pos"></div>'));
  if(!VW)box.appendChild(el('div','notice','還沒連上看片視窗。請在看片畫面按書籤「抽號器看片」。'));
  var o=mk(id,{open:true,notes:true});box.appendChild(o.el);
  if(id!==vid&&info(id))box.appendChild(el('div','small','這張看片 '+esc(vid)+' 對應抽號器的 '+esc(id)+'。'));
}
if(PANEL&&window.opener){try{window.opener.postMessage({pd:1,t:'hi'},VIEW_ORIGIN)}catch(e){}}

/* ---------- admin: set answer points from the current viewer field ---------- */
function admPoints(box,id,a){
  var keys=[['dx','診斷（整體）']].concat(String(a.desc||'').split('\n').filter(function(l){return l.trim()}).map(function(l){return [lineKey(l),lineKey(l)]}));
  var pm=ptMap(id);
  box.innerHTML='<div class="rep"><b>答案視野（管理）</b><div class="small">在看片視窗移到要的位置和倍率，再按「存目前視野」。</div>'+
    '<select class="ap-k">'+keys.map(function(k){return '<option value="'+esc(k[0])+'">'+(pm[k[0]]?'● ':'')+esc(k[1].length>60?k[1].slice(0,58)+'…':k[1])+'</option>'}).join('')+'</select>'+
    '<div class="row"><select class="ap-c"><option>高</option><option selected>中</option><option>低</option></select><input class="inp ap-n" placeholder="說明（可空白）"></div>'+
    '<div class="row"><button type="button" class="btn sm primary ap-s">存目前視野</button><button type="button" class="btn sm warn ap-d">刪除這點</button></div><div class="msg ap-m"></div></div>';
  var k=box.querySelector('.ap-k'),m=box.querySelector('.ap-m');
  function sync(){var p=pm[k.value];box.querySelector('.ap-c').value=p&&p.conf||'中';box.querySelector('.ap-n').value=p&&p.note||''}
  k.onchange=sync;sync();
  box.querySelector('.ap-s').onclick=async function(){
    if(!VW||!alive(VW.win)){m.textContent='沒有連上看片視窗。';return}
    if(VW.id!==viewId(id)){m.textContent='看片視窗是 '+VW.id+'，不是 '+viewId(id)+'。';return}
    var f=FLD[id]=FLD[id]||{pts:[]};f.vid=viewId(id);
    f.pts=(f.pts||[]).filter(function(p){return p.k!==k.value}).concat([{k:k.value,x:VW.x,y:VW.y,obj:VW.obj,conf:box.querySelector('.ap-c').value,note:box.querySelector('.ap-n').value.trim().slice(0,300)}]);
    await saveFields(id);refreshLive(id)};
  box.querySelector('.ap-d').onclick=async function(){var f=FLD[id];if(!f)return;f.pts=(f.pts||[]).filter(function(p){return p.k!==k.value});await saveFields(id);refreshLive(id)};
}
async function saveFields(id){var o={};o[id]=FLD[id];try{await fb.fs.setDoc(D('content','fields'),o,{merge:true});note('答案視野已儲存。')}catch(e){note('儲存失敗：'+(e.code||e.message))}}

/* ---------- review list / lists ---------- */
function toggleRev(id){
  var i=P.review.indexOf(id);
  if(i>=0){P.review.splice(i,1);var k=P.rseen.indexOf(id);if(k>=0)P.rseen.splice(k,1)}else P.review.push(id);
  saveP();counts();refreshLive();if(tab==='rev')listRev();if(pool==='rev')progress();
}
function counts(){var s=P.seen.filter(inUnits).length,r=P.review.filter(inUnits).length;$('sc').textContent=s;$('rc').textContent=r;$('rc2').textContent=r}
function fill(box,ids,empty,opt){
  box.innerHTML='';ids=ids.filter(inUnits).sort(byNum);
  if(!ids.length){box.innerHTML='<div class="empty">'+empty+'</div>';return}
  ids.forEach(function(id){box.appendChild(mk(id,opt).el)});
}
function listSeen(){fill($('l-seen'),P.seen,'還沒有抽過的片子。')}
function listRev(){fill($('l-rev'),P.review,'複習清單是空的。在任何一張片子按「加入複習」。',{open:true,notes:true,keyOnly:rvKey,hide:rvHide})}

/* ---------- draw ---------- */
function poolIds(){return (pool==='all'?SL.map(function(d){return d.id}):P.review.slice()).filter(function(x){return inUnits(x)&&(P.alt||!BY[x].parent)})}
function seenArr(){return pool==='all'?P.seen:P.rseen}
function progress(){var p=poolIds(),sa=seenArr(),s=p.filter(function(x){return sa.indexOf(x)>=0}).length;
  $('prog').textContent='已抽 '+s+' / '+p.length+'（'+(P.units?selUnits().join('、'):'全部分類')+'）';$('barfill').style.width=(p.length?s/p.length*100:0)+'%';$('altc').checked=P.alt}
function draw(){
  var p=poolIds();$('msg').textContent='';
  if(!p.length){$('msg').textContent=pool==='rev'?'這個分類的複習清單是空的。':'這個分類沒有片子。';return}
  var seen=seenArr(),lk=pool==='all'?'last':'rlast';
  var c=p.filter(function(x){return seen.indexOf(x)<0});
  if(!c.length){c=p.slice();$('msg').textContent='全部都抽過了，現在隨機重複。'}
  var nl=c.filter(function(x){return x!==P[lk]});if(nl.length)c=nl;
  var id=c[Math.floor(Math.random()*c.length)],was=seen.indexOf(id)>=0;
  if(!was)seen.push(id);if(pool==='rev'&&P.seen.indexOf(id)<0)P.seen.push(id);
  P[lk]=id;saveP();counts();progress();
  $('slot').innerHTML='';$('slot').appendChild(mk(id,{big:true,seen:was}).el);
}
function setPool(p){pool=p;$('p-all').setAttribute('aria-pressed',p==='all');$('p-rev').setAttribute('aria-pressed',p==='rev');$('msg').textContent='';progress();
  $('slot').innerHTML='<div class="empty">'+(p==='all'?'按「抽下一張」開始。沒抽過的片子會先出現。':(P.review.filter(inUnits).length?'按「抽下一張」開始複習。':'這個分類的複習清單是空的。'))+'</div>'}

/* ---------- grading (approximate) ---------- */
function norm(s){return strip(s).toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()}
function stem(w){return w.length>4?w.replace(/(es|s)$/,''):w}
function lev(a,b){var m=a.length,n=b.length;if(!m)return n;if(!n)return m;var p=[];for(var j=0;j<=n;j++)p[j]=j;
  for(var i=1;i<=m;i++){var c=[i];for(j=1;j<=n;j++)c[j]=Math.min(p[j]+1,c[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=c}return p[n]}
function sim(a,b){var m=Math.max(a.length,b.length);return m?1-lev(a,b)/m:1}
function tokHit(t,tokens){t=stem(t);return tokens.some(function(u){u=stem(u);return u===t||(t.length>=6&&u.length>=6&&lev(t,u)<=2)||(t.length>=4&&u.length>=4&&lev(t,u)<=1)||(t.length>=8&&u.length>=8&&t.slice(0,7)===u.slice(0,7))})}
function segs(text){return strip(text).split(/[;,()\/]|\bor\b/i).map(norm).filter(function(x){return x&&!/^\d+$/.test(x)}).concat([norm(text)])}
function matchField(ans,texts){
  var a=norm(ans);if(!a)return false;var at=a.split(' ');
  return [].concat(texts).filter(Boolean).some(function(text){return segs(text).some(function(sg){
    if(sim(a,sg)>=0.8)return true;
    var w=uniq(sg.split(' ').filter(function(x){return x.length>=3}));
    return w.length>0&&w.every(function(x){return tokHit(x,at)})})});
}
var STOP={};'with and the of in or to by for from that this are not may also slide some more less than their into only most both each other'.split(' ').forEach(function(w){STOP[w]=1});
function gradeHTML(id,f){
  var d=info(id),a=eff(id),val=function(c){var e=f.querySelector(c);return e?e.value:''};
  var mark=function(ok,label,right){return '<div><span class="'+(ok?'ok':'no')+'">'+(ok?'✓ ':'✗ ')+label+'</span>　正確：'+fmt(right)+'</div>'};
  var h='<div class="res">'+mark(matchField(val('.a-dx'),[d.dx,a.dx]),'診斷',a.dx);
  if(f.querySelector('.a-og'))h+=mark(matchField(val('.a-og'),[d.organ,a.organ]),'器官',a.organ);
  if(f.querySelector('.a-ds')){
    var raw=val('.a-ds'),at=norm(raw).split(' ').filter(Boolean);
    var lines=String(a.desc||'').split('\n').map(function(l){return l.replace(/^\s*\*/,'').trim()}).filter(Boolean);
    var ltoks=[],n=0;
    var body=lines.map(function(l){
      var toks=norm(l).split(' ').filter(function(w){return w.length>=3&&!STOP[w]});ltoks.push.apply(ltoks,toks);
      var big=toks.filter(function(w){return w.length>=4}),m=big.filter(function(w){return tokHit(w,at)});
      var ok=m.length>=2||(m.length===1&&m[0].length>=8)||(big.length===1&&m.length===1);if(ok)n++;
      return '<div>'+(ok?'<span class="ok">✓ </span>':'　')+fmt(l)+'</div>'}).join('');
    h+='<div class="lab" style="margin-top:6px">描述（✓ = 有寫到，關鍵字比對僅供參考）　'+n+' / '+lines.length+'</div><div class="ptl pre">'+body+'</div>';
    var extra=raw.split(/[\n;,，；]+/).map(function(x){return x.trim()}).filter(function(x){
      var pt=norm(x).split(' ').filter(function(w){return w.length>=3&&!STOP[w]});return pt.length&&!pt.some(function(w){return tokHit(w,ltoks)})});
    if(extra.length)h+='<div class="lab" style="margin-top:6px">未判定（說明裡找不到對應）</div><div class="ptl pre">'+extra.map(esc).join('\n')+'</div>';
  }
  return h+'</div>';
}

/* ---------- catalog (片庫) ---------- */
function unitTags(id){var t=[];SL.forEach(function(d){if(d.id===id||d.view===id)t=t.concat(unitsOf(d).map(function(u){return d.parent?u+'（類似）':u}))});return uniq(t)}
function listCat(){
  var q=$('c-q').value.trim().toLowerCase(),only=$('c-sem').checked,box=$('l-cat');box.innerHTML='';
  var rows=CAT.filter(function(c){var tg=unitTags(c.id);c._t=tg;if(only&&!tg.length)return false;
    return !q||(c.id+' '+c.n+' '+c.dx+' '+c.pdx+' '+tg.join(' ')).toLowerCase().indexOf(q)>=0});
  $('c-n').textContent=rows.length+' 張';
  if(!rows.length){box.innerHTML='<div class="empty">找不到。</div>';return}
  var tb=el('table','cat');tb.innerHTML='<thead><tr><th>實體</th><th>線上片號</th><th>是什麼</th><th></th></tr></thead>';
  var bd=el('tbody');
  rows.slice(0,400).forEach(function(c){
    var tr=el('tr',null,'<td>'+esc(c.n||'—')+'</td><td>'+esc(c.id)+(c.on?'':'<br><span class="small">線上沒有</span>')+'</td><td>'+esc(c.dx||c.pdx)+
      (c.pdx&&c.dx&&norm(c.pdx)!==norm(c.dx.split(';')[0])?'<div class="small">片單：'+esc(c.pdx)+'</div>':'')+
      (c._t.length?'<div class="small">'+esc(c._t.join('、'))+'</div>':'')+'</td><td><button type="button" class="btn sm">打開</button></td>');
    tr.querySelector('button').onclick=function(){var nx=tr.nextSibling;if(nx&&nx.classList.contains('exp')){nx.remove();return}
      var x=el('tr','exp'),td=el('td');td.colSpan=4;td.appendChild(mk(c.id,{}).el);x.appendChild(td);tr.after(x)};
    bd.appendChild(tr)});
  tb.appendChild(bd);box.appendChild(tb);
}

/* ---------- export (Word) ---------- */
function listExp(){
  var box=$('l-exp');box.innerHTML='';
  var ids=uniq(Object.keys(U.notes).concat(Object.keys(U.overrides)).concat(SL.filter(function(d){return inUnits(d.id)}).map(function(d){return d.id}))).filter(function(id){return info(id)}).sort(byNum);
  if(!ids.length){box.innerHTML='<div class="empty">沒有片子。</div>';return}
  ids.forEach(function(id){var d=info(id),has=(U.notes[id]||'').trim()||U.overrides[id];
    var r=el('label','xr','<input type="checkbox" value="'+esc(id)+'"'+(has?' checked':'')+'> <b>'+esc(d.n?d.n+'－':'')+esc(id)+'</b>　'+esc(strip(eff(id).dx))+(has?' <span class="small">（有筆記／修改）</span>':''));box.appendChild(r)});
}
async function doExport(){
  var ids=[].slice.call($('l-exp').querySelectorAll('input:checked')).map(function(x){return x.value});
  var m=$('x-m');if(!ids.length){m.textContent='請先勾選片子。';return}
  m.textContent='準備中…';
  try{
    var all={};var s=await fb.fs.getDocs(C('users',user.uid,'images'));s.forEach(function(x){var y=x.data();if(ids.indexOf(y.slide)>=0)(all[y.slide]=all[y.slide]||[]).push({data:y.data,w:y.w,h:y.h,at:y.at||0,note:y.note||''})});
    var items=ids.map(function(id){var d=info(id),a=eff(id);return {n:d.n||'',id:id,dx:strip(d.dxfull),a:a,note:U.notes[id]||'',imgs:(all[id]||[]).sort(function(p,q){return p.at-q.at})}});
    var blob=await buildDocx(items);
    var url=URL.createObjectURL(blob),x=el('a');x.href=url;x.download='病理筆記-'+new Date().toISOString().slice(0,10)+'.docx';document.body.appendChild(x);x.click();x.remove();
    setTimeout(function(){URL.revokeObjectURL(url)},30000);m.textContent='已匯出 '+ids.length+' 張。';
  }catch(e){m.textContent='匯出失敗：'+(e.code||e.message||e)}
}
/* minimal .docx writer: 中文標楷體、英文 Times New Roman */
var CRC=(function(){var t=[];for(var n=0;n<256;n++){var c=n;for(var k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})();
function crc32(u){var c=0xFFFFFFFF;for(var i=0;i<u.length;i++)c=CRC[(c^u[i])&255]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
function zip(files){
  var enc=new TextEncoder(),parts=[],cd=[],off=0;
  files.forEach(function(f){var name=enc.encode(f.name),data=typeof f.data==='string'?enc.encode(f.data):f.data,crc=crc32(data);
    var h=new DataView(new ArrayBuffer(30));h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint16(8,0,true);h.setUint16(12,0x21,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);
    parts.push(h.buffer,name,data);
    var c=new DataView(new ArrayBuffer(46));c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint16(14,0x21,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,off,true);
    cd.push(c.buffer,name);off+=30+name.length+data.length});
  var cdl=cd.reduce(function(s,b){return s+(b.byteLength||b.length)},0),e=new DataView(new ArrayBuffer(22));
  e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,cdl,true);e.setUint32(16,off,true);
  return new Blob(parts.concat(cd,[e.buffer]),{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
function xe(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]}).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g,'')}
function runs(text,base){ /* ==highlight== and __bold__ */
  var out='',re=/==([^=\n]+?)==|__([^_\n]+?)__/g,i=0,m;base=base||'';
  function r(t,pr){return t?'<w:r><w:rPr>'+base+pr+'</w:rPr><w:t xml:space="preserve">'+xe(t)+'</w:t></w:r>':''}
  while((m=re.exec(text))){out+=r(text.slice(i,m.index),'');out+=m[1]!=null?r(m[1],'<w:highlight w:val="yellow"/>'):r(m[2],'<w:b/>');i=m.index+m[0].length}
  return out+r(text.slice(i),'');
}
function para(text,o){o=o||{};return '<w:p><w:pPr>'+(o.sp?'<w:spacing w:before="'+o.sp+'"/>':'')+(o.ind?'<w:ind w:left="'+o.ind+'"/>':'')+'</w:pPr>'+runs(text,(o.b?'<w:b/>':'')+(o.sz?'<w:sz w:val="'+o.sz+'"/><w:szCs w:val="'+o.sz+'"/>':'')+(o.c?'<w:color w:val="'+o.c+'"/>':''))+'</w:p>'}
function b64bytes(d){var s=atob(d.split(',')[1]),u=new Uint8Array(s.length);for(var i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u}
async function buildDocx(items){
  var media=[],rels=[],body='',rid=10,pic=1;
  body+=para('病理筆記',{b:1,sz:32})+para('匯出日期：'+new Date().toLocaleDateString('zh-TW'),{c:'666666'});
  items.forEach(function(it,ix){
    body+=para((it.n?'實體 '+it.n+'　':'')+it.id+'　'+it.dx,{b:1,sz:28,sp:ix?360:240});
    body+=para('答案'+(it.a.mine?'（我修改過的版本）':''),{b:1,c:'4A3A78',sp:120});
    body+=para('診斷：'+it.a.dx,{ind:240});
    if(it.a.organ)body+=para('器官：'+it.a.organ,{ind:240});
    String(it.a.desc||'').split('\n').forEach(function(l){if(l.trim())body+=para(l,{ind:240})});
    if(it.note.trim()){body+=para('整題筆記',{b:1,c:'4A3A78',sp:120});it.note.split('\n').forEach(function(l){body+=para(l,{ind:240})})}
    if(it.imgs.length){body+=para('圖片與附註',{b:1,c:'4A3A78',sp:120});
      it.imgs.forEach(function(im){
        var name='image'+pic+'.jpeg',id='rId'+(rid++),n=pic++,w=im.w||800,h=im.h||600,cx=Math.round(Math.min(4114800,w*9525)),cy=Math.round(cx*h/w);
        if(cy>6400800){cx=Math.round(cx*6400800/cy);cy=6400800}
        media.push({name:'word/media/'+name,data:b64bytes(im.data)});rels.push('<Relationship Id="'+id+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/'+name+'"/>');
        body+='<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:docPr id="'+n+'" name="Picture '+n+'"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="'+n+'" name="'+name+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="'+id+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
        if(im.note.trim())im.note.split('\n').forEach(function(l){body+=para(l,{c:'333333'})});
      })}
  });
  var NS='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  var doc='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document '+NS+'><w:body>'+body+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>';
  var font='<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="標楷體" w:cs="Times New Roman"/>';
  var styles='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>'+font+'<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-TW"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr>'+font+'</w:rPr></w:style></w:styles>';
  var files=[
    {name:'[Content_Types].xml',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'},
    {name:'_rels/.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'},
    {name:'word/_rels/document.xml.rels',data:'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+rels.join('')+'</Relationships>'},
    {name:'word/document.xml',data:doc},{name:'word/styles.xml',data:styles}].concat(media);
  return zip(files);
}
window.__buildDocx=buildDocx;  /* used by tests */

/* ---------- admin ---------- */
async function saveSlides(msg){
  try{await fb.fs.setDoc(D('content','slides'),{list:SL,at:Date.now()});if(msg)msg.textContent='已儲存，所有人重新整理後就會看到。';return true}
  catch(e){if(msg)msg.textContent='儲存失敗：'+(e.code||e.message);return false}
}
async function loadReports(){
  try{var s=await fb.fs.getDocs(fb.fs.query(C('reports'),fb.fs.where('done','==',false)));REPORTS=[];
    s.forEach(function(x){var y=x.data();y._id=x.id;REPORTS.push(y)});REPORTS.sort(function(a,b){return b.at-a.at})}catch(e){REPORTS=[]}
  $('rdot').hidden=!REPORTS.length;if(tab==='adm')renderAdmin();
}
function renderAdmin(){
  var gt=$('a-grp');if(gt&&document.activeElement!==gt)gt.value=((META.groups&&META.groups.length)?META.groups:DEFGROUPS).map(function(g){return g.name+': '+g.units.join(', ')}).join('\n');
  var r=$('a-rep');r.innerHTML=REPORTS.length?'':'<div class="empty">沒有未處理的回報。</div>';
  REPORTS.forEach(function(x){var b=el('div','rep','<div><b>'+esc(x.slide)+'</b>　<span class="small">'+esc(x.name)+'・'+new Date(x.at).toLocaleString('zh-TW')+'</span></div><div class="pre">'+esc(x.text)+'</div><div class="row"><button type="button" class="btn sm go2">打開這張編輯</button><button type="button" class="btn sm warn dn">標為已處理</button></div>');
    b.querySelector('.go2').onclick=function(){if(BY[x.slide])admForm(x.slide)};
    b.querySelector('.dn').onclick=async function(){try{await fb.fs.updateDoc(D('reports',x._id),{done:true});loadReports()}catch(e){note('更新失敗：'+(e.code||e.message))}};
    r.appendChild(b)});
  admList();
}
function admList(){
  var q=$('a-q').value.trim().toLowerCase(),box=$('a-list');box.innerHTML='';
  SL.filter(function(d){return !q||(d.id+' '+d.dxfull+' '+unitsOf(d).join(' ')).toLowerCase().indexOf(q)>=0}).slice().sort(function(a,b){return byNum(a.id,b.id)}).forEach(function(d){
    var b=el('div','it','<div class="row" style="justify-content:space-between;align-items:center"><div><b>'+esc(d.id)+'</b> <span class="small">'+(d.n?'('+esc(d.n)+')':'線上')+'・'+esc(unitsOf(d).join('、'))+(d.parent?'・類似 '+esc(d.parent):'')+(ptsOf(d.id).length?'・'+ptsOf(d.id).length+' 個視野':'')+(d.desc||d.parent?'':'・<span class="no">缺描述</span>')+'</span><div>'+esc(d.dxfull)+'</div></div><button type="button" class="btn sm">編輯</button></div>');
    b.querySelector('button').onclick=function(){admForm(d.id)};
    box.appendChild(b)});
}
function admForm(id){
  var isNew=!id,d=isNew?{id:'',n:'',units:P.units||[allUnits()[0]||''],dxfull:'',dx:'',organ:'',desc:'',note:'',view:'',alt:[],warn:'',parent:''}:BY[id];
  var box=$('a-form');
  var F=[['id','片號（例 PA0400）'],['n','實體片號碼（空白 = 線上片）'],['units','分類（多個用逗號分開，例 Respiratory system, Infection）'],['dxfull','診斷全文（顯示用）'],['dx','診斷關鍵字（批改用，空白 = 同上）'],['organ','器官'],['view','看片用的線上片號（空白 = 同片號）'],['alt','線上類似片（逗號分開）'],['parent','是哪一張的類似片（空白 = 不是）'],['warn','提醒（顯示在片號下面）']];
  box.innerHTML='<div class="fm rep"><b>'+(isNew?'新增片子':'編輯 '+esc(id))+'</b>'+F.map(function(x){return '<label>'+x[1]+'</label><input data-k="'+x[0]+'">'}).join('')+
    '<label>說明（一行一點；開頭 * = 必寫）</label><div class="tb"><button type="button" data-m="==">螢光</button><button type="button" data-m="__"><b>粗體</b></button><button type="button" data-m="">清除格式</button></div><textarea data-k="desc" style="min-height:12rem"></textarea>'+
    '<label>備註</label><textarea data-k="note"></textarea>'+
    '<div class="row"><button type="button" class="btn sm primary sv">儲存</button><button type="button" class="btn sm cx">關閉</button>'+(isNew?'':'<button type="button" class="btn sm warn del">刪除這張</button>')+'</div><div class="msg"></div></div>';
  box.querySelectorAll('[data-k]').forEach(function(x){var k=x.dataset.k,v=d[k];x.value=k==='units'?unitsOf(d).join(', '):k==='alt'?(v||[]).join(', '):(v||'')});
  var ds=box.querySelector('[data-k=desc]');
  box.querySelectorAll('.tb button').forEach(function(b){b.onmousedown=function(ev){ev.preventDefault()};b.onclick=function(){wrap(ds,b.dataset.m)}});
  var msg=box.querySelector('.msg');
  box.querySelector('.cx').onclick=function(){box.innerHTML=''};
  box.querySelector('.sv').onclick=async function(){
    var o={};box.querySelectorAll('[data-k]').forEach(function(x){o[x.dataset.k]=x.dataset.k==='desc'||x.dataset.k==='note'?x.value.replace(/\s+$/,''):x.value.trim()});
    o.id=o.id.toUpperCase();if(!/^[A-Z0-9_-]{3,20}$/.test(o.id)){msg.textContent='片號格式不對。';return}
    if(!o.dxfull){msg.textContent='請填診斷。';return}
    if(!o.dx)o.dx=o.dxfull;
    o.units=o.units.split(/[,，]/).map(function(s){return s.trim()}).filter(Boolean);if(!o.units.length)o.units=['未分類'];o.unit=o.units[0];
    o.alt=o.alt.split(/[,，\s]+/).map(function(s){return s.trim().toUpperCase()}).filter(Boolean);
    o.view=o.view.toUpperCase();o.parent=o.parent.toUpperCase();['view','parent','warn'].forEach(function(k){if(!o[k])delete o[k]});
    if(!isNew&&d.site)o.site=d.site;
    if((isNew||o.id!==id)&&BY[o.id]){msg.textContent=o.id+' 已經存在。';return}
    var backup=SL.slice();
    if(isNew)SL.push(o);else SL[SL.indexOf(d)]=o;
    BY={};SL.forEach(function(x){BY[x.id]=x});
    if(await saveSlides(msg)){renderUnits();admList();renderAll();if(isNew||o.id!==id)admForm(o.id)}
    else{SL=backup;BY={};SL.forEach(function(x){BY[x.id]=x})}
  };
  var del=box.querySelector('.del');if(del)del.onclick=async function(){
    if(del.dataset.a!=='1'){del.dataset.a='1';del.textContent='再按一次確認刪除';return}
    var backup=SL.slice();SL=SL.filter(function(x){return x.id!==id});BY={};SL.forEach(function(x){BY[x.id]=x});
    if(await saveSlides(msg)){box.innerHTML='';renderUnits();admList();renderAll()}else{SL=backup;BY={};SL.forEach(function(x){BY[x.id]=x})}};
  box.scrollIntoView({behavior:'smooth',block:'start'});
}

/* ---------- chrome ---------- */
var TABS=['draw','seen','rev','cat','exp','set','adm'];
function showTab(t){
  if(t==='adm'&&!adm)t='draw';
  tab=t;TABS.forEach(function(k){$('t-'+k).setAttribute('aria-selected',k===t);$('v-'+k).hidden=k!==t});
  if(t==='seen')listSeen();if(t==='rev')listRev();if(t==='adm')renderAdmin();if(t==='cat')listCat();if(t==='exp')listExp();
}
function renderAll(){counts();progress();if(tab==='seen')listSeen();if(tab==='rev')listRev();if(tab==='cat')listCat();if(tab==='exp')listExp();refreshLive()}
TABS.forEach(function(k){$('t-'+k).onclick=function(){showTab(k)}});
$('draw').onclick=draw;
$('p-all').onclick=function(){setPool('all')};$('p-rev').onclick=function(){setPool('rev')};
$('altc').onchange=function(){P.alt=$('altc').checked;saveP();progress()};
$('rv-show').onclick=function(){rvHide=false;$('rv-show').setAttribute('aria-pressed',true);$('rv-hide').setAttribute('aria-pressed',false);listRev()};
$('rv-hide').onclick=function(){rvHide=true;$('rv-show').setAttribute('aria-pressed',false);$('rv-hide').setAttribute('aria-pressed',true);listRev()};
$('rv-key').onclick=function(){rvKey=!rvKey;$('rv-key').setAttribute('aria-pressed',rvKey);listRev()};
$('a-grp-s').onclick=async function(){var m=$('a-grp-m'),known=allUnits(),bad=[];
  var G=$('a-grp').value.split('\n').map(function(l){var i=l.search(/[:：]/);if(i<0)return null;var name=l.slice(0,i).trim(),u=l.slice(i+1).split(/[,，]/).map(function(x){return x.trim()}).filter(Boolean);u.forEach(function(x){if(known.indexOf(x)<0)bad.push(x)});return name&&u.length?{name:name,units:u}:null}).filter(Boolean);
  if(bad.length){m.textContent='找不到這些單元：'+bad.join('、');return}
  try{await fb.fs.setDoc(D('content','meta'),{groups:G},{merge:true});META.groups=G;m.textContent='已儲存。';renderUnits()}catch(e){m.textContent='儲存失敗：'+(e.code||e.message)}};
$('a-q').oninput=admList;$('a-new').onclick=function(){admForm(null)};
$('c-q').oninput=listCat;$('c-sem').onchange=listCat;
$('x-all').onclick=function(){$('l-exp').querySelectorAll('input').forEach(function(x){x.checked=true})};
$('x-none').onclick=function(){$('l-exp').querySelectorAll('input').forEach(function(x){x.checked=false})};
$('x-go').onclick=doExport;
$('admbtn').onclick=function(){setAdm(!adm);if(adm)showTab('adm')};
$('bm').href=bmCode();$('bm').onclick=function(e){e.preventDefault();note('請把「抽號器看片」按鈕拖到瀏覽器的書籤列，不是直接點。')};
$('bm-c').onclick=function(){copy(bmCode()).then(function(ok){$('bm-m').textContent=ok?'已複製。新增一個書籤，網址貼上這段，名稱填「抽號器看片」。':'複製失敗，請改用拖曳。'})};
var armed=false;
$('reset').onclick=function(){
  if(!armed){armed=true;$('reset').textContent='再按一次確認重設';setTimeout(function(){armed=false;$('reset').textContent='重設進度'},4000);return}
  armed=false;$('reset').textContent='重設進度';
  var ids=poolIds();if(pool==='all')P.seen=P.seen.filter(function(x){return ids.indexOf(x)<0});else P.rseen=P.rseen.filter(function(x){return ids.indexOf(x)<0});
  saveP();counts();setPool(pool)};
$('login').onclick=login;$('login2').onclick=login;
if(PANEL)document.body.classList.add('panel');

try{await fbLoad()}catch(e){$('acct').textContent='';note('載入失敗（可能是網路問題或瀏覽器太舊），請重新整理或換瀏覽器。');return}
fb.au.getRedirectResult(fb.auth).catch(function(e){note('登入失敗：'+(e.code||e.message))});
fb.au.onAuthStateChanged(fb.auth,onUser);
})();
