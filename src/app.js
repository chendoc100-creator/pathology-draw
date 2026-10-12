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

var $=function(id){return document.getElementById(id)};
var esc=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})};
function fmt(s){return esc(s).replace(/==([^=\n]+?)==/g,'<mark>$1</mark>').replace(/__([^_\n]+?)__/g,'<b>$1</b>')}
function strip(s){return String(s||'').replace(/==([^=\n]+?)==/g,'$1').replace(/__([^_\n]+?)__/g,'$1')}
function hasMark(s){return /==[^=\n]+?==|__[^_\n]+?__/.test(s)}
function numOf(id){var m=String(id).match(/\d+/);return m?parseInt(m[0],10):1e9}
function byNum(a,b){return numOf(a)-numOf(b)||(a<b?-1:a>b?1:0)}
function hash(s){var h=0;s=String(s||'');for(var i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0}return h.toString(36)}
function uniq(a){var o=[],k={};(a||[]).forEach(function(x){if(!k[x]){k[x]=1;o.push(x)}});return o}
function note(t){$('notice').hidden=!t;$('notice').textContent=t||''}
function el(tag,cls,html){var e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e}

/* ---------- state ---------- */
var fb=null,user=null,isAdmin=false;
var SL=[],BY={};                         /* master slide list */
var P={seen:[],review:[],rseen:[],last:'',rlast:'',units:null}; /* progress */
var U={overrides:{},notes:{},views:{},marks:{}};  /* personal data */
var IMG={};                              /* slideId -> [{id,data,w,h}] (loaded on demand) */
var REPORTS=[];
var FLD={},APPROVED=false,REQUESTED=false,LINKS={};  /* slide fields (coords, no images), image access */
var tab='draw',pool='all',rvHide=false,rvKey=false;
var live=[];

function cleanP(o){var b={seen:[],review:[],rseen:[],last:'',rlast:'',units:null};if(o){['seen','review','rseen'].forEach(function(k){if(Array.isArray(o[k]))b[k]=o[k].filter(function(x){return BY[x]})});b.last=o.last||'';b.rlast=o.rlast||'';if(Array.isArray(o.units))b.units=o.units}return b}

