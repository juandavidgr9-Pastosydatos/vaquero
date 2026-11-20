'use strict';
/* Vaquero - Pestaña Mapa: potreros desde KML/KMZ y simulación de rotaciones (calculadora de carga).
   Funciona sin internet: solo dibuja los potreros (sin foto satelital). Se guarda en IndexedDB "vaquero", almacén "mapa". */
const CARGAS = [['Alta',800],['Media',675],['Baja',450]];          // kg de peso vivo por hectárea
const CATS = {                                                       // peso por animal (kg)
  VP:{t:'VP + cría',kg:500,toro:'siempre'}, VS:{t:'VS',kg:450,toro:'opcion'}, TR:{t:'TR',kg:600},
  HL1:{t:'HL1',kg:200}, HL2:{t:'HL2',kg:250}, HL3:{t:'HL3',kg:300}
};
const TORO_KG = 600, VACAS_X_TORO = 30;
const COLORES = ['#1F6FB2','#C0392B','#1E8449','#7D3C98','#D35400','#117A65','#B03A7A','#2C3E50','#A04000','#5D6D7E'];

let MAPA = null, ROTS = [], MP = null, VB = null, SIM = null;

/* ---------- guardar y leer ---------- */
async function mapaCargar(){
  try{
    const t=db.transaction('mapa');
    const v=await new Promise((ok,no)=>{ const r=t.objectStore('mapa').get('m'); r.onsuccess=()=>ok(r.result); r.onerror=()=>no(r.error); });
    if(v){ MAPA=v.mapa||null; ROTS=v.rots||[]; }
  }catch(e){}
  prepararMapa();
}
async function mapaGuardar(cambio=true){
  const t=db.transaction('mapa','readwrite'); t.objectStore('mapa').put({mapa:MAPA,rots:ROTS},'m'); await txDone(t);
  if(cambio&&meta){ meta.cambios=(meta.cambios||0)+1; await saveMeta(); renderTop(); recordatorio(); }
}

/* ---------- área geodésica (m²) de un anillo [[lon,lat],...] ---------- */
function areaAnillo(pts){
  const R=6378137, rad=Math.PI/180; let s=0;
  for(let i=0;i<pts.length;i++){ const [x1,y1]=pts[i], [x2,y2]=pts[(i+1)%pts.length];
    s+=(x2-x1)*rad*(2+Math.sin(y1*rad)+Math.sin(y2*rad)); }
  return Math.abs(s*R*R/2);
}

/* ---------- leer KML / KMZ ---------- */
const NOMBRE_CAMPOS = ['nombre','name','potrero','nom','nombre_pot'];
const AREA_CAMPOS = ['area','área','ha','hectareas','hectáreas','area_ha','areaha'];
function campoKML(pm,lista){
  for(const el of pm.getElementsByTagNameNS('*','SimpleData')){ if(lista.includes((el.getAttribute('name')||'').toLowerCase())&&el.textContent.trim()) return el.textContent.trim(); }
  for(const el of pm.getElementsByTagNameNS('*','Data')){ if(lista.includes((el.getAttribute('name')||'').toLowerCase())){ const v=el.getElementsByTagNameNS('*','value')[0]; if(v&&v.textContent.trim()) return v.textContent.trim(); } }
  return '';
}
const anillo = el => { const c=el&&el.getElementsByTagNameNS('*','coordinates')[0]; if(!c) return null;
  const pts=c.textContent.trim().split(/\s+/).map(t=>t.split(',').map(Number)).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])).map(p=>[+p[0].toFixed(7),+p[1].toFixed(7)]);
  if(pts.length>1&&pts[0][0]===pts[pts.length-1][0]&&pts[0][1]===pts[pts.length-1][1]) pts.pop();
  return pts.length>=3?pts:null; };
