'use strict';
/* Vaquero - Pastos & Datos. Todo vive en el equipo (IndexedDB "vaquero"). Basada en Corral 5.2.0. */
const VERSION = '1.1.0';
const BACKUP_SHEET = '_respaldo', APP_ID = 'APP_VAQUERO';
const CFG = { recordarCada: 10 };   // cada cuántos cambios recuerda descargar el Excel
const EA_TXT = {VP:'Vaca Parida',VS:'Vaca Seca',NV:'Novilla Vientre',HL:'Hembra Levante',CH:'Cría Hembra',CM:'Cría Macho',TR:'Toro',ML:'Macho Levante'};
/* Palabras de los comentarios de SG que se resaltan (se buscan sin tildes ni mayúsculas) */
const CLAVES = [['huerfan','HUÉRFANO'],['descart','DESCARTE'],['venta','VENTA'],['vender','VENTA'],['enferm','ENFERMO'],['coj','COJERA'],['renc','COJERA'],
  ['mastitis','MASTITIS'],['abort','ABORTO'],['gemel','GEMELAR'],['adopt','ADOPTADO'],['nodriza','NODRIZA'],['tratamiento','TRATAMIENTO'],['ciega','CIEGO'],['ciego','CIEGO'],
  ['tuert','TUERTO'],['muert','MUERTE'],['murio','MUERTE'],['brav','BRAVO'],['arisc','ARISCO'],['herid','HERIDA'],['prestad','PRESTADO'],['flac','FLACO'],['debil','DÉBIL'],['robad','ROBO'],['perdid','PERDIDO']];
const TABS = [
  ['inv','Inventario','<path d="M4 4h16v16H4zM4 10h16M4 15h16M10 4v16"/>'],
  ['busc','Buscar','<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/>'],
  ['mov','Movimientos','<path d="M4 8h14M15 5l3 3-3 3M20 16H6M9 13l-3 3 3 3"/>'],
  ['cont','Conteo','<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>'],
  ['mapa','Mapa','<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15"/>'],
  ['file','Archivo','<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>']
];

/* ---------- estado ---------- */
let meta = null, animals = new Map(), order = [], crias = new Map();
let tab = 'inv', S = {busc:{}, mov:{}}, TL = 'actual', movVista = false, movRows = [];
let db, installEvt = null, persisted = null;