/* ---------- firebase ---------- */
async function fbLoad(){
  var m=await Promise.all([import(FB+'firebase-app.js'),import(FB+'firebase-auth.js'),import(FB+'firebase-firestore.js')]);
  var app=m[0].initializeApp(CFG);
  fb={au:m[1],fs:m[2],auth:m[1].getAuth(app),db:m[2].getFirestore(app)};
  if(window.__EMU){m[1].connectAuthEmulator(fb.auth,'http://127.0.0.1:9099',{disableWarnings:true});m[2].connectFirestoreEmulator(fb.db,'127.0.0.1',8080);
    /* test-only hook: sign in against the local auth emulator */
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
  $('app').hidden=true;$('gate').hidden=false;$('login').hidden=true;$('acct').textContent='未登入';
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
  user=u;isAdmin=false;IMG={};
  if(!u){SL=[];BY={};P=cleanP(null);U={overrides:{},notes:{},views:{},marks:{}};FLD={};APPROVED=false;showGate();return}
  $('gate').hidden=true;$('acct').textContent='讀取中…';$('login').hidden=false;$('login').textContent='登出';
  try{
    var r=await Promise.all([
      fb.fs.getDoc(D('content','slides')),
      fb.fs.getDoc(D('progress',u.uid)),
      fb.fs.getDoc(D('users',u.uid)),
      fb.fs.getDoc(D('admin','flag')).then(function(){return true},function(){return false}),
      fb.fs.getDoc(D('content','fields')).then(function(x){return x.exists()?x.data():{}},function(){return {}}),
      fb.fs.getDoc(D('access',u.uid)).then(function(x){return x.exists()},function(){return false}),
      fb.fs.getDoc(D('requests',u.uid)).then(function(x){return x.exists()},function(){return false})
    ]);
    FLD=r[4]||{};APPROVED=r[5];REQUESTED=r[6];
    SL=(r[0].exists()&&r[0].data().list)||[];BY={};SL.forEach(function(d){BY[d.id]=d});
    P=cleanP(r[1].exists()?r[1].data():null);
    if(r[2].exists()){var x=r[2].data();U={overrides:x.overrides||{},notes:x.notes||{},views:x.views||{},marks:x.marks||{}}}
    else{U={overrides:{},notes:{},views:{},marks:{}};await fb.fs.setDoc(D('users',u.uid),{overrides:{},notes:{},views:{},marks:{}})}
    isAdmin=r[3];
  }catch(e){
    $('acct').textContent='已登入';note('讀取資料失敗（'+(e.code||e.message)+'）。請重新整理；一直失敗的話告訴管理者。');return
  }
  $('acct').textContent=(u.displayName||u.email||'已登入')+'（資料只有你看得到）';
  note(SL.length?'':'題庫還是空的。');
  $('app').hidden=false;$('t-adm').hidden=!isAdmin;
  if(isAdmin){loadReports();admInit()}
  renderUnits();setPool(pool);showTab(tab==='adm'&&!isAdmin?'draw':tab);counts();
}

/* ---------- units ---------- */
function allUnits(){return uniq(SL.map(function(d){return d.unit||'未分類'}))}
function selUnits(){var a=allUnits();if(!P.units)return a;var s=P.units.filter(function(x){return a.indexOf(x)>=0});return s.length?s:a}
function inUnits(id){var d=BY[id];return d&&selUnits().indexOf(d.unit||'未分類')>=0}
function renderUnits(){
  var a=allUnits(),box=$('units');box.innerHTML='<span class="lb">單元</span>';
  var all=el('button',null,'全部');all.type='button';all.setAttribute('aria-pressed',!P.units);
  all.onclick=function(){P.units=null;saveP();unitsChanged()};box.appendChild(all);
  a.forEach(function(u){var b=el('button',null,esc(u));b.type='button';
    b.setAttribute('aria-pressed',!!P.units&&P.units.indexOf(u)>=0);
    b.onclick=function(){var s=P.units?P.units.slice():[];var i=s.indexOf(u);if(i>=0)s.splice(i,1);else s.push(u);
      P.units=s.length&&s.length<a.length?s:null;saveP();unitsChanged()};box.appendChild(b)});
}
function unitsChanged(){renderUnits();setPool(pool);renderAll()}

/* ---------- effective answer ---------- */
function eff(id){var d=BY[id],o=U.overrides[id];
  return {dx:o&&o.dxfull!=null?o.dxfull:(d.n?d.dxfull:d.dx),organ:o&&o.organ!=null?o.organ:d.organ,desc:o&&o.desc!=null?o.desc:d.desc,note:d.note,mine:!!o,stale:!!(o&&o.base!==baseOf(d))}}
function baseOf(d){return hash([d.dxfull,d.organ,d.desc].join('|'))}
function lineKey(l){return strip(l).replace(/\s+/g,' ').trim()}

/* ---------- slide card ---------- */
function mk(id,opt){
  opt=opt||{};
  var d=BY[id],online=!d.n;
  var e=el('div','it'+(opt.big?' big':''));
  var nImg=(IMG[id]||[]).length;
  e.innerHTML='<div class="head">'+esc(d.id)+(online?'<span class="badge on">線上</span>':' <small>('+esc(d.n)+')</small>')+(opt.seen?'<span class="badge">已抽過</span>':'')+' <small class="small">'+esc(d.unit||'')+'</small></div>'+
   '<div class="row"><button type="button" class="btn sm q">作答</button><button type="button" class="btn sm r">'+(opt.open?'隱藏答案':'顯示答案')+'</button><button type="button" class="btn sm warn v"></button>'+
   '<button type="button" class="btn sm nb">筆記／圖片<span class="cnt"></span></button>'+
   (hasSlide(id)?'<button type="button" class="btn sm primary sv2">看片</button>':'')+
   '<a class="btn sm mt" href="https://microteaching.ntu.edu.tw/" target="_blank" rel="noopener noreferrer">開官方頁面</a>'+
   '<button type="button" class="reset rp">回報答案錯誤</button></div>'+
   '<div class="fm f" hidden><label>診斷</label><input class="a-dx" autocomplete="off">'+
   (online?'':'<label>器官</label><input class="a-og" autocomplete="off"><label>描述（英文關鍵字，一行一點或用逗號分開）</label><textarea class="a-ds"></textarea>')+
   '<div class="row"><button type="button" class="btn sm primary g">批改</button></div></div>'+
   '<div class="res-w" hidden></div><div class="ans-w"'+(opt.open?'':' hidden')+'></div><div class="nt-w" hidden></div><div class="rp-w" hidden></div>';
  var q=e.querySelector('.q'),r=e.querySelector('.r'),v=e.querySelector('.v'),f=e.querySelector('.f'),rw=e.querySelector('.res-w'),aw=e.querySelector('.ans-w'),nw=e.querySelector('.nt-w'),pw=e.querySelector('.rp-w');
  if(hasSlide(id))e.querySelector('.sv2').onclick=function(){openSlide(id,null)};
  e.querySelector('.mt').addEventListener('click',function(){copy(id).then(function(ok){if(ok)note('已複製片號 '+id+'，登入後在官方清單的 Search 欄貼上即可找到（需校內網路或台大 VPN）。')})});
  q.onclick=function(){f.hidden=!f.hidden;if(!f.hidden)f.querySelector('.a-dx').focus()};
  var obj={el:e,id:id,big:!!opt.big,opt:opt,
    upd:function(){v.textContent=P.review.indexOf(id)>=0?'移出複習':'加入複習';var n=(IMG[id]||[]).length,t=(U.notes[id]||'').trim()?1:0;e.querySelector('.cnt').textContent=(n||t)?' ('+(t?'筆記':'')+(t&&n?'＋':'')+(n?n+' 圖':'')+')':''},
    ans:function(){if(!aw.hidden)renderAns(aw,id,obj)}};
  r.onclick=function(){aw.hidden=!aw.hidden;r.textContent=aw.hidden?'顯示答案':'隱藏答案';obj.ans()};
  e.querySelector('.g').onclick=function(){rw.innerHTML=gradeHTML(id,f);rw.hidden=false};
  v.onclick=function(){toggleRev(id)};
  e.querySelector('.nb').onclick=function(){nw.hidden=!nw.hidden;if(!nw.hidden)renderNotes(nw,id,obj)};
  e.querySelector('.rp').onclick=function(){pw.hidden=!pw.hidden;if(!pw.hidden)renderReport(pw,id)};
  obj.upd();obj.ans();
  if(opt.notes){nw.hidden=false;renderNotes(nw,id,obj)}
  live.push(obj);return obj;
}
function refreshLive(id){live=live.filter(function(o){return document.body.contains(o.el)});live.forEach(function(o){if(!id||o.id===id){o.upd();o.ans()}})}

/* ---------- answer panel ---------- */
function renderAns(box,id,obj){
  var d=BY[id],online=!d.n,a=eff(id),vw=viewsFor(id),keyOnly=obj&&obj.opt.keyOnly,hide=obj&&obj.opt.hide;
  var showOrig=box.dataset.orig==='1';
  if(showOrig)a={dx:online?d.dx:d.dxfull,organ:d.organ,desc:d.desc,note:d.note,mine:false};
  var h='<div class="ans ansblk"><div><span class="lab">診斷'+(a.mine?'<span class="mine">我的版本</span>':'')+(showOrig?'<span class="mine">原始答案</span>':'')+'</span>'+lineHTML(a.dx,'dx',vw)+'</div>';
  if(!online&&a.organ)h+='<div><span class="lab">器官</span>'+fmt(a.organ)+'</div>';
  if(!online||a.desc){
    var lines=String(a.desc||'').split('\n');
    if(keyOnly)lines=lines.filter(function(l){return /^\s*\*/.test(l)||hasMark(l)});
    h+='<div><span class="lab">說明</span><div class="pre">'+(lines.map(function(l){return lineHTML(l,lineKey(l),vw)}).join('')||'<span class="small">（沒有標記的重點）</span>')+'</div></div>';
  }
  if(a.note&&!keyOnly)h+='<div><span class="lab">備註</span><div class="pre">'+fmt(a.note)+'</div></div>';
  h+='</div><div class="row" style="margin-top:8px"><button type="button" class="btn sm ed">編輯我的版本</button>'+
    (a.mine||showOrig?'<button type="button" class="btn sm og">'+(showOrig?'看我的版本':'看原始答案')+'</button>':'')+
    (isAdmin?'<button type="button" class="btn sm warn ad">編輯總答案</button>':'')+'</div>'+
    (a.stale&&!showOrig?'<div class="tag">提醒：你編輯之後，原始答案有更新過，可以按「看原始答案」比對。</div>':'')+
    '<div class="tag">畫底線的點可以點，會用顯微鏡帶你到那個視野（「信心」是判讀位置的把握程度，不是答案本身）。</div><div class="edw"></div>';
  box.innerHTML=h;box.className='ans-w'+(hide?' hid':'');
  var blk=box.querySelector('.ansblk');
  if(hide)blk.onclick=function(){box.classList.remove('hid')};
  box.querySelectorAll('.ln.vw').forEach(function(n){n.onclick=function(ev){if(box.classList.contains('hid'))return;ev.stopPropagation();var v=vw[n.dataset.k];if(v.slide)openSlide(id,v);else openScope(id,v)}});
  box.querySelector('.ed').onclick=function(){editor(box.querySelector('.edw'),id,false)};
  var og=box.querySelector('.og');if(og)og.onclick=function(){box.dataset.orig=showOrig?'':'1';renderAns(box,id,obj)};
  var ad=box.querySelector('.ad');if(ad)ad.onclick=function(){showTab('adm');admForm(id)};
}
function lineHTML(text,key,vw){var v=key&&vw[key];if(!String(text).trim())return '<div class="ln">&nbsp;</div>';
  return '<div class="ln'+(v?' vw':'')+'"'+(v?' data-k="'+esc(key)+'" title="點一下開顯微鏡"':'')+'>'+fmt(text)+(v?'<span class="go">'+v.obj+'× 視野'+(v.conf?'・信心'+esc(v.conf):'')+'</span>':'')+'</div>'}
function hasSlide(id){var f=FLD[id];return !!(f&&f.ov)}
function viewsFor(id){var o={},u=U.views[id]||{},f=FLD[id];Object.keys(u).forEach(function(k){o[k]=u[k]});
  if(f&&f.pts)f.pts.forEach(function(p){o[p.k]={slide:true,x:p.x,y:p.y,obj:p.obj,conf:p.conf,note:p.note}});return o}

/* ---------- editor (personal or master) ---------- */
function editor(box,id,master){
  var d=BY[id],a=master?{dx:d.dxfull,organ:d.organ,desc:d.desc}:eff(id);
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
  if(!m){var seg=v.slice(s,e);if(s===e){/* clear the whole line */var ls=v.lastIndexOf('\n',s-1)+1,le=v.indexOf('\n',s);if(le<0)le=v.length;s=ls;e=le;seg=v.slice(s,e)}
    var c=strip(seg);t.value=v.slice(0,s)+c+v.slice(e);t.setSelectionRange(s,s+c.length);t.focus();return}
  if(s===e){t.focus();return}
  var sel=v.slice(s,e);
  if(v.slice(s-2,s)===m&&v.slice(e,e+2)===m){t.value=v.slice(0,s-2)+sel+v.slice(e+2);t.setSelectionRange(s-2,e-2)}
  else{t.value=v.slice(0,s)+m+sel+m+v.slice(e);t.setSelectionRange(s+2,e+2)}
  t.focus();
}

/* ---------- notes & images ---------- */
async function loadImgs(id){
  if(IMG[id])return IMG[id];
  var q=fb.fs.query(C('users',user.uid,'images'),fb.fs.where('slide','==',id));
  var s=await fb.fs.getDocs(q);var a=[];s.forEach(function(x){var y=x.data();a.push({id:x.id,data:y.data,w:y.w,h:y.h,at:y.at||0})});
  a.sort(function(p,q){return p.at-q.at});IMG[id]=a;return a;
}
function renderNotes(box,id,obj){
  box.innerHTML='<div class="fm"><label>我的筆記（只有自己看得到，會自動存）</label><textarea class="n-t"></textarea><div class="small n-s"></div>'+
    '<label>我的圖片（上傳後點圖片可以用顯微鏡看：圓形視野、4× / 10× / 40×）</label><div class="thumbs"></div>'+
    '<div class="row"><label class="btn sm" style="cursor:pointer">上傳圖片<input type="file" accept="image/*" multiple hidden class="n-f"></label></div><div class="msg n-m"></div></div>';
  var t=box.querySelector('.n-t'),st=box.querySelector('.n-s'),tm=null;
  t.value=U.notes[id]||'';
  t.oninput=function(){st.textContent='儲存中…';clearTimeout(tm);tm=setTimeout(function(){var v=t.value;if(v.trim())U.notes[id]=v;else delete U.notes[id];saveU('notes',id);queue(function(){st.textContent='已儲存'});obj&&obj.upd()},700)};
  var th=box.querySelector('.thumbs'),msg=box.querySelector('.n-m');
  function draw(){
    var a=IMG[id]||[];th.innerHTML=a.length?'':'<span class="small">還沒有圖片。</span>';
    a.forEach(function(im,i){var b=el('button','th');b.type='button';b.title='用顯微鏡看';
      b.innerHTML='<img alt="">';b.querySelector('img').src=im.data;
      var x=el('span','del','刪除');x.setAttribute('role','button');
      x.onclick=async function(ev){ev.stopPropagation();if(x.dataset.a!=='1'){x.dataset.a='1';x.textContent='確定？';setTimeout(function(){x.dataset.a='';x.textContent='刪除'},3000);return}
        try{await fb.fs.deleteDoc(D('users',user.uid,'images',im.id));IMG[id]=a.filter(function(z){return z.id!==im.id});dropViews(id,im.id);draw();obj&&obj.upd()}catch(e){msg.textContent='刪除失敗：'+(e.code||e.message)}};
      b.appendChild(x);b.onclick=function(){openScope(id,{img:im.id})};th.appendChild(b)});
  }
  th.innerHTML='<span class="small">讀取中…</span>';
  loadImgs(id).then(function(){draw();obj&&obj.upd()},function(e){th.innerHTML='';msg.textContent='讀取圖片失敗：'+(e.code||e.message)});
  box.querySelector('.n-f').onchange=async function(ev){
    var files=[].slice.call(ev.target.files||[]);ev.target.value='';
    for(var i=0;i<files.length;i++){
      msg.textContent='處理第 '+(i+1)+' / '+files.length+' 張…';
      try{var c=await shrink(files[i]);
        var ref=await fb.fs.addDoc(C('users',user.uid,'images'),{slide:id,data:c.data,w:c.w,h:c.h,at:Date.now()});
        (IMG[id]=IMG[id]||[]).push({id:ref.id,data:c.data,w:c.w,h:c.h,at:Date.now()});draw();obj&&obj.upd();
      }catch(e){msg.textContent='第 '+(i+1)+' 張上傳失敗：'+(e.code||e.message||e);return}
    }
    msg.textContent='上傳完成。';
  };
}
function dropViews(id,imgId){var v=U.views[id];if(!v)return;var ch=false;Object.keys(v).forEach(function(k){if(v[k].img===imgId){delete v[k];ch=true}});if(ch){if(!Object.keys(v).length)delete U.views[id];saveU('views',id)}}
function loadImage(src){return new Promise(function(res,rej){var i=new Image();i.onload=function(){res(i)};i.onerror=function(){rej('這個檔案讀不出來（HEIC 請先轉成 JPG）')};i.src=src})}
async function shrink(file){
  var url=URL.createObjectURL(file);
  try{var im=await loadImage(url);var W=im.naturalWidth,H=im.naturalHeight,max=2000,q=.85;
    for(var k=0;k<8;k++){var s=Math.min(1,max/Math.max(W,H)),w=Math.round(W*s),h=Math.round(H*s);
      var c=document.createElement('canvas');c.width=w;c.height=h;var x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,w,h);x.drawImage(im,0,0,w,h);
      var data=c.toDataURL('image/jpeg',q);if(data.length<900000)return {data:data,w:w,h:h};
      if(q>.6)q-=.1;else max=Math.round(max*.8)}
    throw '圖片太大，壓縮後仍超過上限';
  }finally{URL.revokeObjectURL(url)}
}