function leerKML(texto,archivo){
  const doc=new DOMParser().parseFromString(texto,'application/xml');
  if(doc.getElementsByTagName('parsererror').length) throw new Error('El archivo KML está dañado o no es un KML.');
  const pots=[];
  [...doc.getElementsByTagNameNS('*','Placemark')].forEach((pm,i)=>{
    const rings=[];
    for(const poly of pm.getElementsByTagNameNS('*','Polygon')){
      const out=anillo(poly.getElementsByTagNameNS('*','outerBoundaryIs')[0]); if(!out) continue;
      rings.push({h:0,p:out});
      for(const ib of poly.getElementsByTagNameNS('*','innerBoundaryIs')){ const r=anillo(ib); if(r) rings.push({h:1,p:r}); }
    }
    if(!rings.length) return;
    let nom=campoKML(pm,NOMBRE_CAMPOS);
    if(!nom){ const n=[...pm.children].find(c=>c.localName==='name'); nom=n?n.textContent.trim():''; }
    const calc=rings.reduce((s,r)=>s+(r.h?-1:1)*areaAnillo(r.p),0)/1e4;
    const af=parseFloat(String(campoKML(pm,AREA_CAMPOS)).replace(',','.'));
    pots.push({nom:nom||`Potrero ${pots.length+1}`, ha:+(Number.isFinite(af)&&af>0?af:calc).toFixed(2), rings});
  });
  if(!pots.length) throw new Error('El archivo no tiene potreros (polígonos).');
  const tot=pots.reduce((s,p)=>s+p.ha,0);
  return {file:archivo, fecha:stamp(), firma:`${archivo}|${pots.length}|${tot.toFixed(2)}`, pots};
}
async function leerArchivoMapa(file){
  const buf=new Uint8Array(await file.arrayBuffer());
  if(buf[0]===0x50&&buf[1]===0x4B){   // KMZ = zip con un .kml adentro
    const z=XLSX.CFB.read(buf,{type:'array'}), i=z.FullPaths.findIndex(p=>/\.kml$/i.test(p));
    if(i<0) throw new Error('El KMZ no tiene un archivo KML adentro.');
    return leerKML(new TextDecoder().decode(z.FileIndex[i].content), file.name);
  }
  return leerKML(new TextDecoder().decode(buf), file.name);
}
function pedirKML(){
  const inp=document.createElement('input'); inp.type='file'; inp.accept='.kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz';
  inp.onchange=async()=>{ const f=inp.files[0]; if(!f) return;
    let m; try{ m=await leerArchivoMapa(f); }catch(e){ return alertBox('Mapa no válido',e.message); }
    const tot=m.pots.reduce((s,p)=>s+p.ha,0);
    if(MAPA&&!await confirmBox('Reemplazar mapa',`El archivo tiene ${m.pots.length} potreros (${num(tot,2)} ha). Se reemplaza el mapa actual. Las rotaciones guardadas siguen en el histórico, y solo se dibujan si el mapa es el mismo.`,'Reemplazar mapa')) return;
    MAPA=m; SIM=null; VB=null; prepararMapa(); await mapaGuardar(true);
    renderMain(); toast(`Mapa cargado: ${m.pots.length} potreros, ${num(tot,2)} ha`);
  };
  inp.click();
}

/* ---------- geometría en metros para dibujar ---------- */
function dentro(x,y,rings){ let c=false;
  for(const r of rings) for(let i=0,j=r.length-1;i<r.length;j=i++){ const [xi,yi]=r[i],[xj,yj]=r[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi) c=!c; }
  return c; }