const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const pad = n => String(n).padStart(2,'0');
const today = () => { const d=new Date(); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; };
const stamp = () => { const d=new Date(); return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const dayN = iso => Date.UTC(+iso.slice(0,4), +iso.slice(5,7)-1, +iso.slice(8,10))/864e5;
const daysBetween = (a,b) => dayN(b)-dayN(a);
const sinceBase = () => Math.max(0, daysBetween(meta.baseDate, today()));
const fmtD = iso => iso ? `${iso.slice(8,10)}/${iso.slice(5,7)}/${iso.slice(0,4)}` : '—';
const fmtTs = ts => ts ? `${fmtD(ts.slice(0,10))} ${ts.slice(11,16)}` : '';
const num = (v,d=1) => Number(v).toLocaleString('es-CO',{maximumFractionDigits:d,minimumFractionDigits:0});

/* ---------- datos derivados ---------- */
const ieTxt = a => { const p=[]; if(a.ie) p.push(a.ie.slice(-5)); if(a.az) p.push('AZ '+a.az); return p.join(' · ') || 'Sin chapeta'; };
const colorTxt = a => a.color || 'Sin registro';
const loteNow = a => a.w.mov ? a.w.mov.a : a.lote;
const gestNow = a => a.estado==='Preñada' ? a.gest + sinceBase() : 0;
const dabNow = a => a.estado==='Vacía' && a.dab>0 ? a.dab + sinceBase() : a.dab;
const mesesNow = a => a.emes + sinceBase()/30.4375;
const anosNow = a => mesesNow(a)/12;
const esCria = a => ['CH','CM'].includes(a.ea);
const gmdLabel = a => a.gmd ? `${num(a.gmd,0)} g/día` : '—';
const sexoTxt = a => a.sexo==='H' ? 'Hembra' : 'Macho';
function tipo(a){
  if(esCria(a)) return 'cria';
  if(a.ea==='TR') return 'toro';
  if(['HL','ML'].includes(a.ea)) return 'levante';
  if(['VP','VS','NV'].includes(a.ea) || (a.sexo==='H' && a.estado)) return 'vaca';
  return 'otro';
}
/* Edad en meses y días: con la fecha de nacimiento si viene en el Excel; si no, con E.Mes */
function edadMD(a){
  if(a.fnto){
    const n=new Date(a.fnto+'T00:00'), h=new Date();
    let m=(h.getFullYear()-n.getFullYear())*12+h.getMonth()-n.getMonth(), d=h.getDate()-n.getDate();
    if(d<0){ m--; d+=new Date(h.getFullYear(),h.getMonth(),0).getDate(); }
    if(m>=0) return {m,d};
  }
  const t=Math.max(0,Math.round(a.emes*30.4375+sinceBase())), m=Math.floor(t/30.4375);
  return {m,d:Math.round(t-m*30.4375)};
}
const edadMDTxt = a => { const {m,d}=edadMD(a); return `${m} ${m===1?'mes':'meses'} y ${d} ${d===1?'día':'días'}`; };
const edadAdulto = a => mesesNow(a)>=24 ? `${num(anosNow(a))} años` : `${num(mesesNow(a))} meses`;
const sinTilde = s => String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
function claves(a){
  const t=sinTilde(`${a.coment||''} ${a.nombre||''}`), out=[];
  for(const [k,l] of CLAVES) if(t.includes(k) && !out.includes(l)) out.push(l);
  return out;
}
const tieneNota = a => !!(a.coment || claves(a).length);
function comentHTML(a){
  if(!tieneNota(a)) return '';
  const c=claves(a);
  return `<div class="coment">${c.length?`<div class="chips">${c.map(x=>`<span class="tag">⚠ ${esc(x)}</span>`).join('')}</div>`:''}
  ${a.coment?`<p>Comentario: ${esc(a.coment)}</p>`:''}</div>`;
}

function indexar(){
  crias = new Map();
  for(const id of order){ const a=animals.get(id);
    if(esCria(a) && a.madre){ if(!crias.has(a.madre)) crias.set(a.madre,[]); crias.get(a.madre).push(id); } }
}
const criasDe = a => (crias.get(a.id)||[]).map(i=>animals.get(i));
/* Se mueven juntos: si es vaca, con sus crías; si es cría, con su madre y las otras crías de la madre */
function companeros(a){
  if(esCria(a)&&a.madre&&animals.has(a.madre)){ const m=animals.get(a.madre); return [m,...criasDe(m).filter(c=>c.id!==a.id)]; }
  return criasDe(a);
}
const ACOMP = m => m==='Con madre'||m==='Con su cría';
const acompTxt = m => m==='Con madre'?' · con la madre':m==='Con su cría'?' · con su cría':'';
const nombreComp = (c,a) => c.id===a.madre?`madre ${c.id}`:`cría ${c.id}`;
const stripZ = s => s.replace(/^0+(?=[0-9A-Z])/,'');
const norm = s => stripZ(String(s).toUpperCase().replace(/^TORO\s*/,'').replace(/\s+/g,''));
function buscar(qRaw){
  const q=qRaw.trim().toUpperCase().replace(/\s+/g,''); if(!q) return {items:[],exact:0};
  const nq=norm(q), ex=[], eq=[], pre=[];
  for(const id of order){ const a=animals.get(id), n=norm(id), up=id.toUpperCase();
    const ie5=a.ie?a.ie.slice(-5):'', az=a.az?stripZ(a.az):'';
    if(up===q) ex.push(a);
    else if(n===nq || (ie5 && stripZ(ie5)===nq) || (az && az===nq)) eq.push(a);
    else if(n.startsWith(nq) || ie5.startsWith(q)) pre.push(a);
  }
  pre.sort((x,y)=>norm(x.id).length-norm(y.id).length);
  return {items:[...ex,...eq,...pre].slice(0,7), exact:ex.length+eq.length};
}

/* ---------- IndexedDB (base "vaquero", nunca "corral") ---------- */
function openDB(){ return new Promise((ok,no)=>{
  const r=indexedDB.open('vaquero',2);
  r.onupgradeneeded=()=>{ const d=r.result;
    if(!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    if(!d.objectStoreNames.contains('animals')) d.createObjectStore('animals',{keyPath:'id'});
    if(!d.objectStoreNames.contains('mapa')) d.createObjectStore('mapa'); };
  r.onsuccess=()=>ok(r.result); r.onerror=()=>no(r.error);
});}
const txDone = t => new Promise((ok,no)=>{ t.oncomplete=ok; t.onerror=()=>no(t.error); t.onabort=()=>no(t.error); });
const tx = () => { try{ return db.transaction(['meta','animals'],'readwrite',{durability:'strict'}); }catch(e){ return db.transaction(['meta','animals'],'readwrite'); } };
async function loadDB(){
  const t=db.transaction(['meta','animals']);
  const get=r=>new Promise((ok,no)=>{r.onsuccess=()=>ok(r.result);r.onerror=()=>no(r.error);});
  const m=await get(t.objectStore('meta').get('m'));
  const all=await get(t.objectStore('animals').getAll());
  if(!m) return;
  meta=m; animals=new Map(all.map(a=>[a.id,a])); order=m.order; indexar();
}
async function replaceAll(m,list){
  const t=tx(); t.objectStore('animals').clear(); for(const a of list) t.objectStore('animals').put(a);
  m.order=list.map(a=>a.id); t.objectStore('meta').put(m,'m'); await txDone(t);
  meta=m; animals=new Map(list.map(a=>[a.id,a])); order=m.order; indexar();
}
async function commit(changes, delta=1){
  const nextMeta={...meta, cambios:Math.max(0,(meta.cambios||0)+delta)};
  try{
    const t=tx();
    for(const [a,w] of changes) t.objectStore('animals').put({...a,w});
    t.objectStore('meta').put(nextMeta,'m'); await txDone(t);
  }catch(e){ await alertBox('No se pudo guardar','El equipo no permitió guardar este dato. Descargue el Excel ahora y revise el espacio disponible.'); throw e; }
  for(const [a,w] of changes) a.w=w;
  meta=nextMeta;
}
async function saveMeta(){ const t=tx(); t.objectStore('meta').put(meta,'m'); await txDone(t); }
async function pedirPersistencia(){
  try{ if(navigator.storage&&navigator.storage.persist){ persisted=await navigator.storage.persisted()||await navigator.storage.persist(); } }catch(e){}
}

/* ---------- avisos ---------- */
let toastT;
function toast(msg, undo){
  const el=$('#toast'); el.innerHTML=`<span>${esc(msg)}</span>`+(undo?'<button id="undoBtn">Deshacer</button>':'');
  el.classList.add('show'); clearTimeout(toastT);
  toastT=setTimeout(()=>el.classList.remove('show'), undo?7000:3500);
  if(undo) $('#undoBtn').onclick=async()=>{ el.classList.remove('show'); await undo(); toast('Movimiento deshecho'); render(); };
}
function modal(html){ const m=$('#modal'); m.innerHTML=`<div class="sheet">${html}</div>`; m.classList.add('show'); return m; }
function closeModal(){ const m=$('#modal'); m.classList.remove('show'); m.innerHTML=''; }
function confirmBox(title,msg,ok='Confirmar',danger=false,cancel='Volver'){
  return new Promise(res=>{
    const m=modal(`<h2>${esc(title)}</h2><p>${esc(msg)}</p><button class="big ${danger?'danger':''}" id="mOk">${esc(ok)}</button><button class="big sec" id="mNo">${esc(cancel)}</button>`);
    m.querySelector('#mOk').onclick=()=>{closeModal();res(true);}; m.querySelector('#mNo').onclick=()=>{closeModal();res(false);};
  });
}
function alertBox(title,msg){ return new Promise(res=>{
  const m=modal(`<h2>${esc(title)}</h2><p>${esc(msg)}</p><button class="big" id="mOk">Entendido</button>`);
  m.querySelector('#mOk').onclick=()=>{closeModal();res();};
});}
/* Alerta de copia: recuerda descargar el Excel para no perder el trabajo */
function recordatorio(){ const c=meta?.cambios||0; if(c>0 && c%CFG.recordarCada===0) toastBackup(c); }
function toastBackup(c){
  const el=$('#toast'); el.innerHTML=`<span>Lleva ${c} cambios sin descargar. Descargue el Excel como copia.</span><button id="bk">Descargar</button>`;
  el.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>el.classList.remove('show'),9000);
  $('#bk').onclick=()=>{ el.classList.remove('show'); descargar(); };
}

/* ---------- pantalla ---------- */
function render(){ renderTop(); renderNav(); renderMain(); }
function renderTop(){
  const c=meta?.cambios||0;
  $('#top').innerHTML=`<div class="brand"><b>${esc(meta?meta.finca:'Vaquero')}</b><small>${meta?`${order.length} animales`:'Pastos & Datos'}</small></div>`+
    (meta?`<button class="pill ${c?'warn':''}" data-a="goFile">${c?`⚠ ${c} sin descargar`:'Respaldado ✓'}</button>`:'');
}
function renderNav(){
  $('#nav').innerHTML=TABS.map(([k,t,ic])=>`<button data-tab="${k}" class="${k===tab?'on':''}" style="${!meta&&k!=='file'&&k!=='mapa'?'opacity:.35':''}"><svg viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>${t}</button>`).join('');
}
function renderMain(){
  const m=$('#main');
  if(!meta && tab!=='file' && tab!=='mapa') tab='file';
  if(tab==='file'){ m.className='narrow'; m.innerHTML=viewFile(); }
  else if(tab==='inv'){ m.className='wide'; m.innerHTML=viewInventario(); }
  else if(tab==='cont'){ m.className='cont'; m.innerHTML=viewConteo(); }
  else if(tab==='mapa'){ m.className='mapa'; m.innerHTML=viewMapa(); montarMapa(); }
  else if(tab==='mov'&&movVista){ m.className='wide'; m.innerHTML=viewMov(); }
  else {
    const s=S[tab], a=s.id?animals.get(s.id):null;
    m.className='split';
    if(!a){ m.innerHTML=viewSearch(); pintarResultados(); }
    else m.innerHTML=paneles(tab==='busc'?viewFicha(a):viewMover(a));
  }
}
function paneles(h){ const i=h.indexOf('<!--R-->'); return i<0?`<div class="pane pr">${h}</div>`:`<div class="pane pl">${h.slice(0,i)}</div><div class="pane pr">${h.slice(i+8)}</div>`; }

/* ---------- buscador con teclado numérico (Buscar y Movimientos) ---------- */
const AYUDA={busc:'Número o chapeta del animal',mov:'Número o chapeta del animal a mover'};
function viewSearch(){
  const s=S[tab], mode=s.abc?'':'readonly inputmode="none"';
  const nMov=order.filter(i=>animals.get(i).w.hist?.length).length;
  return `<div class="pane pl">${tab==='mov'?`<button class="topbtn" data-a="verMovs">Ver movimientos realizados (${nMov})</button>`:''}
  <div class="searchbox"><input id="q" ${mode} autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${AYUDA[tab]}" value="${esc(s.q||'')}"></div>
  <div class="keys">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-k="${n}">${n}</button>`).join('')}
    <button data-k="-">-</button><button data-k="0">0</button><button class="k2" data-k="del" aria-label="Borrar">⌫</button>
    <button class="k2" data-k="abc">${s.abc?'123':'ABC'}</button><button class="go" data-k="ok">Buscar</button></div></div>
  <div class="pane pr"><div class="results" id="res"></div></div>`;
}
function pintarResultados(){
  const s=S[tab], el=$('#res'); if(!el) return;
  const q=(s.q||'').trim();
  if(!q){ el.innerHTML=`<p class="hint">${tab==='mov'?'Busque el animal que va a mover.':'Busque cualquier animal: vacas, toros, crías o levante.'}</p>`; return; }
  const {items,exact}=buscar(q);
  if(!items.length){ el.innerHTML=`<div class="alert a">El ${esc(q)} no está en el inventario. Anótelo en papel para verificarlo después.</div>`; return; }
  const many=exact>1?`<div class="alert b">Hay ${exact} coincidencias. Elija el animal correcto.</div>`:'';
  el.innerHTML=many+items.slice(0,exact>1?7:4).map((a,i)=>`<button class="res ${i<exact?'first':''}" data-pick="${esc(a.id)}"><b>${esc(a.id)}</b><span>${tieneNota(a)?'<em class="wn">⚠</em> ':''}${esc(a.ea)} · ${esc(colorTxt(a))} · ${esc(ieTxt(a))} · ${esc(loteNow(a))}</span></button>`).join('');
}
function pick(id){
  if(!animals.has(id)) return;
  S[tab]={id, q:'', dest:''};
  $('#main').scrollTop=0; renderMain();
}
function head(a){
  const tags=[`<span class="tag">${esc(a.ea)} · ${esc(EA_TXT[a.ea]||'')}</span>`];
  if(a.nombre) tags.push(`<span class="tag">${esc(a.nombre)}</span>`);
  if(a.w.mov) tags.push(`<span class="tag b">Movido a ${esc(a.w.mov.a)}</span>`);
  return `<div class="chead"><div class="num">${esc(a.id)}</div><button class="close" data-a="clear">Otro animal</button></div><div class="tags">${tags.join('')}</div>`;
}
function kv(items){ return `<div class="kv">${items.filter(Boolean).map(([k,v,w])=>`<div class="${w?'wide':''}"><small>${esc(k)}</small><b>${esc(v)}</b></div>`).join('')}</div>`; }

/* ---------- ficha del animal (pestaña Buscar) ---------- */
function filaCria(c){
  return `<button class="res" data-pick="${esc(c.id)}"><b>${esc(c.id)}</b><span>${tieneNota(c)?'<em class="wn">⚠</em> ':''}${esc(c.ea)} · ${esc(edadMDTxt(c))} · ${esc(colorTxt(c))} · ${esc(loteNow(c))}</span></button>`;
}
function viewFicha(a){
  const t=tipo(a), lote=['Lote',loteNow(a)];
  let datos, extra='', nota='';
  if(t==='vaca'){
    const pren=a.estado==='Preñada', vac=a.estado==='Vacía';
    datos=[['Estado reprod.',a.estado||'Sin dato'],pren?['Gestación',`${gestNow(a)} días`]:null,vac?['Días abiertos',dabNow(a)||'—']:null,
      ['Partos (#P)',a.np||0],['UIEP',a.uiep||'—'],vac?['Det. últ. tacto',a.dtacto||'Sin dato']:null,['Fecha últ. tacto',fmtD(a.ftacto)],
      lote,['Edad',edadAdulto(a)],['Color',colorTxt(a)],['I.E. / chapeta',ieTxt(a)]];
    nota=`<p class="hint" style="text-align:left;margin:0">Datos reproductivos del Excel de SG al ${fmtD(meta.baseDate)}; la gestación y los días abiertos se calculan a hoy.</p>`;
    const cs=criasDe(a);
    extra=`<div class="card"><h3>Crías al pie (${cs.length})</h3>${cs.length?`<div class="plist">${cs.map(filaCria).join('')}</div>`:'<p class="hint" style="text-align:left">Sin cría registrada.</p>'}</div>`;
  } else if(t==='toro'){
    datos=[lote,['Edad',edadAdulto(a)],['Color',colorTxt(a)],['I.E. / chapeta',ieTxt(a)]];
  } else if(t==='cria'){
    datos=[['Edad',edadMDTxt(a),true],['Sexo',sexoTxt(a)],lote,['Color',colorTxt(a)],['I.E. / chapeta',ieTxt(a)],['Madre',a.madre||'Sin registro']];
    const m=a.madre&&animals.get(a.madre);
    if(m){
      const otro=loteNow(m)!==loteNow(a);
      extra=`${otro?`<div class="alert a">La madre ${esc(m.id)} está en el lote ${esc(loteNow(m))}, no en ${esc(loteNow(a))}.</div>`:''}
      <div class="card"><h3>Madre</h3><button class="res" data-pick="${esc(m.id)}"><b>${esc(m.id)}</b><span>${tieneNota(m)?'<em class="wn">⚠</em> ':''}${esc(m.ea)} · ${esc(colorTxt(m))} · ${esc(loteNow(m))}</span></button></div>`;
    } else if(a.madre) extra=`<div class="alert b">La madre ${esc(a.madre)} no está en este inventario.</div>`;
  } else if(t==='levante'){
    datos=[lote,['Edad',`${num(mesesNow(a))} meses`],['Sexo',sexoTxt(a)],['Color',colorTxt(a)],['Fecha último peso',fmtD(a.fupeso)],['Último peso',a.upeso?`${num(a.upeso)} kg`:'—'],['GMD anterior',gmdLabel(a)],['I.E. / chapeta',ieTxt(a)]];
  } else datos=[lote,['Edad',edadAdulto(a)],['Sexo',sexoTxt(a)],['Color',colorTxt(a)],['I.E. / chapeta',ieTxt(a)]];
  const hist=(a.w.hist||[]).slice().reverse();
  return `<div class="card">${head(a)}${kv(datos)}</div>${comentHTML(a)}${nota}<!--R-->
  ${extra}
  ${hist.length?`<div class="card"><h3>Movimientos de hoy en adelante</h3>${hist.map(h=>`<p>${esc(h.de)} → <b>${esc(h.a)}</b> <small>${fmtTs(h.ts)}${acompTxt(h.motivo)}</small></p>`).join('')}</div>`:''}
  <button class="big" data-go="mov" data-id="${esc(a.id)}">Mover este animal</button>`;
}

/* ---------- mover (pestaña Movimientos) ---------- */
function recordarMov(de,a){ const r=(meta.recMov||[]).filter(x=>!(x.de===de&&x.a===a)); r.unshift({de,a}); meta.recMov=r.slice(0,20); }
/* Últimos destinos usados: primero los que salieron del mismo lote */
function rapidos(a){
  const cur=loteNow(a), r=meta.recMov||[], out=[];
  for(const x of [...r.filter(x=>x.de===cur),...r]) if(x.a!==cur&&!out.includes(x.a)) out.push(x.a);
  return out.slice(0,4);
}
function viewMover(a){
  const s=S.mov, cur=loteNow(a);
  const cs=companeros(a).filter(c=>s.dest?loteNow(c)!==s.dest:true);
  const q=rapidos(a);
  const lotes=meta.lotes.filter(l=>l!==cur);
  let h=`<div class="card">${head(a)}<p style="margin-top:8px">Lote actual</p><div class="lotebig">${esc(cur)}</div>
  ${kv([['Categoría',`${a.ea} ${EA_TXT[a.ea]||''}`],['Color',colorTxt(a)],['I.E. / chapeta',ieTxt(a)],esCria(a)?['Edad',edadMDTxt(a)]:['Edad',edadAdulto(a)]])}</div>${comentHTML(a)}`;
  if(cs.length) h+=`<div class="alert b">Se mueve${cs.length>1?'n':''} también: ${cs.map(c=>`${esc(nombreComp(c,a))} (${esc(c.ea)}${loteNow(c)!==cur?`, hoy en ${esc(loteNow(c))}`:''})`).join(', ')}.</div>`;
  h+='<!--R-->';
  if(a.w.mov) h+=`<div class="alert b">Ya se movió: ${esc(a.w.mov.de)} → ${esc(a.w.mov.a)} el ${fmtTs(a.w.mov.ts)}.</div>`;
  if(q.length) h+=`<div class="quick"><small>Mover rápido (últimos lotes usados)</small><div class="opts">${q.map(l=>`<button class="opt ${s.dest===l?'on':''}" data-qmov="${esc(l)}">→ ${esc(l)}</button>`).join('')}</div></div>`;
  h+=`<div class="field"><label for="fDest">${q.length?'U otro lote':'Mover al lote'}</label><select id="fDest" data-f="dest"><option value="">Elija el lote</option>${lotes.map(l=>`<option ${s.dest===l?'selected':''}>${esc(l)}</option>`).join('')}<option value="__otro">Otro lote nuevo…</option></select></div>`;
  h+=`<div class="savebar"><button class="big" data-a="saveMov" ${s.dest?'':'disabled'}>${s.dest?`Mover a ${esc(s.dest)}${cs.length?` con ${esc(cs.map(c=>nombreComp(c,a)).join(', '))}`:''}`:'Elija el lote destino'}</button></div>`;
  return h;
}
function moverW(x,dest,motivo,ts,con){
  const w=clone(x.w), prev=loteNow(x);
  w.hist=[...(w.hist||[]),{de:prev,a:dest,motivo,ts,con}];
  if(dest===x.lote) delete w.mov; else w.mov={de:x.lote,a:dest,motivo,ts,con};
  w.ts=ts; return w;
}
async function saveMov(){
  const s=S.mov, a=animals.get(s.id), dest=s.dest; if(!a||!dest) return;
  if(dest===loteNow(a)) return alertBox('Mismo lote',`${a.id} ya está en ${dest}.`);
  const ts=stamp(), cs=companeros(a).filter(c=>loteNow(c)!==dest);
  recordarMov(loteNow(a),dest);
  const ch=[[a,moverW(a,dest,'Movimiento',ts)],...cs.map(c=>[c,moverW(c,dest,c.id===a.madre?'Con su cría':'Con madre',ts,a.id)])];
  const prev=ch.map(([x])=>[x,clone(x.w)]);
  await commit(ch,1);
  S.mov={}; render();
  toast(`✓ ${a.id} → ${dest}${cs.length?` con ${cs.map(c=>nombreComp(c,a)).join(', ')}`:''}`, async()=>{ await commit(prev,-1); });
  recordatorio();
}
/* Deshace el último movimiento de un animal (y de la madre o crías movidas con él) */
async function deshacer(id){
  const a=animals.get(id), h=a?.w.hist; if(!h||!h.length) return;
  const last=h[h.length-1];
  const hijos=companeros(a).filter(c=>{ const x=c.w.hist; return x&&x.length&&x[x.length-1].ts===last.ts&&ACOMP(x[x.length-1].motivo); });
  if(!await confirmBox('Deshacer movimiento',`${id} vuelve de ${last.a} a ${last.de}${hijos.length?` con ${hijos.map(c=>nombreComp(c,a)).join(', ')}`:''}.`,'Deshacer',true)) return;
  const back=x=>{ const w=clone(x.w); w.hist.pop(); const p=w.hist[w.hist.length-1];
    if(p&&p.a!==x.lote) w.mov={de:x.lote,a:p.a,motivo:p.motivo,ts:p.ts}; else delete w.mov; w.ts=stamp(); return w; };
  await commit([[a,back(a)],...hijos.map(c=>[c,back(c)])],1);
  closeModal(); render(); toast(`Movimiento de ${id} deshecho`); recordatorio();
}

/* ---- resumen de movimientos (solo consulta) ---- */
function movResumen(){
  const g=new Map();
  for(const id of order){ const a=animals.get(id), m=a.w.mov; if(!m) continue;
    const k=m.de+'\u0001'+m.a;
    if(!g.has(k)) g.set(k,{de:m.de||'Sin lote',a:m.a,n:0,mot:{},ids:[]});
    const r=g.get(k); r.n++; r.mot[m.motivo]=(r.mot[m.motivo]||0)+1; r.ids.push(id);
  }
  return [...g.values()].sort((x,y)=>x.de.localeCompare(y.de,'es')||y.n-x.n||x.a.localeCompare(y.a,'es'));
}
const motTxt = r => [['Movimiento','Manual'],['Con madre','Con la madre'],['Con su cría','Con su cría']].filter(([m])=>r.mot[m]).map(([m,t])=>`${t} ${r.mot[m]}`).join(' · ');
function conteoLotes(){
  const ini={}, hoy={};
  for(const id of order){ const a=animals.get(id); ini[a.lote]=(ini[a.lote]||0)+1; const l=loteNow(a); hoy[l]=(hoy[l]||0)+1; }
  return {ini,hoy};
}
function historial(){
  const h=[]; for(const id of order){ const a=animals.get(id); (a.w.hist||[]).forEach((x,i,arr)=>h.push({id,...x,ultimo:i===arr.length-1})); }
  return h.sort((x,y)=>y.ts.localeCompare(x.ts));
}
function viewMov(){
  movRows=movResumen(); const {ini,hoy}=conteoLotes(), tot=movRows.reduce((s,r)=>s+r.n,0);
  const top=`<div class="secthead"><h2>Movimientos realizados</h2><button class="close" data-a="volverMov">← Mover</button></div>`;
  if(!movRows.length&&!historial().length) return top+'<p class="hint">Aún no se ha movido ningún animal de lote.</p>';
  const lotesO=new Set(movRows.map(r=>r.de)).size, lotesD=new Set(movRows.map(r=>r.a)).size;
  const ult=historial().filter(x=>!ACOMP(x.motivo)).slice(0,30);
  return `${top}<div class="stats" style="grid-template-columns:repeat(3,1fr)"><div><b>${tot}</b><small>Animales movidos</small></div><div><b>${lotesO}</b><small>Lotes de origen</small></div><div><b>${lotesD}</b><small>Lotes de destino</small></div></div>
  ${movRows.length?`<table class="mtab"><thead><tr><th>Lote origen</th><th></th><th>Lote destino</th><th class="n">Movidos</th><th class="n">Quedan en origen</th></tr></thead><tbody>
  ${movRows.map((r,i)=>`<tr data-mv="${i}"><td><b>${esc(r.de)}</b></td><td class="ar">→</td><td><b>${esc(r.a)}</b><small>${esc(motTxt(r))}</small></td><td class="n">${r.n}</td><td class="n">${hoy[r.de]||0}<small>de ${ini[r.de]||0}</small></td></tr>`).join('')}
  </tbody><tfoot><tr><td colspan="3">Total</td><td class="n">${tot}</td><td></td></tr></tfoot></table>
  <p class="hint">Toque una fila para ver los animales. Cuenta dónde está hoy cada animal frente al lote con que se cargó el Excel. "Quedan en origen" son los que hay hoy en ese lote, de los que tenía al cargar.</p>`:''}
  <h3>Últimos movimientos</h3><div class="plist">${ult.map(x=>`<div class="hrow"><div><b>${esc(x.id)}</b> <span>${esc(x.de)} → <b>${esc(x.a)}</b></span><small>${fmtTs(x.ts)}</small></div>${x.ultimo?`<button class="undo" data-undo="${esc(x.id)}">Deshacer</button>`:''}</div>`).join('')}</div>`;
}
function verMov(i){
  const r=movRows[i]; if(!r) return;
  modal(`<div class="chead"><div class="num" style="font-size:calc(24px*var(--k))">${esc(r.de)} → ${esc(r.a)}</div><button class="close" data-a="closeM">Cerrar</button></div>
  <p class="hint">${r.n} animales · ${esc(motTxt(r))}</p>
  <div class="plist">${r.ids.map(id=>{const a=animals.get(id);return `<div class="hrow"><div><b>${esc(id)}</b><small>${esc(a.ea)} · ${esc(colorTxt(a))} · ${esc(ieTxt(a))}${acompTxt(a.w.mov.motivo)}</small></div>${ACOMP(a.w.mov.motivo)?'':`<button class="undo" data-undo="${esc(id)}">Deshacer</button>`}</div>`;}).join('')}</div>`);
}

/* ---------- inventario por lote y categoría ---------- */
const EA_ORD = ['VP','VS','NV','HL','CH','CM','ML','TR'];
function tablaLotes(modo){
  const t={}, eas=new Set(), ini={};
  for(const id of order){ const a=animals.get(id), l=modo==='inicial'?a.lote:loteNow(a), e=a.ea;
    eas.add(e); (t[l]=t[l]||{})[e]=(t[l][e]||0)+1; ini[a.lote]=(ini[a.lote]||0)+1; }
  const cols=[...eas].sort((x,y)=>(EA_ORD.indexOf(x)+1||99)-(EA_ORD.indexOf(y)+1||99)||x.localeCompare(y));
  const lotes=Object.keys(t).sort((x,y)=>x.localeCompare(y,'es'));
  return {t,cols,lotes,ini};
}
function viewInventario(){
  const {t,cols,lotes,ini}=tablaLotes(TL), base=TL==='actual'?tablaLotes('inicial').t:null;
  const tot=l=>cols.reduce((s,c)=>s+(t[l][c]||0),0), colTot=c=>lotes.reduce((s,l)=>s+(t[l][c]||0),0);
  const celda=(l,c)=>{ const v=t[l][c]||0, b=base?((base[l]||{})[c]||0):v; return `<td class="${v!==b?'chg':''} ${v?'':'z'}">${v||'·'}</td>`; };
  const dif=l=>{ if(!base) return ''; const d=tot(l)-(ini[l]||0); return d?`<small class="${d>0?'up':'dn'}">${d>0?'+':'−'}${Math.abs(d)}</small>`:''; };
  const movidos=order.filter(i=>animals.get(i).w.mov).length;
  return `<div class="stats" style="grid-template-columns:repeat(3,1fr)"><div><b>${order.length}</b><small>Animales</small></div><div><b>${lotes.length}</b><small>Lotes ${TL==='actual'?'hoy':'al cargar'}</small></div><div><b>${movidos}</b><small>Movidos</small></div></div>
  <div class="tlwrap open"><div class="tlhead"><b>Inventario por lote</b><div class="seg sm"><button data-tl="inicial" class="${TL==='inicial'?'on':''}">Inicial</button><button data-tl="actual" class="${TL==='actual'?'on':''}">Actual</button></div></div>
  <p class="hint tlnote">${TL==='inicial'?`Como se cargó el Excel (${fmtD(meta.baseDate)}), antes de cualquier movimiento.`:'Con los movimientos registrados. En color lo que cambió; ± frente al inicial. Toque un lote para ver sus animales.'}</p>
  <div class="tlscroll"><table class="tlot"><thead><tr><th class="lt">Lote</th>${cols.map(c=>`<th title="${esc(EA_TXT[c]||c)}">${esc(c)}</th>`).join('')}<th class="tt">Total</th></tr></thead>
  <tbody>${lotes.map(l=>`<tr data-tlote="${esc(l)}"><td class="lt">${esc(l)}</td>${cols.map(c=>celda(l,c)).join('')}<td class="tt">${tot(l)}${dif(l)}</td></tr>`).join('')}</tbody>
  <tfoot><tr><td class="lt">Total</td>${cols.map(c=>`<td>${colTot(c)}</td>`).join('')}<td class="tt">${order.length}</td></tr></tfoot></table></div>
  <p class="hint tlnote">${cols.map(c=>`${c}: ${EA_TXT[c]||c}`).join(' · ')}</p></div>`;
}
function verLote(l){
  const list=order.map(i=>animals.get(i)).filter(a=>(TL==='inicial'?a.lote:loteNow(a))===l)
    .sort((x,y)=>(EA_ORD.indexOf(x.ea)+1||99)-(EA_ORD.indexOf(y.ea)+1||99)||x.id.localeCompare(y.id,'es',{numeric:true}));
  modal(`<div class="chead"><div class="num" style="font-size:calc(24px*var(--k))">${esc(l)}</div><button class="close" data-a="closeM">Cerrar</button></div>
  <p class="hint">${list.length} animales ${TL==='inicial'?'al cargar el Excel':'hoy'}. Toque uno para ver su ficha.</p>
  <div class="plist">${list.map(a=>`<button class="res" data-ver="${esc(a.id)}"><b>${esc(a.id)}</b><span>${tieneNota(a)?'<em class="wn">⚠</em> ':''}${esc(a.ea)} · ${esc(colorTxt(a))} · ${esc(ieTxt(a))}${a.w.mov?` · desde ${esc(a.lote)}`:''}</span></button>`).join('')}</div>`);
}

/* ---------- conteo con botón grande y sonido ---------- */
let AC, cntSave;
const K = () => meta.cnt || (meta.cnt={lote:'',n:0});
function esperados(l){ const r={n:0,cr:0}; for(const id of order){ const a=animals.get(id); if(loteNow(a)===l){ r.n++; if(esCria(a)) r.cr++; } } return r; }
function difHTML(){
  const k=K(); if(!k.lote) return '';
  const e=esperados(k.lote).n, d=k.n-e;
  return d===0?`<div class="cdif ok" id="cDif">Coincide ✓ (${e})</div>`:d<0?`<div class="cdif faltan" id="cDif">Faltan ${-d} de ${e}</div>`:`<div class="cdif sobran" id="cDif">Sobran ${d} (esperados ${e})</div>`;
}
function viewConteo(){
  const k=K(), lotes=[...new Set(order.map(i=>loteNow(animals.get(i))))].sort((a,b)=>a.localeCompare(b,'es'));
  const e=k.lote?esperados(k.lote):null, son=meta.sonido!==false;
  const cs=(meta.conteos||[]).slice().reverse();
  return `<div class="cR"><div class="field"><label for="cLote">Lote que va a contar</label><select id="cLote" data-c="lote"><option value="">Conteo libre (sin lote)</option>${lotes.map(l=>`<option value="${esc(l)}" ${k.lote===l?'selected':''}>${esc(l)} (${esperados(l).n})</option>`).join('')}</select></div>
  ${e?`<p class="hint" style="padding:0">Según el inventario actual: <b>${e.n}</b> animales${e.cr?` (${e.n-e.cr} adulto${e.n-e.cr===1?"":"s"} + ${e.cr} cría${e.cr===1?"":"s"})`:''}</p>`:''}
  </div><div class="cL"><button class="cntbtn" id="cntBtn" aria-label="Contar un animal"><b id="cntN">${k.n}</b><small>TOQUE PARA CONTAR</small></button></div>
  <div class="cR">${difHTML()||'<div id="cDif"></div>'}
  <div class="cbar"><button class="opt" data-a="cMenos">−1</button><button class="opt" data-a="cReset">Reiniciar</button><button class="opt" data-a="cSonido">${son?'🔊 Sonido':'🔇 Sin sonido'}</button></div>
  <button class="big" data-a="cGuardar" ${k.n?'':'disabled'}>Guardar conteo${k.lote?` de ${esc(k.lote)}`:''}</button>
  <p class="hint" style="padding:0">Suba el volumen del equipo. Cada 10 animales suena un tono doble.</p>
  ${cs.length?`<h3>Conteos guardados</h3><table class="mtab"><thead><tr><th>Lote</th><th class="n">Contados</th><th class="n">Esperados</th><th class="n">Dif.</th><th></th></tr></thead><tbody>
  ${cs.map(c=>{ const d=c.esp==null?'':c.n-c.esp; return `<tr><td><b>${esc(c.lote||'Libre')}</b><small>${fmtTs(c.ts)}</small></td><td class="n">${c.n}</td><td class="n">${c.esp??'—'}</td><td class="n">${d===''?'—':d>0?'+'+d:d}</td><td><button class="cdel" data-cdel="${esc(c.ts)}" aria-label="Borrar">✕</button></td></tr>`; }).join('')}</tbody></table>`:''}</div>`;
}
function tono(f,t0,dur){
  const o=AC.createOscillator(), g=AC.createGain(), t=AC.currentTime+t0;
  o.type='square'; o.frequency.setValueAtTime(f,t);
  g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(1,t+0.005); g.gain.setValueAtTime(1,t+dur-0.02); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
  o.connect(g).connect(AC.destination); o.start(t); o.stop(t+dur+0.01);
}
function sonar(n){
  if(navigator.vibrate) navigator.vibrate(n%10===0?[60,40,60]:40);
  if(meta.sonido===false) return;
  try{
    AC=AC||new (window.AudioContext||window.webkitAudioContext)(); if(AC.state==='suspended') AC.resume();
    if(n%10===0){ tono(1760,0,0.12); tono(2350,0.15,0.18); } else tono(1760,0,0.14);
  }catch(e){}
}
function guardarCnt(){ clearTimeout(cntSave); cntSave=setTimeout(()=>saveMeta().catch(()=>{}),250); }
function pintarCnt(){
  const k=K(); $('#cntN').textContent=k.n;
  const d=$('#cDif'); if(d) d.outerHTML=difHTML()||'<div id="cDif"></div>';
  const g=document.querySelector('[data-a="cGuardar"]'); if(g) g.disabled=!k.n;
}
function contar(){
  const k=K(); k.n++; sonar(k.n); pintarCnt(); guardarCnt();
  const b=$('#cntBtn'); b.classList.add('hit'); setTimeout(()=>b.classList.remove('hit'),90);
}
async function guardarConteo(){
  const k=K(); if(!k.n) return;
  const esp=k.lote?esperados(k.lote).n:null;
  meta.conteos=[...(meta.conteos||[]),{lote:k.lote,n:k.n,esp,ts:stamp()}];
  const msg=`Conteo guardado: ${k.n}${k.lote?` en ${k.lote}`:''}${esp!=null?(k.n===esp?' · coincide ✓':` · esperados ${esp}`):''}`;
  meta.cnt={lote:k.lote,n:0}; meta.cambios=(meta.cambios||0)+1; await saveMeta();
  render(); toast(msg); recordatorio();
}

/* ---------- archivo ---------- */
function viewFile(){
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent), standalone=matchMedia('(display-mode: standalone)').matches||navigator.standalone;
  const inst=standalone?'':ios?`<div class="alert a">En iPhone, instale la app para proteger los datos: en Safari toque Compartir y luego "Agregar a inicio". Use siempre el ícono, no el navegador.</div>`:
    installEvt?`<button class="big sec" data-a="install">Instalar la app</button>`:'';
  if(!meta) return `<div class="empty"><img src="icon-192.png" alt="" style="width:96px;height:96px;border-radius:20px;align-self:center"><h2 style="text-align:center">Vaquero</h2><p>Suba el Excel del Software Ganadero o un archivo de avance descargado de Vaquero.</p>${inst}<button class="big" data-a="upload">Subir Excel</button><p class="hint">Versión ${VERSION}. Funciona sin internet.</p></div>`;
  const c=meta.cambios||0, movidos=order.filter(i=>animals.get(i).w.mov).length;
  return `<h2>${esc(meta.finca)}</h2>${inst}
  <div class="stats"><div><b>${order.length}</b><small>Animales</small></div><div><b>${movidos}</b><small>Movidos</small></div><div><b>${new Set(order.map(i=>loteNow(animals.get(i)))).size}</b><small>Lotes</small></div><div><b>${(meta.conteos||[]).length}</b><small>Conteos</small></div></div>
  <div class="alert ${c?'a':'g'}">${c?`${c} cambios sin descargar. Descargue el Excel como copia de seguridad.`:'Todo el avance está descargado.'}</div>
  <button class="big" data-a="download">Descargar Excel</button>
  <button class="big sec" data-a="share">Enviar por WhatsApp o Drive</button>
  <button class="big sec" data-a="upload">Subir otro Excel</button>
  <p class="hint">${order.length} animales · Datos del Excel al ${fmtD(meta.baseDate)} <button class="lnk" data-a="cambiarFecha">Corregir fecha</button>${meta.lastExport?` · Última descarga ${fmtTs(meta.lastExport)}`:''}<br>${persisted===false?'El equipo no garantiza el almacenamiento: descargue con frecuencia.<br>':''}Versión ${VERSION}</p>`;
}
const serial = iso => dayN(iso)+25569;
const cD = iso => iso?{t:'n',v:serial(iso),z:'dd/mm/yyyy'}:'';
const fecha = ts => ts?cD(ts.slice(0,10)):'';
const hora = ts => ts?ts.slice(11,16):'';
function hoja(wb,name,head,rows){
  const ws=XLSX.utils.aoa_to_sheet([head,...rows]);
  ws['!cols']=head.map(h=>({wch:Math.max(10,String(h).length+2)}));
  if(rows.length) ws['!autofilter']={ref:XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length,c:head.length-1}})};
  XLSX.utils.book_append_sheet(wb,ws,name);
}
function construirExcel(){
  const wb=XLSX.utils.book_new(), all=order.map(i=>animals.get(i));
  hoja(wb,'Inventario',['Número','Sexo','EA','Color','I.E.','Madre','Lote inicial','Lote actual','Movido','Fecha movimiento','Hora movimiento','Estado reprod.','Comentario','Alertas comentario'],
    all.map(a=>[a.id,a.sexo,a.ea,a.color,ieTxt(a),a.madre||'',a.lote,loteNow(a),a.w.mov?'SI':'NO',fecha(a.w.mov?.ts),hora(a.w.mov?.ts),a.estado||'',a.coment||'',claves(a).join(', ')]));
  const H=historial().reverse().map(x=>{ const a=animals.get(x.id); return [x.id,a.ea,x.de,x.a,x.motivo==='Con madre'?`Con la madre ${x.con||a.madre}`:x.motivo==='Con su cría'?`Con su cría ${x.con||''}`:'Manual',fecha(x.ts),hora(x.ts)]; });
  hoja(wb,'Movimientos',['Número','EA','Lote anterior','Lote nuevo','Motivo','Fecha','Hora'],H);
  const CL=conteoLotes(), RM=movResumen().map(r=>[r.de,r.a,r.mot.Movimiento||0,r.mot['Con madre']||0,r.mot['Con su cría']||0,r.n,CL.ini[r.de]||0,CL.hoy[r.de]||0]);
  if(RM.length) RM.push(['TOTAL','',...[2,3,4,5].map(c=>RM.reduce((s,r)=>s+r[c],0)),'','']);
  hoja(wb,'Resumen movimientos',['Lote origen','Lote destino','Movimiento manual','Con la madre','Con su cría','Total animales','Había en origen','Quedan en origen'],RM);
  for(const [modo,nom] of [['inicial','Inv. lote inicial'],['actual','Inv. lote actual']]){
    const {t,cols,lotes}=tablaLotes(modo);
    const rows=lotes.map(l=>{ const v=cols.map(c=>t[l][c]||0); return [l,...v,v.reduce((a,b)=>a+b,0)]; });
    rows.push(['TOTAL',...cols.map((c,i)=>rows.reduce((s,r)=>s+r[i+1],0)),order.length]);
    hoja(wb,nom,['Lote',...cols,'Total'],rows);
  }
  hoja(wb,'Conteos',['Fecha','Hora','Lote','Contados','Esperados','Diferencia'],(meta.conteos||[]).map(c=>[fecha(c.ts),hora(c.ts),c.lote||'Conteo libre',c.n,c.esp??'',c.esp==null?'':c.n-c.esp]));
  hojasMapa(wb);
  const m={...meta,order:undefined,cambios:0};
  const bk=XLSX.utils.aoa_to_sheet([[APP_ID,1,order.length],['META',JSON.stringify(m)],...all.map(a=>[a.id,JSON.stringify(a)]),...filasRespaldoMapa()]);
  XLSX.utils.book_append_sheet(wb,bk,BACKUP_SHEET);
  wb.Workbook={Sheets:wb.SheetNames.map(n=>({name:n,Hidden:n===BACKUP_SHEET?1:0}))};
  return wb;
}
function nombreArchivo(){
  const f=meta.finca.normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'');
  const d=new Date(); return `Vaquero_${f}_${today()}_${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`;
}
function excelFile(){
  const buf=XLSX.write(construirExcel(),{type:'array',bookType:'xlsx',compression:true});
  return {name:nombreArchivo(),blob:new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})};
}
async function marcarDescargado(){ meta.cambios=0; meta.lastExport=stamp(); await saveMeta(); render(); }
async function descargar(){
  const {name,blob}=excelFile();
  const ios=/iPhone|iPad|iPod/.test(navigator.userAgent), standalone=navigator.standalone||matchMedia('(display-mode: standalone)').matches;
  if(ios&&standalone) return enviar();
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
  await marcarDescargado(); toast('Archivo descargado: '+name);
}
async function enviar(){
  const {name,blob}=excelFile(), file=new File([blob],name,{type:blob.type});
  if(navigator.canShare&&navigator.canShare({files:[file]})){
    try{ await navigator.share({files:[file],title:name}); await marcarDescargado(); toast('Archivo enviado'); }
    catch(e){ if(e.name!=='AbortError') toast('No se pudo enviar. Use Descargar Excel.'); }
  } else return enviarAndroid(name,blob);
}
/* Chrome en Android solo deja compartir imágenes, audio, video, PDF y texto: no deja pasar
   un Excel directo a WhatsApp. Se hace en 2 pasos: guardar en el equipo y adjuntarlo en WhatsApp. */
function bajar(name,blob){
  const url=URL.createObjectURL(blob), a=document.createElement('a');
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function enviarAndroid(name,blob){
  const m=modal(`<h2>Enviar el Excel por WhatsApp</h2>
  <p>En Android, Chrome no deja pasar archivos de Excel directo a WhatsApp. Se hace en 2 pasos:</p>
  <button class="big" id="pGuardar">1. Guardar el Excel en el equipo</button>
  <p class="hint" style="text-align:left;margin:0">Si sale un letrero que dice <b>Descargar</b>, tóquelo.</p>
  <a class="big wa" href="https://wa.me/?text=${encodeURIComponent('Excel de Vaquero: '+name)}" target="_blank" rel="noopener">2. Abrir WhatsApp</a>
  <ol class="pasos"><li>Elija el chat.</li><li>Toque el clip 📎 → <b>Documento</b>.</li><li>Elija <b>${esc(name)}</b> (sale de primero en recientes o en Descargas).</li></ol>
  <p class="hint" style="text-align:left">Otra forma: app <b>Archivos</b> → Descargas → mantenga presionado el archivo → <b>Compartir</b> → WhatsApp o Drive.</p>
  <button class="big sec" data-a="closeM">Cerrar</button>`);
  m.querySelector('#pGuardar').onclick=async e=>{ bajar(name,blob); await marcarDescargado(); e.target.textContent='✓ Excel guardado (tocar para guardar de nuevo)'; };
}

/* ---- leer Excel (mismo formato de SG que Corral) ---- */
function parseDate(v){
  if(typeof v==='number'&&v>1000) return new Date(Date.UTC(1899,11,30)+Math.round(v)*864e5).toISOString().slice(0,10);
  if(v instanceof Date) return v.toISOString().slice(0,10);
  const s=String(v||'').trim(); let m=s.match(/^(\d{4})-(\d{2})-(\d{2})/); if(m) return s.slice(0,10);
  m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); return m?`${m[3]}-${pad(m[2])}-${pad(m[1])}`:'';
}
const toNum = v => { const n=typeof v==='number'?v:parseFloat(String(v||'').replace(',','.')); return Number.isFinite(n)?n:0; };
const txt = v => String(v??'').trim();
function leerSG(wb){
  const ws=wb.Sheets[wb.SheetNames[0]];
  const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
  const hi=rows.findIndex(r=>r.map(txt).includes('Número')&&r.map(txt).includes('EA'));
  if(hi<0) throw new Error('El archivo no tiene las columnas esperadas (Número, EA).');
  const H=rows[hi].map(txt), col=n=>H.indexOf(n);
  const need=['Número','Sexo','EA','Color','Nomb. Lote','Estado reprod.','Gest.','U.Peso','F. Ult Peso','I.E.','# Madre','Det. Ult. Tacto','E.Mes','#P','D.Ab','UIEP','gr/día 2 U. P.'];
  const falta=need.filter(n=>col(n)<0);
  if(falta.length) throw new Error('Faltan columnas: '+falta.join(', '));
  const g=(r,n)=>col(n)<0?'':r[col(n)], list=[], seen=new Set(), dups=[]; let total=null;
  for(const r of rows.slice(hi+1)){
    const id=txt(g(r,'Número')), t=id.match(/^Total animales:\s*(\d+)/i);
    if(t){ total=+t[1]; continue; }
    if(!id||!txt(g(r,'Sexo'))) continue;
    if(seen.has(id)){ dups.push(id); continue; } seen.add(id);
    const cr=txt(g(r,'Color')), azm=cr.match(/^\(AZ\)\s*([0-9A-Za-z]+)/i), ie=txt(g(r,'I.E.'));
    list.push({id,nombre:txt(g(r,'Nombre')),sexo:txt(g(r,'Sexo')),emes:toNum(g(r,'E.Mes')),fnto:parseDate(g(r,'F. Nto')),ea:txt(g(r,'EA')),
      madre:txt(g(r,'# Madre')),color:azm?'':cr,colorRaw:cr,az:azm?azm[1]:'',coment:txt(g(r,'Coment')),lote:txt(g(r,'Nomb. Lote')),np:toNum(g(r,'#P')),
      ie:ie.replace(/\.0+$/,''),gest:toNum(g(r,'Gest.')),estado:txt(g(r,'Estado reprod.')),dab:toNum(g(r,'D.Ab')),uiep:toNum(g(r,'UIEP')),
      upeso:toNum(g(r,'U.Peso')),fupeso:parseDate(g(r,'F. Ult Peso')),gmd:toNum(g(r,'gr/día 2 U. P.')),ftacto:parseDate(g(r,'F. Ult. Tacto')),dtacto:txt(g(r,'Det. Ult. Tacto')),w:{}});
  }
  if(!list.length) throw new Error('No se encontraron animales en el archivo.');
  return {list,total,dups};
}
function leerRespaldo(wb){
  const rows=XLSX.utils.sheet_to_json(wb.Sheets[BACKUP_SHEET],{header:1,raw:true,defval:''});
  if(rows[0][0]==='APP_CORRAL') throw new Error('Este es un archivo de avance de Corral. En Vaquero cargue el Excel de Software Ganadero o un avance descargado de Vaquero.');
  if(rows[0][0]!==APP_ID||rows[1][0]!=='META') throw new Error('El archivo de avance está dañado.');
  const m=JSON.parse(rows[1][1]), list=rows.slice(2).filter(r=>r[1]&&r[0]!=='MAPA').map(r=>JSON.parse(r[1]));
  if(list.length!==rows[0][2]) throw new Error('El archivo de avance está incompleto.');
  return {m,list,mapa:leerMapaRespaldo(rows)};
}
const lotesDe = list => [...new Set(list.map(a=>a.lote).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
async function alSubir(file){
  let wb; try{ wb=XLSX.read(await file.arrayBuffer(),{type:'array'}); }catch(e){ return alertBox('No se pudo leer','El archivo no es un Excel válido.'); }
  try{
    if(wb.SheetNames.includes(BACKUP_SHEET)){
      const {m,list,mapa}=leerRespaldo(wb), mov=list.filter(a=>a.w.mov).length;
      return pasoReemplazo(`Archivo de avance de ${m.finca}: ${list.length} animales, ${mov} movidos.`,null,async()=>{
        await replaceAll({...m,cambios:0},list); await restaurarMapa(mapa); S={busc:{},mov:{}}; tab='inv'; render(); toast('Avance restaurado');
      });
    }
    const {list,total,dups}=leerSG(wb);
    const avisos=[]; if(total&&total!==list.length) avisos.push(`El archivo indica ${total} animales y se leyeron ${list.length}.`);
    if(dups.length) avisos.push(`Números repetidos ignorados: ${dups.slice(0,8).join(', ')}.`);
    return pasoReemplazo(`Excel con ${list.length} animales.`+(avisos.length?' '+avisos.join(' '):''),meta?.finca||'',async (finca,fe)=>{
      await replaceAll({finca,baseDate:fe,fileName:file.name,lotes:lotesDe(list),cambios:0,lastExport:null,recMov:[],conteos:[],cnt:{lote:'',n:0}},list);
      S={busc:{},mov:{}}; tab='inv'; render(); toast('Inventario cargado'); pedirPersistencia();
    });
  }catch(e){ return alertBox('Archivo no válido',e.message); }
}
function leerFechaExcel(t){
  const m=String(t||'').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m) return {err:'Escriba la fecha completa: DD/MM/AAAA.'};
  const d=+m[1], mo=+m[2], y=+m[3], dt=new Date(y,mo-1,d);
  if(dt.getFullYear()!==y||dt.getMonth()!==mo-1||dt.getDate()!==d) return {err:'Esa fecha no existe.'};
  const iso=`${y}-${pad(mo)}-${pad(d)}`;
  if(iso>today()) return {err:'La fecha no puede ser posterior a hoy.'};
  return {iso, dias:daysBetween(iso,today())};
}
function campoFecha(id,val){ return `<div class="field"><label for="${id}">Fecha en que se generó el Excel en SG</label><input id="${id}" class="fecha" inputmode="numeric" maxlength="10" placeholder="DD/MM/AAAA" value="${esc(val||'')}" autocomplete="off"><small class="ferr" id="${id}E"></small></div>`; }
async function validarFecha(m,id){
  const el=m.querySelector('#'+id), r=leerFechaExcel(el.value), er=m.querySelector('#'+id+'E');
  if(r.err){ er.textContent=r.err; el.focus(); return null; }
  er.textContent='';
  if(r.dias>45&&!await new Promise(ok=>{ er.innerHTML=`Son ${r.dias} días atrás. <button class="opt" type="button">Sí, es correcta</button>`; er.querySelector('button').onclick=()=>ok(true); })) return null;
  return r.iso;
}
function cambiarFecha(){
  const m=modal(`<h2>Fecha del Excel</h2><p>Fecha en que se generó en SG el Excel de ${esc(meta.finca)}. Cambiarla recalcula días de gestación, días abiertos y edades.</p>
  ${campoFecha('cD',fmtD(meta.baseDate))}<button class="big" id="cOk">Guardar fecha</button><button class="big sec" data-a="closeM">Cancelar</button>`);
  m.querySelector('#cOk').onclick=async()=>{ const fe=await validarFecha(m,'cD'); if(!fe) return; meta.baseDate=fe; meta.cambios=(meta.cambios||0)+1; await saveMeta(); closeModal(); render(); toast('Fecha del Excel: '+fmtD(fe)); };
}
function pasoReemplazo(desc,finca,run){
  const c=meta?.cambios||0, hay=!!meta;
  const m=modal(`<h2>Cargar archivo</h2><p>${esc(desc)}</p>
  ${finca!==null?`<div class="field"><label for="mF">Nombre de la finca</label><input id="mF" value="${esc(finca)}" autocomplete="off"></div>${campoFecha('mD','')}<p class="hint" style="text-align:left;margin:0">Con esta fecha se calculan los días de gestación, días abiertos y edades. Use la fecha del Excel, no la de hoy, si se generó antes.</p>`:''}
  ${hay?`<div class="alert r">Esto borra el inventario actual de ${esc(meta.finca)}.${c?` Tiene ${c} cambios sin descargar.`:''}</div><button class="big sec" id="mDl">Descargar avance actual primero</button>`:''}
  <button class="big ${hay?'danger':''}" id="mGo">${hay?'Borrar y cargar':'Cargar'}</button><button class="big sec" id="mNo">Cancelar</button>`);
  if(hay) m.querySelector('#mDl').onclick=async e=>{ await descargar(); e.target.textContent='Avance descargado ✓'; };
  m.querySelector('#mNo').onclick=closeModal;
  m.querySelector('#mGo').onclick=async()=>{
    let f=null, fe=null;
    if(finca!==null){ f=m.querySelector('#mF').value.trim(); if(!f){ m.querySelector('#mF').focus(); return; }
      fe=await validarFecha(m,'mD'); if(!fe) return; }
    if(hay&&(meta.cambios||0)>0&&!await segundo()) return;
    closeModal(); await run(f,fe);
  };
  function segundo(){ return new Promise(res=>{ const s=document.createElement('div'); s.className='alert r';
    s.innerHTML='Aún hay cambios sin descargar y se perderán.<br><br><button class="big danger">Perder cambios y cargar</button>';
    m.querySelector('.sheet').prepend(s); s.querySelector('button').onclick=()=>res(true); m.querySelector('.sheet').scrollTop=0; }); }
}

/* ---------- movimiento elegido sin guardar ---------- */
const sinGuardar = () => tab==='mov' && !movVista && S.mov.id && S.mov.dest;
function salir(){
  if(!sinGuardar()) return Promise.resolve(true);
  return new Promise(res=>{
    const m=modal(`<h2>No ha guardado</h2><p>Eligió mover <b>${esc(S.mov.id)}</b> a <b>${esc(S.mov.dest)}</b> pero no lo guardó.</p>
    <button class="big" id="gSave">Mover ahora</button><button class="big sec" id="gBack">Volver</button><button class="big danger" id="gOut">Salir sin mover</button>`);
    m.querySelector('#gBack').onclick=()=>{ closeModal(); res(false); };
    m.querySelector('#gOut').onclick=()=>{ closeModal(); S.mov={}; res(true); };
    m.querySelector('#gSave').onclick=async()=>{ closeModal(); await saveMov(); res(true); };
  });
}
function nuevoLote(){
  const n=(prompt('Nombre del lote nuevo')||'').trim().toUpperCase(); if(!n) return '';
  if(!meta.lotes.includes(n)){ meta.lotes.push(n); meta.lotes.sort((a,b)=>a.localeCompare(b,'es')); saveMeta(); }
  return n;
}

/* ---------- eventos ---------- */
document.addEventListener('pointerdown',e=>{ if(e.target.closest('#cntBtn')){ e.preventDefault(); contar(); } });
document.addEventListener('click',async e=>{
  if(!e.target.closest('#toast')) $('#toast').classList.remove('show');
  const t=e.target.closest('button,[data-mv],[data-tlote],[data-m]'); if(!t||t.id==='cntBtn') return;
  const d=t.dataset;
  if(d.tab){ if(!meta&&d.tab!=='file'&&d.tab!=='mapa') return; if(d.tab!==tab&&!await salir()) return; tab=d.tab; $('#main').scrollTop=0; return render(); }
  if(d.m) return accionMapa(d.m,d);
  if(d.k!==undefined){
    const s=S[tab];
    if(d.k==='del') s.q=(s.q||'').slice(0,-1);
    else if(d.k==='abc'){ s.abc=!s.abc; renderMain(); if(s.abc) $('#q').focus(); return; }
    else if(d.k==='ok'){ const r=buscar(s.q||''); if(r.exact===1||r.items.length===1) pick(r.items[0].id); return; }
    else s.q=(s.q||'')+d.k;
    $('#q').value=s.q; return pintarResultados();
  }
  if(d.pick) return pick(d.pick);
  if(d.go){ closeModal(); if(!await salir()) return; tab=d.go; movVista=false; render(); return pick(d.id); }
  if(d.ver){ closeModal(); if(!await salir()) return; tab='busc'; render(); return pick(d.ver); }
  if(d.qmov){ S.mov.dest=S.mov.dest===d.qmov?'':d.qmov; return renderMain(); }
  if(d.tl){ TL=d.tl; return renderMain(); }
  if(d.tlote) return verLote(d.tlote);
  if(d.mv!==undefined) return verMov(+d.mv);
  if(d.undo) return deshacer(d.undo);
  if(d.cdel){ if(await confirmBox('Borrar conteo','Se borrará este conteo guardado.','Borrar',true)){ meta.conteos=meta.conteos.filter(c=>c.ts!==d.cdel); meta.cambios=(meta.cambios||0)+1; await saveMeta(); render(); } return; }
  switch(d.a){
    case 'goFile': if(!await salir()) return; tab='file'; return render();
    case 'clear': if(!await salir()) return; S[tab]={}; return renderMain();
    case 'saveMov': return saveMov();
    case 'verMovs': movVista=true; $('#main').scrollTop=0; return renderMain();
    case 'volverMov': movVista=false; return renderMain();
    case 'cMenos': { const k=K(); if(k.n>0){ k.n--; pintarCnt(); guardarCnt(); } return; }
    case 'cReset': { const k=K(); if(k.n&&!await confirmBox('Reiniciar conteo',`Se pondrá en cero el conteo de ${k.n}.`,'Reiniciar',true)) return; k.n=0; await saveMeta(); return renderMain(); }
    case 'cSonido': meta.sonido=meta.sonido===false; await saveMeta(); return renderMain();
    case 'cGuardar': return guardarConteo();
    case 'cambiarFecha': return cambiarFecha();
    case 'closeM': return closeModal();
    case 'upload': return $('#file').click();
    case 'download': return descargar();
    case 'share': return enviar();
    case 'install': if(installEvt){ installEvt.prompt(); installEvt=null; renderMain(); } return;
  }
});
document.addEventListener('input',e=>{
  const el=e.target;
  if(el.dataset.mc) return inputMapa(el);
  if(el.id==='q'){ S[tab].q=el.value.toUpperCase(); return pintarResultados(); }
  if(el.classList.contains('fecha')){ const n=el.value.replace(/\D/g,'').slice(0,8); el.value=n.length>4?`${n.slice(0,2)}/${n.slice(2,4)}/${n.slice(4)}`:n.length>2?`${n.slice(0,2)}/${n.slice(2)}`:n; const er=document.getElementById(el.id+'E'); if(er) er.textContent=''; }
});
document.addEventListener('change',async e=>{
  const el=e.target;
  if(el.dataset.f==='dest'){ S.mov.dest=el.value==='__otro'?nuevoLote():el.value; return renderMain(); }
  if(el.dataset.c==='lote'){ K().lote=el.value; await saveMeta(); return renderMain(); }
});
$('#file').addEventListener('change',e=>{ const f=e.target.files[0]; e.target.value=''; if(f) alSubir(f); });
window.addEventListener('beforeinstallprompt',e=>{ e.preventDefault(); installEvt=e; if(tab==='file') renderMain(); });
window.addEventListener('beforeunload',e=>{ if(meta&&((meta.cambios||0)>0||sinGuardar())){ e.preventDefault(); e.returnValue=''; } });

(async function init(){
  if('serviceWorker' in navigator){
    const tenia=!!navigator.serviceWorker.controller; let recargado=false;
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(!tenia||recargado) return; recargado=true;
      if(sinGuardar()){ toast('Hay una versión nueva. Guarde y vuelva a abrir la app.'); return; }
      location.reload();
    });
    navigator.serviceWorker.register('sw.js',{updateViaCache:'none'}).then(reg=>{
      const buscarV=()=>{ if(!navigator.onLine) return; reg.update().catch(()=>{});
        /* Si otra app del mismo dominio (Corral 5.2.0) borró la caché de Vaquero, se vuelve a llenar */
        navigator.serviceWorker.ready.then(r=>r.active&&r.active.postMessage('revisar')).catch(()=>{}); };
      buscarV(); document.addEventListener('visibilitychange',()=>{ if(!document.hidden) buscarV(); });
    }).catch(()=>{});
  }
  try{ db=await openDB(); await loadDB(); await mapaCargar(); }
  catch(e){ await alertBox('Error de almacenamiento','Este navegador no permite guardar datos. Salga del modo privado o use otro navegador.'); }
  if(meta) await pedirPersistencia();
  render();
  if(meta&&meta.cambios>0) toastBackup(meta.cambios);
})();