/* ---------- report ---------- */
function renderReport(box,id){
  box.innerHTML='<div class="fm"><label>哪裡有錯？（會通知管理者，只有管理者看得到你的名字和內容）</label><textarea class="r-t" maxlength="1500"></textarea><div class="row"><button type="button" class="btn sm primary r-s">送出</button></div><div class="msg r-m"></div></div>';
  box.querySelector('.r-s').onclick=async function(){
    var t=box.querySelector('.r-t').value.trim(),m=box.querySelector('.r-m');if(!t){m.textContent='請寫一下哪裡有錯。';return}
    try{await fb.fs.addDoc(C('reports'),{slide:id,text:t,uid:user.uid,name:user.displayName||user.email||'',at:Date.now(),done:false});
      box.innerHTML='<div class="msg">已送出，謝謝。</div>'}catch(e){m.textContent='送出失敗：'+(e.code||e.message)}};
}

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
function poolIds(){return (pool==='all'?SL.map(function(d){return d.id}):P.review.slice()).filter(inUnits)}
function seenArr(){return pool==='all'?P.seen:P.rseen}
function progress(){var p=poolIds(),sa=seenArr(),s=p.filter(function(x){return sa.indexOf(x)>=0}).length;
  $('prog').textContent='已抽 '+s+' / '+p.length+'（'+selUnits().join('、')+'）';$('barfill').style.width=(p.length?s/p.length*100:0)+'%'}