function puntoEtiqueta(rings,bb){
  const o=rings.reduce((a,b)=>b.length>a.length?b:a); let A=0,cx=0,cy=0;
  for(let i=0;i<o.length;i++){ const [x1,y1]=o[i],[x2,y2]=o[(i+1)%o.length], f=x1*y2-x2*y1; A+=f; cx+=(x1+x2)*f; cy+=(y1+y2)*f; }
  if(A){ cx/=3*A; cy/=3*A; if(dentro(cx,cy,rings)) return [cx,cy]; }
  // si el centro cae afuera (potrero en L o en U): mitad del tramo más ancho en la línea media
  let best=null; for(const fy of [.5,.4,.6,.3,.7]){ const y=bb[1]+(bb[3]-bb[1])*fy, xs=[];
    for(const r of rings) for(let i=0,j=r.length-1;i<r.length;j=i++){ const [xi,yi]=r[i],[xj,yj]=r[j]; if((yi>y)!==(yj>y)) xs.push((xj-xi)*(y-yi)/(yj-yi)+xi); }
    xs.sort((a,b)=>a-b); for(let k=0;k+1<xs.length;k+=2){ const w=xs[k+1]-xs[k]; if(!best||w>best.w) best={w,x:(xs[k]+xs[k+1])/2,y}; }
    if(best) break; }
  return best?[best.x,best.y]:[(bb[0]+bb[2])/2,(bb[1]+bb[3])/2];
}
function prepararMapa(){
  if(!MAPA){ MP=null; return; }
  let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;
  for(const p of MAPA.pots) for(const r of p.rings) for(const [x,y] of r.p){ x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y); }
  const lon0=(x0+x1)/2, lat0=(y0+y1)/2, kx=111320*Math.cos(lat0*Math.PI/180), ky=110574;
  const pr=([lon,lat])=>[(lon-lon0)*kx,-(lat-lat0)*ky];
  const bbAll=[Infinity,Infinity,-Infinity,-Infinity];
  const pots=MAPA.pots.map((p,i)=>{
    const rings=p.rings.map(r=>r.p.map(pr)), bb=[Infinity,Infinity,-Infinity,-Infinity];
    for(const r of rings) for(const [x,y] of r){ bb[0]=Math.min(bb[0],x);bb[1]=Math.min(bb[1],y);bb[2]=Math.max(bb[2],x);bb[3]=Math.max(bb[3],y); }
    for(let k=0;k<4;k++) bbAll[k]=k<2?Math.min(bbAll[k],bb[k]):Math.max(bbAll[k],bb[k]);
    const d=rings.map(r=>'M'+r.map(([x,y])=>`${x.toFixed(1)} ${y.toFixed(1)}`).join('L')+'Z').join('');
    const [lx,ly]=puntoEtiqueta(rings,bb);
    return {i,nom:p.nom,ha:p.ha,d,bb,lx,ly,w:Math.min(bb[2]-bb[0],bb[3]-bb[1])};
  });
  MP={pots,bb:bbAll,ha:MAPA.pots.reduce((s,p)=>s+p.ha,0)};
}

/* ---------- cálculo de carga ---------- */
function calcRot(s){
  const area=[...s.sel].reduce((t,i)=>t+MP.pots[i].ha,0), kgha=CARGAS.find(c=>c[0]===s.carga)[1], cap=area*kgha;
  const r={area,kgha,cap};
  if(!s.cat) return r;
  const c=CATS[s.cat], conToro=c.toro==='siempre'||(c.toro==='opcion'&&s.toros);
  const kgDe=n=>n*c.kg+(conToro?Math.ceil(n/VACAS_X_TORO)*TORO_KG:0);
  let max=Math.floor(cap/c.kg); while(max>0&&kgDe(max)>cap) max--;
  const n=s.n==null?max:s.n, nt=conToro?Math.ceil(n/VACAS_X_TORO):0, kg=kgDe(n);
  return {...r,c,conToro,max,n,nt,kg,ocup:cap?kg/cap:0};
}
const rotVisible = r => r.vis!==false && MAPA && r.firma===MAPA.firma;
const animalesTxt = r => `${CATS[r.cat]?.t||r.cat} ${r.n}${r.nt?` + ${r.nt} TR`:''}`;

