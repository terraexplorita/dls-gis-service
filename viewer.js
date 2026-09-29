import http from 'node:http';
import {spawn} from 'node:child_process';
import {URL} from 'node:url';
import {properties,mapGroups} from './data.js';

const PORT=Number(process.env.PORT||10000);
const CORE_PORT=Number(process.env.CORE_PORT||10001);
const CORE=`http://127.0.0.1:${CORE_PORT}`;

function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function money(v){return v==null?'—':new Intl.NumberFormat('el-CY',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(v);}

function sidebar(group){
  const keys=mapGroups[group]?.keys||[];
  const items=keys.map(k=>[k,properties[k]]).filter(([,p])=>p);
  const row=([k,p])=>`<div class="vrow ${p.kind}"><a class="vtitle" href="/property/${k}">${esc(p.code)} — ${esc(p.title)}</a><div class="vmeta">${p.kind==='owned'?`Ιδιοκτησία ${esc(p.share||'100%')} · Εγγρ. ${esc(p.registration||'—')}`:`${esc(p.priceType||'Τιμή')}: <strong>${esc(money(p.price))}</strong>`}</div><div class="vlinks"><a href="/property/${k}">Details</a>${p.sourceUrl?` · <a href="${esc(p.sourceUrl)}" target="_blank">Source ↗</a>`:' · <span>χωρίς source</span>'}</div></div>`;
  const owned=items.filter(([,p])=>p.kind==='owned').map(row).join('');
  const candidates=items.filter(([,p])=>p.kind==='candidate').map(row).join('');
  return `<div class="vsideHead"><a class="allprops" href="/properties">ΟΛΑ ΤΑ ΑΚΙΝΗΤΑ</a></div><h2>ΙΔΙΟΚΤΗΤΑ ΑΚΙΝΗΤΑ</h2>${owned}<h2>ΑΚΙΝΗΤΑ ΠΡΟΣ ΑΓΟΡΑ</h2>${candidates}`;
}

function mapPage(group,mpp){
  const g=mapGroups[group];
  if(!g)return null;
  return `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(g.title)}</title><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;font-family:Arial,sans-serif;color:#171717}.topbar{height:54px;background:#111;color:#fff;display:flex;align-items:center;padding:0 14px;gap:16px}.topbar a{color:#fff;text-decoration:none}.app{height:calc(100vh - 54px);display:grid;grid-template-columns:minmax(0,1fr) 420px}.mapwrap{position:relative;overflow:hidden;background:#ddd;cursor:grab;touch-action:none}.mapwrap.dragging{cursor:grabbing}.mapobj{position:absolute;left:0;top:0;border:0;transform-origin:0 0;will-change:transform}.controls{position:absolute;z-index:4;left:14px;top:14px;display:flex;flex-direction:column;gap:7px}.controls button{width:46px;height:46px;border:1px solid #777;background:#fff;border-radius:7px;font-size:24px;font-weight:700;box-shadow:0 1px 5px #0003;cursor:pointer}.controls .fit{width:82px;font-size:13px}.hint{position:absolute;left:14px;bottom:14px;background:#fffffff0;padding:8px 11px;border-radius:6px;font-size:13px;z-index:4}.sidebar{overflow:auto;background:#fff;border-left:1px solid #ccc;padding:16px}.vsideHead{display:flex;justify-content:flex-end;position:sticky;top:-16px;background:#fff;padding:4px 0 12px;z-index:3}.allprops{background:#111;color:#fff!important;padding:10px 13px;border-radius:6px;text-decoration:none;font-weight:700}.sidebar h2{font-size:18px;margin:16px 0 8px}.vrow{padding:10px 11px;margin:0 0 8px;border-radius:7px;border:1px solid #ddd}.vrow.owned{border-left:5px solid #27883c}.vrow.candidate{border-left:5px solid #d64b25}.vtitle{display:block;font-size:15px;font-weight:700;color:#111;text-decoration:none;line-height:1.3}.vmeta{font-size:14px;color:#444;margin-top:5px}.vlinks{font-size:13px;margin-top:6px}.vlinks a{color:#2457c5}.vlinks span{color:#888}.sideToggle{display:none;margin-left:auto;background:#fff;color:#111;border:0;border-radius:5px;padding:7px 10px}@media(max-width:900px){.app{grid-template-columns:1fr}.sidebar{position:absolute;right:0;top:54px;bottom:0;width:min(88vw,420px);z-index:6;box-shadow:-3px 0 10px #0003;transform:translateX(100%);transition:.2s}.sidebar.open{transform:none}.sideToggle{display:block}}
</style></head><body><div class="topbar"><strong>PERSONAL LIFE OS — ΑΚΙΝΗΤΑ</strong><a href="/map?group=arsos">Άρσος</a><a href="/map?group=pafos">Άγιος Νικόλαος</a><a href="/properties">Όλα τα ακίνητα</a><button class="sideToggle" id="sideToggle">Λίστα</button></div><div class="app"><div class="mapwrap" id="mapwrap"><object id="mapobj" class="mapobj" data="/map.svg?group=${encodeURIComponent(group)}&mpp=${mpp}" type="image/svg+xml"></object><div class="controls"><button id="zin" title="Zoom in">+</button><button id="zout" title="Zoom out">−</button><button class="fit" id="fit">Fit all</button></div><div class="hint">Wheel: zoom · σύρε: μετακίνηση</div></div><aside class="sidebar" id="sidebar">${sidebar(group)}</aside></div><script>
(()=>{const wrap=document.getElementById('mapwrap'),obj=document.getElementById('mapobj'),side=document.getElementById('sidebar');let mapW=1000,mapH=1000,totalW=1620,totalH=1000,scale=1,x=0,y=0,drag=false,lastX=0,lastY=0,moved=false;const clamp=()=>{const vw=wrap.clientWidth,vh=wrap.clientHeight,sw=mapW*scale,sh=mapH*scale;x=sw<=vw?(vw-sw)/2:Math.min(0,Math.max(vw-sw,x));y=sh<=vh?(vh-sh)/2:Math.min(0,Math.max(vh-sh,y))};const apply=()=>{clamp();obj.style.transform='translate('+x+'px,'+y+'px) scale('+scale+')'};const fit=()=>{const vw=wrap.clientWidth,vh=wrap.clientHeight;scale=Math.min(vw/mapW,vh/mapH);x=(vw-mapW*scale)/2;y=(vh-mapH*scale)/2;apply()};const zoom=(factor,cx=wrap.clientWidth/2,cy=wrap.clientHeight/2)=>{const old=scale,ns=Math.max(.15,Math.min(12,scale*factor));x=cx-(cx-x)*(ns/old);y=cy-(cy-y)*(ns/old);scale=ns;apply()};obj.addEventListener('load',()=>{try{const doc=obj.contentDocument,svg=doc.documentElement;totalW=Number(svg.getAttribute('width'))||svg.viewBox.baseVal.width;totalH=Number(svg.getAttribute('height'))||svg.viewBox.baseVal.height;mapW=Math.max(1,totalW-620);mapH=totalH;obj.style.width=totalW+'px';obj.style.height=totalH+'px';doc.addEventListener('wheel',e=>{e.preventDefault();const r=wrap.getBoundingClientRect();zoom(e.deltaY<0?1.22:.82,e.clientX-r.left,e.clientY-r.top)},{passive:false});doc.addEventListener('pointerdown',e=>{if(e.button!==0)return;drag=true;moved=false;lastX=e.clientX;lastY=e.clientY;wrap.classList.add('dragging');e.preventDefault()});doc.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-lastX,dy=e.clientY-lastY;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;x+=dx;y+=dy;lastX=e.clientX;lastY=e.clientY;apply();e.preventDefault()});doc.addEventListener('pointerup',e=>{drag=false;wrap.classList.remove('dragging');if(moved){e.preventDefault();e.stopPropagation()}},true);fit()}catch(err){console.error(err)}});wrap.addEventListener('wheel',e=>{if(e.target===wrap){e.preventDefault();const r=wrap.getBoundingClientRect();zoom(e.deltaY<0?1.22:.82,e.clientX-r.left,e.clientY-r.top)}},{passive:false});document.getElementById('zin').onclick=()=>zoom(1.35);document.getElementById('zout').onclick=()=>zoom(.74);document.getElementById('fit').onclick=fit;window.addEventListener('resize',fit);document.getElementById('sideToggle').onclick=()=>side.classList.toggle('open')})();
</script></body></html>`;
}

const core=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(CORE_PORT)},stdio:'inherit'});
core.on('exit',(code,signal)=>{console.error('Core server exited',code,signal);process.exit(code||1)});

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://local');
    if(u.pathname==='/map'){
      const group=u.searchParams.get('group')||'arsos';
      const mpp=Number(u.searchParams.get('mpp')||2);
      const page=mapPage(group,mpp);
      if(!page){res.writeHead(400,{'content-type':'application/json'});return res.end(JSON.stringify({error:'Unknown group'}));}
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(page);
    }
    const target=new URL(req.url,CORE);
    const headers={};for(const[k,v]of Object.entries(req.headers))if(v!=null&&!['host','content-length'].includes(k))headers[k]=v;
    const r=await fetch(target,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:req,duplex:'half',signal:AbortSignal.timeout(120000)});
    const outHeaders={};r.headers.forEach((v,k)=>{if(!['transfer-encoding','content-encoding','content-length'].includes(k))outHeaders[k]=v});
    const buf=Buffer.from(await r.arrayBuffer());outHeaders['content-length']=String(buf.length);res.writeHead(r.status,outHeaders);res.end(buf);
  }catch(e){console.error(e);res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}
});
server.listen(PORT,()=>console.log(`DLS viewer listening on ${PORT}; core on ${CORE_PORT}`));
process.on('SIGTERM',()=>{core.kill('SIGTERM');server.close(()=>process.exit(0))});