function draw(){
  var p=poolIds();$('msg').textContent='';
  if(!p.length){$('msg').textContent=pool==='rev'?'這個單元的複習清單是空的。':'這個單元沒有片子。';return}
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
  $('slot').innerHTML='<div class="empty">'+(p==='all'?'按「抽下一張」開始。沒抽過的片子會先出現。':(P.review.filter(inUnits).length?'按「抽下一張」開始複習。':'這個單元的複習清單是空的。'))+'</div>'}

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
  var d=BY[id],a=eff(id),online=!d.n,val=function(c){var e=f.querySelector(c);return e?e.value:''};
  var mark=function(ok,label,right){return '<div><span class="'+(ok?'ok':'no')+'">'+(ok?'✓ ':'✗ ')+label+'</span>　正確：'+fmt(right)+'</div>'};
  var h='<div class="res">'+mark(matchField(val('.a-dx'),[d.dx,a.dx]),'診斷',online?d.dx:a.dx);
  if(!online){
    h+=mark(matchField(val('.a-og'),[d.organ,a.organ]),'器官',a.organ);
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

/* ---------- microscope ---------- */
var FR={4:1,10:0.4,40:0.1};  /* fraction of the image's short side visible across the field */
var SC=null;
async function openScope(id,view){
  view=view||{};
  var a;try{a=await loadImgs(id)}catch(e){note('讀取圖片失敗');return}
  if(!a.length){note('這張片子還沒有你的圖片。先在「筆記／圖片」上傳。');return}
  var idx=0;if(view.img){a.forEach(function(x,i){if(x.id===view.img)idx=i})}
  SC={id:id,imgs:a,idx:idx,obj:4,cx:0,cy:0,pt:false};
  $('scope').hidden=false;document.body.style.overflow='hidden';
  fillLines();await showImg(idx,true);
  if(view.cx!=null){SC.cx=view.cx;SC.cy=view.cy;layout(false);
    if(view.obj&&view.obj!==4){setTimeout(function(){setObj(view.obj)},250)}}
  $('sc-x').focus();
}
function fillLines(){
  var a=eff(SC.id),s=$('sc-line'),vw=U.views[SC.id]||{};
  var opts=[['dx','診斷：'+strip(a.dx)]].concat(String(a.desc||'').split('\n').filter(function(l){return l.trim()}).map(function(l){return [lineKey(l),lineKey(l)]}));
  s.innerHTML=opts.map(function(o){return '<option value="'+esc(o[0])+'">'+(vw[o[0]]?'● ':'')+esc(o[1].length>60?o[1].slice(0,58)+'…':o[1])+'</option>'}).join('');
}
function showImg(i,fit){
  return new Promise(function(res){
    SC.idx=(i+SC.imgs.length)%SC.imgs.length;var im=SC.imgs[SC.idx],img=$('sc-img');
    img.onload=function(){SC.w=img.naturalWidth;SC.h=img.naturalHeight;img.style.width=SC.w+'px';img.style.height=SC.h+'px';if(fit){SC.cx=SC.w/2;SC.cy=SC.h/2;SC.obj=4}layout(false);res()};
    img.src=im.data;
    $('sc-t').textContent=SC.id+'　圖 '+(SC.idx+1)+' / '+SC.imgs.length;
    $('sc-prev').hidden=$('sc-next').hidden=SC.imgs.length<2;
  });
}
function layout(anim){
  if(!SC||!SC.w)return;var f=$('sc-f'),Dm=f.clientWidth,s=Math.min(SC.w,SC.h),k=Dm/(FR[SC.obj]*s);
  SC.cx=Math.max(0,Math.min(SC.w,SC.cx));SC.cy=Math.max(0,Math.min(SC.h,SC.cy));
  var img=$('sc-img');img.style.transition=anim?'transform .45s ease':'none';
  img.style.transform='translate('+(Dm/2-SC.cx*k)+'px,'+(Dm/2-SC.cy*k)+'px) scale('+k+')';
  [].forEach.call($('sc-obj').children,function(b){b.setAttribute('aria-pressed',+b.dataset.o===SC.obj)});
  $('sc-info').textContent='物鏡 '+SC.obj+'×（總倍率 '+SC.obj*10+'×）　拖曳移動，滾輪或雙指縮放換物鏡'+(SC.obj===40?'。高倍是把截圖放大，清晰度取決於你上傳的圖。':'');
}
function setObj(o){if(!SC||!FR[o])return;SC.obj=o;layout(true)}
function stepObj(dir){var L=[4,10,40],i=L.indexOf(SC.obj)+dir;if(i>=0&&i<L.length)setObj(L[i])}
function closeScope(){$('scope').hidden=true;document.body.style.overflow='';SC=null}
(function(){
  var f=$('sc-f'),pts={},startD=0;
  f.addEventListener('pointerdown',function(e){if(!SC)return;f.setPointerCapture(e.pointerId);pts[e.pointerId]={x:e.clientX,y:e.clientY};var k=Object.keys(pts);if(k.length===2){startD=dist()}});
  f.addEventListener('pointermove',function(e){if(!SC||!pts[e.pointerId])return;var p=pts[e.pointerId],k=Object.keys(pts);
    if(k.length===1){var Dm=f.clientWidth,s=Math.min(SC.w,SC.h),sc=Dm/(FR[SC.obj]*s);SC.cx-=(e.clientX-p.x)/sc;SC.cy-=(e.clientY-p.y)/sc;layout(false)}
    p.x=e.clientX;p.y=e.clientY;
    if(k.length===2&&startD){var d=dist();if(d/startD>1.5){stepObj(1);startD=d}else if(d/startD<0.67){stepObj(-1);startD=d}}});
  function up(e){delete pts[e.pointerId];startD=0}
  f.addEventListener('pointerup',up);f.addEventListener('pointercancel',up);
  function dist(){var k=Object.keys(pts);if(k.length<2)return 0;var a=pts[k[0]],b=pts[k[1]];return Math.hypot(a.x-b.x,a.y-b.y)}
  var wl=0;f.addEventListener('wheel',function(e){e.preventDefault();var t=Date.now();if(t-wl<250)return;wl=t;stepObj(e.deltaY<0?1:-1)},{passive:false});
  [].forEach.call($('sc-obj').children,function(b){b.onclick=function(){setObj(+b.dataset.o)}});
  $('sc-x').onclick=closeScope;
  $('sc-prev').onclick=function(){showImg(SC.idx-1,true)};$('sc-next').onclick=function(){showImg(SC.idx+1,true)};
  $('sc-pt').onclick=function(){SC.pt=!SC.pt;$('sc-ptr').hidden=!SC.pt;$('sc-pt').setAttribute('aria-pressed',SC.pt)};
  $('sc-sv').onclick=function(){if(!SC)return;var k=$('sc-line').value,v=U.views[SC.id]=U.views[SC.id]||{};
    v[k]={img:SC.imgs[SC.idx].id,cx:Math.round(SC.cx),cy:Math.round(SC.cy),obj:SC.obj};saveU('views',SC.id);fillLines();$('sc-line').value=k;
    $('sc-info').textContent='已存。之後在答案點這一點，就會開到這個視野。';refreshLive(SC.id)};
  document.addEventListener('keydown',function(e){if(!SC)return;var s=40;
    if(e.key==='Escape')closeScope();else if(e.key==='ArrowLeft'){SC.cx-=s/ (FR[SC.obj]);layout(false)}else if(e.key==='ArrowRight'){SC.cx+=s/(FR[SC.obj]);layout(false)}
    else if(e.key==='ArrowUp'){SC.cy-=s/(FR[SC.obj]);layout(false)}else if(e.key==='ArrowDown'){SC.cy+=s/(FR[SC.obj]);layout(false)}
    else if(e.key==='+'||e.key==='=')stepObj(1);else if(e.key==='-')stepObj(-1)});
  window.addEventListener('resize',function(){layout(false)});
})();

/* ---------- slide microscope (pre-captured fields; coordinates in µm on the slide) ---------- */
var FIELD_UM={4:5500,10:2200,40:550};   /* field diameter of a 10x eyepiece (FN 22) with each objective */
var FIMG={},SS=null;
function fimg(id){if(FIMG[id])return FIMG[id];FIMG[id]=fb.fs.getDoc(D('fimg',id)).then(function(x){if(!x.exists())throw new Error('missing');return x.data().data});FIMG[id].catch(function(){delete FIMG[id]});return FIMG[id]}
function inRect(r,x,y){return x>=r.x0&&x<=r.x1&&y>=r.y0&&y<=r.y1}
function layerFor(f,obj,x,y){
  if(obj===4)return f.ov;
  var rs=(f.regs||[]).filter(function(r){return r.obj===obj});if(!rs.length)return null;
  var inside=rs.filter(function(r){return inRect(r,x,y)});
  var cd=function(r){return Math.hypot((r.x0+r.x1)/2-x,(r.y0+r.y1)/2-y)};
  if(inside.length){inside.sort(function(a,b){return cd(a)-cd(b)});return inside[0]}
  rs.sort(function(a,b){return Math.hypot((a.x0+a.x1)/2-x,(a.y0+a.y1)/2-y)-Math.hypot((b.x0+b.x1)/2-x,(b.y0+b.y1)/2-y)});return rs[0];
}
async function openSlide(id,pt){
  var f=FLD[id];if(!f||!f.ov){note('這張片還沒有擷取影像。');return}
  SS={id:id,obj:4,x:pt?pt.x:(f.ov.x0+f.ov.x1)/2,y:pt?pt.y:(f.ov.y0+f.ov.y1)/2,layer:null,tool:'move',pt:false,shared:false};
  $('ss').hidden=false;document.body.style.overflow='hidden';
  $('ss-t').textContent=id+'　'+(BY[id]?strip(BY[id].dxfull):'');
  ssPoints();ssTools();
  var ok=isAdmin||APPROVED;$('ss-lock').hidden=ok;$('ss-f').hidden=!ok;$('ss-ctl').hidden=!ok;$('ss-tools').hidden=!ok;
  if(!ok){ssLock();return}
  await ssShow(false);
  if(pt&&pt.obj&&pt.obj!==4)setTimeout(function(){ssObj(pt.obj,true)},500);
  if(pt&&pt.note)$('ss-info').textContent=pt.note;
}
function ssLock(){
  var b=$('ss-lock');
  b.innerHTML='<p>看片影像只開放給管理者核准的同學。</p>'+(REQUESTED?'<p class="small">已送出申請，等待核准。</p>':'<button type="button" class="btn sm primary" id="ss-req">申請看片</button>');
  var q=$('ss-req');if(q)q.onclick=async function(){try{await fb.fs.setDoc(D('requests',user.uid),{name:user.displayName||'',email:user.email||'',at:Date.now()});REQUESTED=true;ssLock()}catch(e){note('申請失敗：'+(e.code||e.message))}};
}
function ssPoints(){
  var f=FLD[SS.id],box=$('ss-pts');box.innerHTML='';
  (f.pts||[]).forEach(function(p,i){var b=el('button','btn sm',esc((i+1)+'. '+(p.k==='dx'?'整體':p.k).slice(0,28))+(p.conf?' <small>信心'+esc(p.conf)+'</small>':''));b.type='button';b.title=p.k;
    b.onclick=function(){SS.x=p.x;SS.y=p.y;SS.obj=4;ssShow(false).then(function(){if(p.obj!==4)setTimeout(function(){ssObj(p.obj,true)},350)});$('ss-info').textContent=p.note||''};box.appendChild(b)});
}
async function ssShow(anim){
  var f=FLD[SS.id],L=layerFor(f,SS.obj,SS.x,SS.y);
  if(!L){SS.obj=4;L=f.ov}
  if(L!==SS.layer){
    var img=$('ss-img');
    try{img.src=await fimg(L.img)}catch(e){$('ss-info').textContent='影像讀取失敗：'+(e.code||e.message);return}
    SS.layer=L;anim=false;
  }
  ssLayout(anim);
}
function ssLayout(anim){
  if(!SS||!SS.layer)return;var L=SS.layer,Dm=$('ss-f').clientWidth,k=Dm/FIELD_UM[SS.obj],s=(L.x1-L.x0)/L.w;
  SS.x=Math.max(L.x0,Math.min(L.x1,SS.x));SS.y=Math.max(L.y0,Math.min(L.y1,SS.y));
  var img=$('ss-img');img.style.width=L.w+'px';img.style.height=L.h+'px';img.style.transition=anim?'transform .45s ease':'none';
  img.style.transform='translate('+(Dm/2-(SS.x-L.x0)*k)+'px,'+(Dm/2-(SS.y-L.y0)*k)+'px) scale('+(k*s)+')';
  [].forEach.call($('ss-obj').children,function(b){b.setAttribute('aria-pressed',+b.dataset.o===SS.obj)});
  var h=FIELD_UM[SS.obj];$('ss-scale').textContent='視野直徑約 '+(h>=1000?(h/1000)+' mm':h+' µm')+'（物鏡 '+SS.obj+'×，總倍率 '+SS.obj*10+'×）';
  ssMarks();
}
function ssObj(o,anim){
  if(!SS)return;var f=FLD[SS.id];
  if(o!==4){var L=layerFor(f,o,SS.x,SS.y);if(!L){$('ss-info').textContent='這張片沒有 '+o+'× 的影像。';return}
    if(!inRect(L,SS.x,SS.y)){SS.x=(L.x0+L.x1)/2;SS.y=(L.y0+L.y1)/2;$('ss-info').textContent='高倍只有重點區域，已移到最近的區域。'}}
  SS.obj=o;ssShow(anim);
}
function ssStep(d){var L=[4,10,40],i=L.indexOf(SS.obj)+d;if(i>=0&&i<L.length)ssObj(L[i],true)}
function closeSlide(){$('ss').hidden=true;document.body.style.overflow='';SS=null}
/* annotations: circle, arrow, text — stored in µm */
function myMarks(){return (U.marks&&U.marks[SS.id])||[]}
function sharedMarks(){var f=FLD[SS.id];return (f&&f.shared)||[]}
function ssMarks(extra){
  var Dm=$('ss-f').clientWidth,k=Dm/FIELD_UM[SS.obj],w=Dm/k,svg=$('ss-svg');
  svg.setAttribute('viewBox',(SS.x-w/2)+' '+(SS.y-w/2)+' '+w+' '+w);
  var fs=15/k,sw=2.5/k,h='<defs>'+[['y','#ffd400'],['g','#1a7f37']].map(function(c){return '<marker id="ah'+c[0]+'" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0L10 5L0 10z" fill="'+c[1]+'"/></marker>'}).join('')+'</defs>';
  function draw(m,c){
    if(m.t==='c')return '<circle cx="'+m.x+'" cy="'+m.y+'" r="'+m.r+'" fill="none" stroke="'+c+'" stroke-width="'+sw+'"/>';
    if(m.t==='a')return '<line x1="'+m.x1+'" y1="'+m.y1+'" x2="'+m.x2+'" y2="'+m.y2+'" stroke="'+c+'" stroke-width="'+sw+'" marker-end="url(#ah'+(c==='#1a7f37'?'g':'y')+')"/>';
    if(m.t==='t')return '<text x="'+m.x+'" y="'+m.y+'" font-size="'+fs+'" fill="'+c+'" stroke="#fff" stroke-width="'+(fs/6)+'" paint-order="stroke" font-family="Times New Roman,DFKai-SB,BiauKai,serif">'+esc(m.s)+'</text>';
    return ''}
  h+=sharedMarks().map(function(m){return draw(m,'#1a7f37')}).join('')+myMarks().map(function(m){return draw(m,'#ffd400')}).join('')+(extra?draw(extra,'#ffd400'):'');
  svg.innerHTML=h;
}
function ssSaveMarks(list){
  if(SS.shared&&isAdmin){var f=FLD[SS.id];f.shared=list;saveFields(SS.id)}
  else{U.marks=U.marks||{};if(list.length)U.marks[SS.id]=list;else delete U.marks[SS.id];saveU('marks',SS.id)}
}
function ssTools(){
  var box=$('ss-tools');
  box.innerHTML=[['move','移動'],['c','畫圈'],['a','箭頭'],['t','文字']].map(function(t){return '<button type="button" data-t="'+t[0]+'" aria-pressed="'+(SS.tool===t[0])+'">'+t[1]+'</button>'}).join('')+
    '<button type="button" class="ss-undo">復原</button><button type="button" class="ss-clr">清除'+(SS.shared?'共用':'我的')+'標註</button>'+(isAdmin?'<button type="button" class="ss-sh" aria-pressed="'+SS.shared+'">共用模式</button>':'');
  box.querySelectorAll('[data-t]').forEach(function(b){b.onclick=function(){SS.tool=b.dataset.t;ssTools()}});
  var cur=function(){return (SS.shared?sharedMarks():myMarks()).slice()};
  box.querySelector('.ss-undo').onclick=function(){var l=cur();l.pop();ssSaveMarks(l);ssMarks()};
  var clr=box.querySelector('.ss-clr');clr.onclick=function(){if(clr.dataset.a!=='1'){clr.dataset.a='1';clr.textContent='再按一次確認';return}ssSaveMarks([]);ssMarks();ssTools()};
  var sh=box.querySelector('.ss-sh');if(sh)sh.onclick=function(){SS.shared=!SS.shared;ssTools()};
  $('ss-f').style.cursor=SS.tool==='move'?'grab':'crosshair';
}
async function saveFields(id){var o={};o[id]=FLD[id];try{await fb.fs.setDoc(D('content','fields'),o,{merge:true})}catch(e){note('儲存失敗：'+(e.code||e.message))}}
(function(){
  var f=$('ss-f'),pts={},startD=0,drag=null;
  function toUm(e){var r=f.getBoundingClientRect(),Dm=f.clientWidth,k=Dm/FIELD_UM[SS.obj];return {x:SS.x+(e.clientX-r.left-Dm/2)/k,y:SS.y+(e.clientY-r.top-Dm/2)/k}}
  f.addEventListener('pointerdown',function(e){if(!SS)return;f.setPointerCapture(e.pointerId);pts[e.pointerId]={x:e.clientX,y:e.clientY};
    if(Object.keys(pts).length===2){startD=dist();drag=null;return}
    if(SS.tool!=='move'){var p=toUm(e);
      if(SS.tool==='t'){var s=window.prompt('標註文字');if(s&&s.trim()){var l=(SS.shared?sharedMarks():myMarks()).slice();l.push({t:'t',x:Math.round(p.x),y:Math.round(p.y),s:s.trim().slice(0,60)});ssSaveMarks(l);ssMarks()}delete pts[e.pointerId];return}
      drag={t:SS.tool,p:p}}});
  f.addEventListener('pointermove',function(e){if(!SS||!pts[e.pointerId])return;var p0=pts[e.pointerId],k=Object.keys(pts);
    if(k.length===2&&startD){var d=dist();if(d/startD>1.5){ssStep(1);startD=d}else if(d/startD<0.67){ssStep(-1);startD=d}p0.x=e.clientX;p0.y=e.clientY;return}
    if(drag){var q=toUm(e),m=drag.t==='c'?{t:'c',x:drag.p.x,y:drag.p.y,r:Math.hypot(q.x-drag.p.x,q.y-drag.p.y)}:{t:'a',x1:drag.p.x,y1:drag.p.y,x2:q.x,y2:q.y};drag.m=m;ssMarks(m);return}
    var Dm=f.clientWidth,kk=Dm/FIELD_UM[SS.obj];SS.x-=(e.clientX-p0.x)/kk;SS.y-=(e.clientY-p0.y)/kk;p0.x=e.clientX;p0.y=e.clientY;ssLayout(false)});
  function up(e){delete pts[e.pointerId];startD=0;
    if(drag&&drag.m){var m=drag.m,R=function(v){return Math.round(v)};
      var ok=m.t==='c'?m.r*(f.clientWidth/FIELD_UM[SS.obj])>6:Math.hypot(m.x2-m.x1,m.y2-m.y1)*(f.clientWidth/FIELD_UM[SS.obj])>10;
      if(ok){var l=(SS.shared?sharedMarks():myMarks()).slice();l.push(m.t==='c'?{t:'c',x:R(m.x),y:R(m.y),r:R(m.r)}:{t:'a',x1:R(m.x1),y1:R(m.y1),x2:R(m.x2),y2:R(m.y2)});ssSaveMarks(l)}
      ssMarks()}drag=null}
  f.addEventListener('pointerup',up);f.addEventListener('pointercancel',up);
  function dist(){var k=Object.keys(pts);if(k.length<2)return 0;var a=pts[k[0]],b=pts[k[1]];return Math.hypot(a.x-b.x,a.y-b.y)}
  var wl=0;f.addEventListener('wheel',function(e){e.preventDefault();var t=Date.now();if(t-wl<300)return;wl=t;ssStep(e.deltaY<0?1:-1)},{passive:false});
  [].forEach.call($('ss-obj').children,function(b){b.onclick=function(){ssObj(+b.dataset.o,true)}});
  $('ss-x').onclick=closeSlide;
  $('ss-pt').onclick=function(){SS.pt=!SS.pt;$('ss-ptr').hidden=!SS.pt;$('ss-pt').setAttribute('aria-pressed',SS.pt)};
  document.addEventListener('keydown',function(e){if(!SS)return;var s=FIELD_UM[SS.obj]/10;
    if(e.key==='Escape')closeSlide();else if(e.key==='ArrowLeft'){SS.x-=s;ssLayout(false)}else if(e.key==='ArrowRight'){SS.x+=s;ssLayout(false)}
    else if(e.key==='ArrowUp'){SS.y-=s;ssLayout(false)}else if(e.key==='ArrowDown'){SS.y+=s;ssLayout(false)}
    else if(e.key==='+'||e.key==='=')ssStep(1);else if(e.key==='-')ssStep(-1)});
  window.addEventListener('resize',function(){ssLayout(false)});
})();

/* ---------- admin: image access + capture bridge ---------- */
var CAP_ORIGIN='http://microteaching.ntu.edu.tw:9002',capWin=null;
async function admInit(){
  try{var x=await fb.fs.getDoc(D('admin','links'));LINKS=x.exists()?(x.data().map||{}):{}}catch(e){LINKS={}}
  /* one-time move: direct links leave the shared slide list (they were generated from the admin's own session) */
  var moved=false;SL.forEach(function(d){if(d.link){LINKS[d.id]=d.link;delete d.link;moved=true}});
  if(moved){try{await fb.fs.setDoc(D('admin','links'),{map:LINKS});await saveSlides(null)}catch(e){note('連結搬移失敗：'+(e.code||e.message))}}
}
window.addEventListener('message',async function(ev){
  if(ev.origin!==CAP_ORIGIN||!isAdmin||!capWin||ev.source!==capWin)return;
  var m=ev.data||{},reply=function(o){try{ev.source.postMessage(Object.assign({t:'pd-ack',n:m.n},o),CAP_ORIGIN)}catch(e){}};
  try{
    var f=FLD[m.slide]=FLD[m.slide]||{pts:[],regs:[],shared:[]};
    if(m.t==='pd-img'){
      if(!/^data:image\/jpeg;base64,/.test(m.data)||m.data.length>990000)throw new Error('bad image');
      var ref=await fb.fs.addDoc(C('fimg'),{slide:m.slide,data:m.data,at:Date.now()});
      var L={img:ref.id,x0:m.rect[0],y0:m.rect[1],x1:m.rect[2],y1:m.rect[3],w:m.w,h:m.h};
      if(m.role==='ov')f.ov=L;else{L.obj=m.obj;f.regs=(f.regs||[]).concat([L])}
      await saveFields(m.slide);reply({ok:true,id:ref.id});
    }else if(m.t==='pd-pts'){f.pts=m.pts;await saveFields(m.slide);reply({ok:true})}
    else if(m.t==='pd-reset'){
      var ids=[f.ov&&f.ov.img].concat((f.regs||[]).map(function(r){return r.img})).filter(Boolean);
      for(var i=0;i<ids.length;i++)await fb.fs.deleteDoc(D('fimg',ids[i]));
      FLD[m.slide]={pts:[],regs:[],shared:f.shared||[]};await saveFields(m.slide);reply({ok:true})}
    else reply({ok:false,err:'unknown'});
    refreshLive(m.slide);
  }catch(e){reply({ok:false,err:String(e.code||e.message||e)})}
});
function admCapture(id){if(!LINKS[id]){note(id+' 沒有連結。');return}capWin=window.open(LINKS[id],'pdcap')}
async function admAccess(){
  var box=$('a-acc');box.innerHTML='<div class="small">讀取中…</div>';
  try{
    var r=await Promise.all([fb.fs.getDocs(C('requests')),fb.fs.getDocs(C('access'))]);
    var h='';r[0].forEach(function(x){var y=x.data();h+='<div class="rep"><div><b>申請：</b>'+esc(y.name)+' <span class="small">'+esc(y.email)+'</span></div><div class="row"><button type="button" class="btn sm primary" data-ok="'+x.id+'">核准</button><button type="button" class="btn sm warn" data-no="'+x.id+'">拒絕</button></div></div>'});
    var n=0;r[1].forEach(function(x){n++;var y=x.data();h+='<div class="row" style="align-items:center"><span>'+esc(y.name)+' <span class="small">'+esc(y.email)+'</span></span><button type="button" class="reset" data-rm="'+x.id+'">取消權限</button></div>'});
    box.innerHTML=(h||'<div class="empty">沒有申請。</div>')+'<div class="small">已核准 '+n+' 人</div>';
    var reqs={};r[0].forEach(function(x){reqs[x.id]=x.data()});
    box.querySelectorAll('[data-ok]').forEach(function(b){b.onclick=async function(){var id=b.dataset.ok,y=reqs[id];await fb.fs.setDoc(D('access',id),{name:y.name||'',email:y.email||'',at:Date.now()});await fb.fs.deleteDoc(D('requests',id));admAccess()}});
    box.querySelectorAll('[data-no]').forEach(function(b){b.onclick=async function(){await fb.fs.deleteDoc(D('requests',b.dataset.no));admAccess()}});
    box.querySelectorAll('[data-rm]').forEach(function(b){b.onclick=async function(){if(b.dataset.a!=='1'){b.dataset.a='1';b.textContent='再按一次確認';return}await fb.fs.deleteDoc(D('access',b.dataset.rm));admAccess()}});
  }catch(e){box.innerHTML='<div class="msg">讀取失敗：'+esc(e.code||e.message)+'</div>'}
}

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
  admAccess();
  var r=$('a-rep');r.innerHTML=REPORTS.length?'':'<div class="empty">沒有未處理的回報。</div>';
  REPORTS.forEach(function(x){var b=el('div','rep','<div><b>'+esc(x.slide)+'</b>　<span class="small">'+esc(x.name)+'・'+new Date(x.at).toLocaleString('zh-TW')+'</span></div><div class="pre">'+esc(x.text)+'</div><div class="row"><button type="button" class="btn sm go2">打開這張編輯</button><button type="button" class="btn sm warn dn">標為已處理</button></div>');
    b.querySelector('.go2').onclick=function(){if(BY[x.slide])admForm(x.slide)};
    b.querySelector('.dn').onclick=async function(){try{await fb.fs.updateDoc(D('reports',x._id),{done:true});loadReports()}catch(e){note('更新失敗：'+(e.code||e.message))}};
    r.appendChild(b)});
  admList();
}
function admList(){
  var q=$('a-q').value.trim().toLowerCase(),box=$('a-list');box.innerHTML='';
  SL.filter(function(d){return !q||(d.id+' '+d.dxfull+' '+d.unit).toLowerCase().indexOf(q)>=0}).slice().sort(function(a,b){return byNum(a.id,b.id)}).forEach(function(d){
    var b=el('div','it','<div class="row" style="justify-content:space-between;align-items:center"><div><b>'+esc(d.id)+'</b> <span class="small">'+(d.n?'('+esc(d.n)+')':'線上')+'・'+esc(d.unit||'')+(LINKS[d.id]?'・有連結':'')+(hasSlide(d.id)?'・已擷取':'')+(d.desc?'':'・<span class="no">缺描述</span>')+'</span><div>'+esc(d.dxfull)+'</div></div><button type="button" class="btn sm">編輯</button></div>');
    b.querySelector('button').onclick=function(){admForm(d.id)};
    if(LINKS[d.id]){var c=el('button','btn sm','開擷取視窗');c.type='button';c.onclick=function(){admCapture(d.id)};b.querySelector('.row').appendChild(c)}
    box.appendChild(b)});
}
function admForm(id){
  var isNew=!id,d=isNew?{id:'',n:'',unit:(P.units&&P.units[0])||allUnits()[allUnits().length-1]||'',dxfull:'',dx:'',organ:'',desc:'',note:'',link:''}:BY[id];
  var box=$('a-form');
  var F=[['id','片號（例 PA0400）'],['n','玻片號碼（空白 = 線上片）'],['unit','單元（例 Micro 2）'],['dxfull','診斷全文（顯示用）'],['dx','診斷關鍵字（批改用，空白 = 同上）'],['organ','器官'],['link','microteaching 連結（只有管理者看得到）']];
  box.innerHTML='<div class="fm rep"><b>'+(isNew?'新增片子':'編輯 '+esc(id))+'</b>'+F.map(function(x){return '<label>'+x[1]+'</label><input data-k="'+x[0]+'"'+(x[0]==='unit'?' list="ul"':'')+'>'}).join('')+
    '<datalist id="ul">'+allUnits().map(function(u){return '<option value="'+esc(u)+'">'}).join('')+'</datalist>'+
    '<label>說明（一行一點；開頭 * = 必寫）</label><div class="tb"><button type="button" data-m="==">螢光</button><button type="button" data-m="__"><b>粗體</b></button><button type="button" data-m="">清除格式</button></div><textarea data-k="desc" style="min-height:12rem"></textarea>'+
    '<label>備註</label><textarea data-k="note"></textarea>'+
    '<div class="row"><button type="button" class="btn sm primary sv">儲存</button><button type="button" class="btn sm cx">關閉</button>'+(isNew?'':'<button type="button" class="btn sm warn del">刪除這張</button>')+'</div><div class="msg"></div></div>';
  box.querySelectorAll('[data-k]').forEach(function(x){x.value=x.dataset.k==='link'?(LINKS[d.id]||''):(d[x.dataset.k]||'')});
  var ds=box.querySelector('[data-k=desc]');
  box.querySelectorAll('.tb button').forEach(function(b){b.onmousedown=function(ev){ev.preventDefault()};b.onclick=function(){wrap(ds,b.dataset.m)}});
  var msg=box.querySelector('.msg');
  box.querySelector('.cx').onclick=function(){box.innerHTML=''};
  box.querySelector('.sv').onclick=async function(){
    var o={};box.querySelectorAll('[data-k]').forEach(function(x){o[x.dataset.k]=x.dataset.k==='desc'||x.dataset.k==='note'?x.value.replace(/\s+$/,''):x.value.trim()});
    o.id=o.id.toUpperCase();if(!/^[A-Z0-9-]{3,20}$/.test(o.id)){msg.textContent='片號格式不對。';return}
    if(o.link&&!/^https?:\/\//i.test(o.link)){msg.textContent='連結要以 http:// 或 https:// 開頭。';return}
    if(!o.dxfull){msg.textContent='請填診斷。';return}
    if(!o.dx)o.dx=o.dxfull;if(!o.unit)o.unit='未分類';
    if((isNew||o.id!==id)&&BY[o.id]){msg.textContent=o.id+' 已經存在。';return}
    var lk=o.link;delete o.link;
    if(lk!==(LINKS[o.id]||'')||(!isNew&&o.id!==id)){if(!isNew&&o.id!==id)delete LINKS[id];if(lk)LINKS[o.id]=lk;else delete LINKS[o.id];
      try{await fb.fs.setDoc(D('admin','links'),{map:LINKS})}catch(e){msg.textContent='連結儲存失敗：'+(e.code||e.message);return}}
    var backup=SL.slice();
    if(isNew)SL.push(o);else SL[SL.indexOf(d)]=o;
    BY={};SL.forEach(function(x){BY[x.id]=x});
    if(await saveSlides(msg)){renderUnits();admList();renderAll();if(isNew)admForm(o.id);else if(o.id!==id)admForm(o.id)}
    else{SL=backup;BY={};SL.forEach(function(x){BY[x.id]=x})}
  };
  var del=box.querySelector('.del');if(del)del.onclick=async function(){
    if(del.dataset.a!=='1'){del.dataset.a='1';del.textContent='再按一次確認刪除';return}
    var backup=SL.slice();SL=SL.filter(function(x){return x.id!==id});BY={};SL.forEach(function(x){BY[x.id]=x});
    if(await saveSlides(msg)){box.innerHTML='';renderUnits();admList();renderAll()}else{SL=backup;BY={};SL.forEach(function(x){BY[x.id]=x})}};
  box.scrollIntoView({behavior:'smooth',block:'start'});
}

/* ---------- chrome ---------- */
function showTab(t){
  tab=t;['draw','seen','rev','adm'].forEach(function(k){$('t-'+k).setAttribute('aria-selected',k===t);$('v-'+k).hidden=k!==t});
  if(t==='seen')listSeen();if(t==='rev')listRev();if(t==='adm')renderAdmin();
}
function renderAll(){counts();progress();if(tab==='seen')listSeen();if(tab==='rev')listRev();refreshLive()}
['draw','seen','rev','adm'].forEach(function(k){$('t-'+k).onclick=function(){showTab(k)}});
$('draw').onclick=draw;
$('p-all').onclick=function(){setPool('all')};$('p-rev').onclick=function(){setPool('rev')};
$('rv-show').onclick=function(){rvHide=false;$('rv-show').setAttribute('aria-pressed',true);$('rv-hide').setAttribute('aria-pressed',false);listRev()};
$('rv-hide').onclick=function(){rvHide=true;$('rv-show').setAttribute('aria-pressed',false);$('rv-hide').setAttribute('aria-pressed',true);listRev()};
$('rv-key').onclick=function(){rvKey=!rvKey;$('rv-key').setAttribute('aria-pressed',rvKey);listRev()};
$('a-q').oninput=admList;$('a-new').onclick=function(){admForm(null)};
var armed=false;
$('reset').onclick=function(){
  if(!armed){armed=true;$('reset').textContent='再按一次確認重設';setTimeout(function(){armed=false;$('reset').textContent='重設進度'},4000);return}
  armed=false;$('reset').textContent='重設進度';
  var ids=poolIds();if(pool==='all')P.seen=P.seen.filter(function(x){return ids.indexOf(x)<0});else P.rseen=P.rseen.filter(function(x){return ids.indexOf(x)<0});
  saveP();counts();setPool(pool)};
$('login').onclick=login;$('login2').onclick=login;

try{await fbLoad()}catch(e){$('acct').textContent='';note('載入失敗（可能是網路問題或瀏覽器太舊），請重新整理或換瀏覽器。');return}
fb.au.getRedirectResult(fb.auth).catch(function(e){note('登入失敗：'+(e.code||e.message))});
fb.au.onAuthStateChanged(fb.auth,onUser);
})();