/* ---------- pantalla ---------- */
function viewMapa(){
  if(!MAPA) return `<div class="mpanel"><div class="empty"><h2>Mapa de potreros</h2>
    <p>Cargue el archivo KML o KMZ con los potreros de la finca (de Google Earth, QGIS u otro programa). El mapa queda guardado en el equipo y funciona sin internet.</p>
    <button class="big" data-m="kml">Cargar mapa (KML o KMZ)</button></div></div>`;
  return `<div class="mwrap"><svg id="msvg" xmlns="http://www.w3.org/2000/svg"></svg>
    <div class="mctl"><button data-m="zin" aria-label="Acercar">+</button><button data-m="zout" aria-label="Alejar">−</button><button data-m="fit" aria-label="Ver toda la finca">⤢</button></div>
    ${SIM?'<div class="mhint">Toque los potreros para agregarlos o quitarlos</div>':''}</div>
    <div class="mpanel" id="mpanel">${panelMapa()}</div>`;
}
function panelMapa(){ return SIM?panelSim():panelLista(); }
function panelLista(){
  const rs=ROTS.slice().reverse();
  return `<div class="mres"><div><b>${MP.pots.length}</b> potreros · <b>${num(MP.ha,2)}</b> ha<small>${esc(MAPA.file)}</small></div><button class="lnk" data-m="kml">Cambiar mapa</button></div>
  <button class="big" data-m="nueva">＋ Nueva rotación</button>
  <h3>Rotaciones guardadas (${ROTS.length})</h3>
  ${rs.length?`<div class="plist">${rs.map(r=>{ const ok=MAPA&&r.firma===MAPA.firma; return `<div class="rrow">
    <label class="rvis"><input type="checkbox" data-m="vis" data-r="${r.id}" ${r.vis!==false?'checked':''} ${ok?'':'disabled'}><i style="background:${r.color}"></i></label>
    <div class="rinfo"><b>${esc(r.nombre)}</b><small>${esc(animalesTxt(r))} · ${r.pots.length} potreros · ${num(r.ha,2)} ha</small><small>Carga ${esc(r.carga)} ${r.kgha} kg/Ha · ${Math.round(r.ocup*100)}% · ${fmtTs(r.fecha)}${ok?'':' · de otro mapa'}</small></div>
    <div class="racc">${ok?`<button class="undo" data-m="ver" data-r="${r.id}">Ver</button><button class="undo" data-m="editar" data-r="${r.id}">Editar</button>`:''}<button class="cdel" data-m="borrar" data-r="${r.id}" aria-label="Borrar">✕</button></div></div>`; }).join('')}</div>`
  :'<p class="hint">Aún no hay rotaciones. Toque "Nueva rotación", seleccione los potreros en el mapa y calcule cuántos animales caben.</p>'}
  <p class="hint">Toque un potrero para ver su nombre y área.</p>`;
}
function panelSim(){
  const s=SIM, sel=[...s.sel];
  return `<div class="secthead"><h2>${s.id?'Editar rotación':'Nueva rotación'}</h2><button class="close" data-m="cancelar">Cancelar</button></div>
  ${sel.length?`<div class="chips pchips">${sel.map(i=>`<button class="tag" data-m="quitar" data-i="${i}">${esc(MP.pots[i].nom)} · ${num(MP.pots[i].ha,2)} ha ✕</button>`).join('')}</div>`:'<div class="alert b">Toque en el mapa los potreros de la rotación.</div>'}
  <div class="field"><label>Carga</label><div class="opts cats">${CARGAS.map(([n,k])=>`<button class="opt ${s.carga===n?'on':''}" data-m="carga" data-v="${n}">${n}<small>${k} kg/Ha</small></button>`).join('')}</div></div>
  <div class="field"><label>Categoría a ingresar</label><div class="opts cats">${Object.entries(CATS).map(([k,c])=>`<button class="opt ${s.cat===k?'on':''}" data-m="cat" data-v="${k}">${c.t}<small>${c.kg} kg</small></button>`).join('')}</div></div>
  ${s.cat==='VS'?`<button class="opt tog ${s.toros?'on':''}" data-m="toros">${s.toros?'☑':'☐'} Incluir toros (vacas vacías) · 1 por ${VACAS_X_TORO}</button>`:''}
  <div id="mcalc">${calcHTML()}</div>
  <div class="field"><label for="rNom">Nombre de la rotación</label><input id="rNom" data-mc="nombre" maxlength="40" value="${esc(s.nombre)}" placeholder="Ej: Rotación paridas norte" autocomplete="off"></div>
  <button class="big" data-m="guardar" id="rSave" ${puedeGuardar()?'':'disabled'}>Guardar rotación</button>`;
}
const puedeGuardar = () => { if(!SIM||!SIM.sel.size||!SIM.cat||!SIM.nombre.trim()) return false; const r=calcRot(SIM); return r.n>0; };
function calcHTML(){
  const r=calcRot(SIM);
  let h=`<div class="stats" style="grid-template-columns:repeat(3,1fr)"><div><b>${num(r.area,2)}</b><small>Hectáreas</small></div><div><b>${SIM.sel.size}</b><small>Potreros</small></div><div><b>${num(Math.round(r.cap),0)}</b><small>kg que caben</small></div></div>`;
  if(!SIM.sel.size) return h;
  if(!SIM.cat) return h+'<p class="hint">Elija la categoría para calcular cuántos animales caben.</p>';
  const pct=Math.round(r.ocup*100), cls=pct>100?'sobran':pct>=90?'ok':'faltan';
  h+=`<div class="card calc"><h3>Animales que caben</h3>
    ${kv([['Máximo',`${r.max} ${r.c.t}`],r.conToro?['Toros para el máximo',`${Math.ceil(r.max/VACAS_X_TORO)}`]:null])}
    <small class="qlab">Animales a ingresar (${esc(r.c.t)})</small>
    <div class="qty"><button class="opt" data-m="menos">−</button><input id="rN" data-mc="n" type="number" inputmode="numeric" min="0" value="${r.n}"><button class="opt" data-m="mas">+</button><button class="lnk" data-m="maximo">Máximo</button></div>
    ${kv([r.conToro?['Toros (1 por cada '+VACAS_X_TORO+')',`${r.nt} × ${TORO_KG} kg`]:null,['Peso total',`${num(Math.round(r.kg),0)} kg`],['Carga real',`${num(r.area?r.kg/r.area:0,0)} kg/Ha`]])}
    <div class="cdif ${cls}">Ocupación ${pct}%${pct>100?' · sobrecarga':''}</div></div>`;
  return h;
}

/* ---------- dibujo del mapa (SVG) ---------- */
function svgContenido(){
  const vis=ROTS.filter(rotVisible);
  let h='<g class="pots">'+MP.pots.map(p=>`<path data-p="${p.i}" d="${p.d}"/>`).join('')+'</g>';
  for(const r of vis) h+=`<g class="rcapa" style="--c:${r.color}">${r.pots.filter(i=>MP.pots[i]).map(i=>`<path d="${MP.pots[i].d}"/>`).join('')}</g>`;
  if(SIM) h+=`<g class="scapa">${[...SIM.sel].map(i=>`<path d="${MP.pots[i].d}"/>`).join('')}</g>`;
  h+='<g class="plab" id="plab">'+MP.pots.map(p=>`<text data-w="${p.w.toFixed(0)}" x="${p.lx.toFixed(1)}" y="${p.ly.toFixed(1)}"><tspan dy="-.1em">${esc(p.nom)}</tspan><tspan class="ha" x="${p.lx.toFixed(1)}" dy="1.05em">${num(p.ha,2)} ha</tspan></text>`).join('')+'</g>';
  if(!SIM) h+='<g class="rlab" id="rlab">'+vis.map(r=>{ const ps=r.pots.map(i=>MP.pots[i]).filter(Boolean), t=ps.reduce((s,p)=>s+p.ha,0)||1;
    const x=ps.reduce((s,p)=>s+p.lx*p.ha,0)/t, y=ps.reduce((s,p)=>s+p.ly*p.ha,0)/t;
    return `<text style="--c:${r.color}" x="${x.toFixed(1)}" y="${y.toFixed(1)}"><tspan dy="-1.1em">${esc(r.nombre)}</tspan><tspan x="${x.toFixed(1)}" dy="1.15em" class="r2">${esc(animalesTxt(r))}</tspan><tspan x="${x.toFixed(1)}" dy="1.15em" class="r2">${num(r.ha,2)} ha</tspan></text>`; }).join('')+'</g>';
  return h;
}
function pintarSvg(){ const svg=$('#msvg'); if(!svg) return; svg.innerHTML=svgContenido(); aplicarVB(); }
function pintarPanel(){ const p=$('#mpanel'); if(p){ const y=p.scrollTop; p.innerHTML=panelMapa(); p.scrollTop=y; } }
function montarMapa(){
  const svg=$('#msvg'); if(!svg) return;
  svg.innerHTML=svgContenido(); gestos(svg);
  requestAnimationFrame(()=>{ if(!VB) encuadrar(MP.bb); else ajustarAspecto(); });
}
function tamSvg(){ const r=$('#msvg').getBoundingClientRect(); return {w:r.width||1,h:r.height||1,r}; }
function encuadrar(bb,margen=.06){
  const {w,h}=tamSvg(); let bw=(bb[2]-bb[0])||50, bh=(bb[3]-bb[1])||50;
  bw*=1+2*margen; bh*=1+2*margen;
  const cx=(bb[0]+bb[2])/2, cy=(bb[1]+bb[3])/2;
  if(bw/bh>w/h) bh=bw*h/w; else bw=bh*w/h;
  VB=[cx-bw/2,cy-bh/2,bw,bh]; aplicarVB();
}
function ajustarAspecto(){ if(!VB||!$('#msvg')) return; const {w,h}=tamSvg(), cy=VB[1]+VB[3]/2; VB[3]=VB[2]*h/w; VB[1]=cy-VB[3]/2; aplicarVB(); }
function aplicarVB(){
  const svg=$('#msvg'); if(!svg||!VB) return;
  svg.setAttribute('viewBox',VB.map(v=>v.toFixed(2)).join(' '));
  const {w}=tamSvg(), esc1=w/VB[2], fs=13/esc1;   // letra de 13 px en pantalla
  const pl=$('#plab'); if(pl){ pl.setAttribute('font-size',fs.toFixed(3));
    for(const t of pl.children){ const px=(+t.dataset.w)*esc1; t.setAttribute('class',px<22?'oc':px<48?'sin':''); } }
  const rl=$('#rlab'); if(rl) rl.setAttribute('font-size',(15/esc1).toFixed(3));
}
function zoom(f,cx,cy){
  if(!VB) return; const {w,h,r}=tamSvg();
  const px=cx==null?w/2:cx-r.left, py=cy==null?h/2:cy-r.top;
  const wx=VB[0]+px/w*VB[2], wy=VB[1]+py/h*VB[3];
  const nw=Math.min(Math.max(VB[2]*f,30),(MP.bb[2]-MP.bb[0])*4+400), k=nw/VB[2];
  VB=[wx-(wx-VB[0])*k, wy-(wy-VB[1])*k, nw, VB[3]*k]; aplicarVB();
}
function gestos(svg){
  const pts=new Map(); let ini=null, movio=false;
  const reiniciar=()=>{ ini={vb:[...VB],p:new Map([...pts].map(([k,v])=>[k,{...v}]))}; };
  svg.addEventListener('pointerdown',e=>{ svg.setPointerCapture(e.pointerId); pts.set(e.pointerId,{x:e.clientX,y:e.clientY}); if(pts.size===1) movio=false; reiniciar(); });
  svg.addEventListener('pointermove',e=>{
    if(!pts.has(e.pointerId)||!ini) return; pts.set(e.pointerId,{x:e.clientX,y:e.clientY});
    const {w,r}=tamSvg(), a=[...pts.values()], b=[...ini.p.values()];
    if(a.length===1){ const dx=a[0].x-b[0].x, dy=a[0].y-b[0].y; if(Math.hypot(dx,dy)>7) movio=true; if(!movio) return;
      const s=w/ini.vb[2]; VB=[ini.vb[0]-dx/s, ini.vb[1]-dy/s, ini.vb[2], ini.vb[3]]; }
    else { movio=true; const d0=Math.hypot(b[0].x-b[1].x,b[0].y-b[1].y)||1, d1=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)||1;
      const m0={x:(b[0].x+b[1].x)/2-r.left,y:(b[0].y+b[1].y)/2-r.top}, m1={x:(a[0].x+a[1].x)/2-r.left,y:(a[0].y+a[1].y)/2-r.top};
      const s0=w/ini.vb[2], nw=Math.min(Math.max(ini.vb[2]*d0/d1,30),(MP.bb[2]-MP.bb[0])*4+400), s1=w/nw;
      const wx=ini.vb[0]+m0.x/s0, wy=ini.vb[1]+m0.y/s0;
      VB=[wx-m1.x/s1, wy-m1.y/s1, nw, ini.vb[3]*nw/ini.vb[2]]; }
    aplicarVB();
  });
  const fin=e=>{ if(!pts.has(e.pointerId)) return; const solo=pts.size===1; pts.delete(e.pointerId);
    if(solo&&!movio&&e.type==='pointerup'){ const el=document.elementFromPoint(e.clientX,e.clientY), p=el&&el.closest('[data-p]'); if(p) tocarPotrero(+p.dataset.p); }
    if(pts.size) reiniciar(); else ini=null; };
  svg.addEventListener('pointerup',fin); svg.addEventListener('pointercancel',fin);
  svg.addEventListener('wheel',e=>{ e.preventDefault(); zoom(e.deltaY>0?1.2:1/1.2,e.clientX,e.clientY); },{passive:false});
}
function tocarPotrero(i){
  const p=MP.pots[i];
  if(SIM){ SIM.sel.has(i)?SIM.sel.delete(i):SIM.sel.add(i); SIM.n=null; pintarSvg(); pintarPanel(); return; }
  const en=ROTS.filter(r=>r.firma===MAPA.firma&&r.pots.includes(i)).map(r=>r.nombre);
  toast(`Potrero ${p.nom}: ${num(p.ha,2)} ha${en.length?` · en ${en.join(', ')}`:''}`);
}

/* ---------- acciones (botones con data-m) ---------- */
function colorLibre(){ const usados=ROTS.map(r=>r.color); return COLORES.find(c=>!usados.includes(c))||COLORES[ROTS.length%COLORES.length]; }
async function accionMapa(m,d){
  const rot=d.r&&ROTS.find(r=>r.id===d.r);
  switch(m){
    case 'kml': return pedirKML();
    case 'zin': return zoom(1/1.5);
    case 'zout': return zoom(1.5);
    case 'fit': return encuadrar(MP.bb);
    case 'nueva': SIM={sel:new Set(),carga:'Media',cat:'',toros:false,n:null,nombre:''}; return renderMain();
    case 'editar': SIM={id:rot.id,color:rot.color,sel:new Set(rot.pots),carga:rot.carga,cat:rot.cat,toros:rot.cat==='VS'&&rot.toros,n:rot.n,nombre:rot.nombre}; renderMain();
      return requestAnimationFrame(()=>encuadrarRot(rot));
    case 'cancelar': SIM=null; return renderMain();
    case 'quitar': SIM.sel.delete(+d.i); SIM.n=null; pintarSvg(); return pintarPanel();
    case 'carga': SIM.carga=d.v; SIM.n=null; return pintarPanel();
    case 'cat': SIM.cat=d.v; SIM.n=null; if(d.v!=='VS') SIM.toros=false; return pintarPanel();
    case 'toros': SIM.toros=!SIM.toros; SIM.n=null; return pintarPanel();
    case 'menos': case 'mas': { const r=calcRot(SIM); SIM.n=Math.max(0,r.n+(m==='mas'?1:-1)); return refrescarCalc(); }
    case 'maximo': SIM.n=null; return refrescarCalc();
    case 'guardar': return guardarRot();
    case 'vis': rot.vis=!(rot.vis!==false); await mapaGuardar(false); return pintarSvg();
    case 'ver': if(rot.vis===false){ rot.vis=true; await mapaGuardar(false); pintarPanel(); pintarSvg(); } return encuadrarRot(rot);
    case 'borrar': if(!await confirmBox('Borrar rotación',`Se borrará "${rot.nombre}" del histórico.`,'Borrar',true)) return;
      ROTS=ROTS.filter(r=>r!==rot); await mapaGuardar(true); return renderMain();
  }
}
function encuadrarRot(r){ const bb=[Infinity,Infinity,-Infinity,-Infinity];
  for(const i of r.pots){ const p=MP.pots[i]; if(!p) continue; for(let k=0;k<4;k++) bb[k]=k<2?Math.min(bb[k],p.bb[k]):Math.max(bb[k],p.bb[k]); }
  if(Number.isFinite(bb[0])) encuadrar(bb,.15); }
function refrescarCalc(){ const c=$('#mcalc'); if(c) c.innerHTML=calcHTML(); const b=$('#rSave'); if(b) b.disabled=!puedeGuardar(); }
function inputMapa(el){
  if(!SIM) return;
  if(el.dataset.mc==='nombre'){ SIM.nombre=el.value; const b=$('#rSave'); if(b) b.disabled=!puedeGuardar(); }
  if(el.dataset.mc==='n'){ const v=parseInt(el.value,10); SIM.n=Number.isFinite(v)&&v>=0?v:0;
    const r=calcRot(SIM), c=$('#mcalc'); if(c){ const pos=el.selectionStart; c.innerHTML=calcHTML(); const ni=$('#rN'); ni.focus(); try{ ni.setSelectionRange(pos,pos); }catch(e){} }
    const b=$('#rSave'); if(b) b.disabled=!puedeGuardar(); }
}
async function guardarRot(){
  if(!puedeGuardar()) return;
  const r=calcRot(SIM), sel=[...SIM.sel];
  const obj={id:SIM.id||('r'+Date.now()), nombre:SIM.nombre.trim(), fecha:stamp(), firma:MAPA.firma,
    pots:sel, nomPots:sel.map(i=>MP.pots[i].nom), ha:+r.area.toFixed(2), carga:SIM.carga, kgha:r.kgha,
    cat:SIM.cat, toros:r.conToro, n:r.n, nt:r.nt, kg:Math.round(r.kg), cap:Math.round(r.cap), ocup:r.ocup,
    color:SIM.color||colorLibre(), vis:true};
  const i=ROTS.findIndex(x=>x.id===obj.id); if(i>=0) ROTS[i]=obj; else ROTS.push(obj);
  SIM=null; await mapaGuardar(true); renderMain(); toast(`Rotación "${obj.nombre}" guardada`);
}
window.addEventListener('resize',()=>{ if(tab==='mapa') ajustarAspecto(); });

/* ---------- Excel: hojas y respaldo ---------- */
function hojasMapa(wb){
  if(!MAPA) return;
  hoja(wb,'Potreros',['Potrero','Área (ha)','Rotaciones'],MAPA.pots.map((p,i)=>[p.nom,p.ha,ROTS.filter(r=>r.firma===MAPA.firma&&r.pots.includes(i)).map(r=>r.nombre).join(', ')]));
  hoja(wb,'Rotaciones',['Nombre','Fecha','Hora','Potreros','N° potreros','Área total (ha)','Carga','kg/Ha','Capacidad (kg)','Categoría','Peso por animal (kg)','Animales','Toros','Peso total (kg)','Ocupación %','Mapa'],
    ROTS.map(r=>[r.nombre,fecha(r.fecha),hora(r.fecha),r.nomPots.join(', '),r.pots.length,r.ha,r.carga,r.kgha,r.cap,CATS[r.cat]?.t||r.cat,CATS[r.cat]?.kg||'',r.n,r.nt,r.kg,Math.round(r.ocup*100),r.firma===MAPA.firma?'Actual':'Otro mapa']));
}
function filasRespaldoMapa(){
  if(!MAPA&&!ROTS.length) return [];
  const s=JSON.stringify({mapa:MAPA,rots:ROTS}), out=[];
  for(let i=0;i<s.length;i+=30000) out.push(['MAPA',out.length,s.slice(i,i+30000)]);
  return out;
}
function leerMapaRespaldo(rows){
  const parts=rows.filter(r=>r[0]==='MAPA').sort((a,b)=>a[1]-b[1]).map(r=>String(r[2]));
  if(!parts.length) return null;
  try{ return JSON.parse(parts.join('')); }catch(e){ return null; }
}
async function restaurarMapa(v){ if(!v) return; MAPA=v.mapa||null; ROTS=v.rots||[]; SIM=null; VB=null; prepararMapa(); await mapaGuardar(false); }
