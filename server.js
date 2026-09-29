import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 10000);
const MAP = 'https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer';
const PARCELS = MAP + '/0';
const DISTRICTS = MAP + '/15';
const COMMUNITIES = MAP + '/16';
const EXPORT = MAP + '/export';
const CRS = 102319; // DLS Cyprus local projected CRS, metres

const AREAS = {
  arsos: { district: 'LEMESOS', communityNeedle: 'ARSOS', canonical: 'ARSOS LEMESOU' },
  pafos: { district: 'PAFOS', communityNeedle: 'AGIOS NIKOLAOS', canonical: 'AGIOS NIKOLAOS PAFOU' }
};

const catalog = {
  // OWNED — ΑΡΣΟΣ
  IDI0001:{kind:'owned',share:'1/2',label:'99/25 — Μέσα στο χωριό',area:'arsos',sheet:'46',plan:'5322V01',block:1,parcel:262},
  IDI0002:{kind:'owned',share:'100%',label:'4/30 — ΣΤΑΥΡΟΣ',area:'arsos',sheet:'46',plan:'40W2',block:4,parcel:32},
  IDI0003:{kind:'owned',share:'100%',label:'5/120 — ΚΟΙΛΙΑΡΟΥ',area:'arsos',sheet:'46',plan:'40W2',block:5,parcel:120},
  IDI0004:{kind:'owned',share:'100%',label:'5/122 — ΒΑΛΑΝΤΟΣ',area:'arsos',sheet:'46',plan:'40W2',block:5,parcel:122},
  IDI0005:{kind:'owned',share:'100%',label:'2/124 — ΚΟΚΚΙΝΟΚΑΜΠΟΣ',area:'arsos',sheet:'46',plan:'31E1',block:2,parcel:124},
  IDI0006:{kind:'owned',share:'100%',label:'4/274 — ΣΤΑΖΟΥΣΑ Αμπέλι',area:'arsos',sheet:'46',plan:'48W1',block:4,parcel:287},
  IDI0007:{kind:'owned',share:'100%',label:'3/286 — ΒΥΖΑΤΖΙΑ',area:'arsos',sheet:'46',plan:'47E1',block:3,parcel:296},
  IDI0009:{kind:'owned',share:'100%',label:'0/7732 — ΦΡΑΚΤΗ',area:'arsos',sheet:'46',plan:'40',block:0,parcel:434},
  IDI0011:{kind:'owned',share:'100%',label:'0/9564 — ΦΟΥΡΝΟΣ',area:'arsos',sheet:'46',plan:'5322V01',block:1,parcel:301},
  IDI0012:{kind:'owned',share:'100%',label:'0/10226 — ΑΓΙΟΣ ΓΕΩΡΓΙΟΣ',area:'arsos',sheet:'46',plan:'47',block:0,parcel:470},
  IDI0013:{kind:'owned',share:'100%',label:'0/10436 — ΣΠΙΤΙ',area:'arsos',sheet:'46',plan:'5322V01',block:1,parcel:912},
  IDI0014:{kind:'owned',share:'1/2',label:'0/10488 — ΑΓ. ΓΙΩΡΚΗΣ',area:'arsos',sheet:'46',plan:'47',block:0,parcel:91},
  IDI0015:{kind:'owned',share:'100%',label:'0/11338 — ΚΑΖΑΝΙΑ',area:'arsos',sheet:'46',plan:'5322V01',block:1,parcel:827},
  IDI0016:{kind:'owned',share:'1/2',label:'0/12110 — ΜΙΛΟΝΗΣ',area:'arsos',sheet:'46',plan:'40',block:0,parcel:743},
  IDI0017:{kind:'owned',share:'2/3',label:'0/12563 — ΚΟΥΤΖΙΕΝΑ',area:'arsos',sheet:'46',plan:'5322V01',block:1,parcel:832},

  // OWNED — ΑΓΙΟΣ ΝΙΚΟΛΑΟΣ ΠΑΦΟΥ
  IDI0008:{kind:'owned',share:'100%',label:'0/7638 — ΚΑΜΙΝΟΥΔΙΑ',area:'pafos',sheet:'46',plan:'24',block:0,parcel:260},
  IDI0010:{kind:'owned',share:'100%',label:'0/8225 — ΓΟΥΠΠΟΣ',area:'pafos',sheet:'46',plan:'24',block:0,parcel:575},

  // CANDIDATES — ΑΡΣΟΣ (AKI0005 deliberately omitted: cadastral locator unresolved)
  AKI0002:{kind:'candidate',label:'ΕΡΓ-ΑΚΙ-0002 — GoGordian 7281',area:'arsos',sheet:'46',plan:'47E1',block:4,parcel:117},
  AKI0003:{kind:'candidate',label:'ΕΡΓ-ΑΚΙ-0003 — REMU 42711',area:'arsos',sheet:'46',plan:'48W1',block:4,parcel:105},
  AKI0004:{kind:'candidate',label:'ΕΡΓ-ΑΚΙ-0004 — Altamira PR37313',area:'arsos',sheet:'46',plan:'40W1',block:5,parcel:99},
  AKI0006:{kind:'candidate',label:'ΕΡΓ-ΑΚΙ-0006 — GoGordian 8057',area:'arsos',sheet:'46',plan:'39E1',block:3,parcel:139},
  AKI0007:{kind:'candidate',label:'ΕΡΓ-ΑΚΙ-0007 — REMU 40761',area:'arsos',sheet:'46',plan:'39E2',block:3,parcel:215},
  AKI0008:{kind:'candidate',label:'ΕΡΓ-ΑΚΙ-0008 — Πλειστηριασμός 3/147',area:'arsos',sheet:'46',plan:'39E2',block:3,parcel:149},
  AKI0009:{kind:'candidate',label:'ΕΡΓ-ΑΚΙ-0009 — REMU 39724',area:'arsos',sheet:'46',plan:'39E1',block:3,parcel:143},
  AKI0010:{kind:'candidate',label:'ΕΡΓ-ΑΚΙ-0010 — Altamira PR45469',area:'arsos',sheet:'46',plan:'39E2',block:3,parcel:150},
  AKI0011:{kind:'candidate',label:'ΕΡΓ-ΑΚΙ-0011 — Altamira PR39414',area:'arsos',sheet:'46',plan:'40',block:0,parcel:702}
};

function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));}
function json(res,status,body){const data=JSON.stringify(body,null,2);res.writeHead(status,{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'});res.end(data);}
async function q(base,params){const u=new URL(base+'/query');for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));const r=await fetch(u,{signal:AbortSignal.timeout(25000),headers:{'user-agent':'dls-gis-service/2.0'}});if(!r.ok)throw new Error(`DLS HTTP ${r.status}`);const j=await r.json();if(j.error)throw new Error(`DLS ${j.error.code}: ${j.error.message}`);return j;}

const areaCache={};
async function areaCodes(areaKey){
  if(areaCache[areaKey]) return areaCache[areaKey];
  const a=AREAS[areaKey]; if(!a) throw new Error(`Unknown area ${areaKey}`);
  const dj=await q(DISTRICTS,{f:'json',where:`DIST_NM_E='${a.district}'`,outFields:'DIST_CODE,DIST_NM_E',returnGeometry:'false'});
  if(dj.features?.length!==1) throw new Error(`District ${a.district}: expected 1, got ${dj.features?.length??0}`);
  const dist=Number(dj.features[0].attributes.DIST_CODE);
  const cj=await q(COMMUNITIES,{f:'json',where:`DIST_CODE=${dist} AND UPPER(VIL_NM_E) LIKE '%${a.communityNeedle.toUpperCase()}%'`,outFields:'DIST_CODE,VIL_CODE,VIL_NM_E',returnGeometry:'false'});
  if(cj.features?.length!==1) throw new Error(`Community ${a.district}/${a.communityNeedle}: expected 1, got ${cj.features?.length??0}`);
  const attrs=cj.features[0].attributes;
  return areaCache[areaKey]={dist,vil:Number(attrs.VIL_CODE),district:String(dj.features[0].attributes.DIST_NM_E),community:String(attrs.VIL_NM_E)};
}

const parcelCache=new Map();
async function getParcel(p){
  const cacheKey=`${p.area}:${p.sheet}:${p.plan}:${p.block}:${p.parcel}`;
  if(parcelCache.has(cacheKey)) return parcelCache.get(cacheKey);
  const c=await areaCodes(p.area);
  const where=`DIST_CODE=${c.dist} AND VIL_CODE=${c.vil} AND BLCK_CODE=${Number(p.block)} AND PARCEL_NBR=${Number(p.parcel)} AND SHEET='${String(p.sheet).replaceAll("'","''")}' AND PLAN_NBR='${String(p.plan).replaceAll("'","''")}'`;
  const j=await q(PARCELS,{f:'json',where,outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,QRTR_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,OBJECTID,SHAPE.STArea()',returnGeometry:'true',outSR:CRS,returnZ:'false'});
  if(!Array.isArray(j.features)||j.features.length!==1) throw new Error(`Expected exactly 1 DLS feature for ${where}; got ${j.features?.length??0}`);
  parcelCache.set(cacheKey,j.features[0]);
  return j.features[0];
}

const rings=f=>f?.geometry?.rings||[];
const points=f=>rings(f).flat();
function bbox(f){const ps=points(f);if(!ps.length)throw new Error('No polygon points');let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;for(const[x,y]of ps){xmin=Math.min(xmin,x);ymin=Math.min(ymin,y);xmax=Math.max(xmax,x);ymax=Math.max(ymax,y);}return{xmin,ymin,xmax,ymax};}
function mergeBbox(bs){return bs.reduce((a,b)=>({xmin:Math.min(a.xmin,b.xmin),ymin:Math.min(a.ymin,b.ymin),xmax:Math.max(a.xmax,b.xmax),ymax:Math.max(a.ymax,b.ymax)}));}
function centroid(f){const ps=points(f);return ps.reduce((a,[x,y])=>[a[0]+x/ps.length,a[1]+y/ps.length],[0,0]);}
function pointSegDist(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(!l2)return Math.hypot(p[0]-a[0],p[1]-a[1]);const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2));return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy));}
function segDist(a,b,c,d){const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);const on=(p,q,r)=>Math.min(p[0],r[0])-1e-7<=q[0]&&q[0]<=Math.max(p[0],r[0])+1e-7&&Math.min(p[1],r[1])-1e-7<=q[1]&&q[1]<=Math.max(p[1],r[1])+1e-7;const o1=o(a,b,c),o2=o(a,b,d),o3=o(c,d,a),o4=o(c,d,b);if((Math.abs(o1)<1e-7&&on(a,c,b))||(Math.abs(o2)<1e-7&&on(a,d,b))||(Math.abs(o3)<1e-7&&on(c,a,d))||(Math.abs(o4)<1e-7&&on(c,b,d))||((o1>0)!=(o2>0)&&(o3>0)!=(o4>0)))return 0;return Math.min(pointSegDist(a,c,d),pointSegDist(b,c,d),pointSegDist(c,a,b),pointSegDist(d,a,b));}
function polygonDistance(a,b){let z=Infinity;for(const r1 of rings(a))for(const r2 of rings(b))for(let i=1;i<r1.length;i++)for(let j=1;j<r2.length;j++)z=Math.min(z,segDist(r1[i-1],r1[i],r2[j-1],r2[j]));return z;}
function svgPath(f,tx,ty){return rings(f).map(r=>r.map(([x,y],i)=>`${i?'L':'M'}${tx(x).toFixed(2)},${ty(y).toFixed(2)}`).join(' ')+' Z').join(' ');}

async function fetchBasemap(ext,width,height){
  const u=new URL(EXPORT);
  const params={bbox:`${ext.xmin},${ext.ymin},${ext.xmax},${ext.ymax}`,bboxSR:CRS,imageSR:CRS,size:`${width},${height}`,dpi:96,format:'png32',transparent:'false',f:'image'};
  for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));
  const r=await fetch(u,{signal:AbortSignal.timeout(30000),headers:{'user-agent':'dls-gis-service/2.0'}});
  if(!r.ok)throw new Error(`DLS export HTTP ${r.status}`);
  const ab=await r.arrayBuffer();
  const ct=r.headers.get('content-type')||'';
  if(!ct.includes('image')) throw new Error(`DLS export returned ${ct}`);
  return `data:${ct};base64,${Buffer.from(ab).toString('base64')}`;
}

async function loadItems(keys){const out=[];for(const key of keys){const p=catalog[key];if(!p)throw new Error(`Unknown key ${key}`);const f=await getParcel(p);out.push({key,p,f,box:bbox(f),centroid:centroid(f),area:Number(f.attributes?.['SHAPE.STArea()'])});}return out;}
function extentFor(items,marginMeters=120){const r=mergeBbox(items.map(x=>x.box));return{xmin:r.xmin-marginMeters,ymin:r.ymin-marginMeters,xmax:r.xmax+marginMeters,ymax:r.ymax+marginMeters};}

async function renderPanel(keys,{mpp=2,width=null,title=''}={}){
  const items=await loadItems(keys);const ext=extentFor(items);
  const mapW=width||Math.ceil((ext.xmax-ext.xmin)/mpp);const mapH=Math.ceil((ext.ymax-ext.ymin)/mpp);const actualMpp=(ext.xmax-ext.xmin)/mapW;
  const labelW=520,totalW=mapW+labelW,totalH=Math.max(mapH,70+items.length*32);
  const tx=x=>(x-ext.xmin)/actualMpp,ty=y=>(ext.ymax-y)/actualMpp;
  const basemap=await fetchBasemap(ext,mapW,mapH);
  const defs=`<defs><pattern id="partial" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#8fd394" fill-opacity="0.55"/><line x1="0" y1="0" x2="0" y2="10" stroke="#176a2c" stroke-width="3"/></pattern></defs>`;
  const polys=items.map(({key,p,f})=>{const partial=p.kind==='owned'&&p.share!=='100%';const fill=p.kind==='owned'?(partial?'url(#partial)':'#32a852'):'#f4a236';const stroke=p.kind==='owned'?'#0b6a2c':'#b95700';return `<path d="${svgPath(f,tx,ty)}" fill="${fill}" fill-opacity="0.60" stroke="${stroke}" stroke-width="2.2" vector-effect="non-scaling-stroke" data-key="${key}"/>`;}).join('');
  const sorted=[...items].sort((a,b)=>b.centroid[1]-a.centroid[1]);
  const labels=sorted.map((it,i)=>{const x=tx(it.centroid[0]),y=ty(it.centroid[1]),ly=45+i*32,lx=mapW+20;return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${lx-8}" y2="${ly}" stroke="#303030" stroke-width="1"/><circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" fill="#111"/><text x="${lx}" y="${ly+5}" font-family="Arial,sans-serif" font-size="15" fill="#111">${esc(it.key)} · ${esc(it.p.label)}${it.p.share?` · ${esc(it.p.share)}`:''}</text>`;}).join('');
  const barM=actualMpp<1?100:actualMpp<3?500:1000,barPx=barM/actualMpp;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">${defs}<rect width="100%" height="100%" fill="#fff"/><image href="${basemap}" x="0" y="0" width="${mapW}" height="${mapH}" preserveAspectRatio="none"/><g>${polys}</g><rect x="${mapW}" y="0" width="${labelW}" height="${totalH}" fill="#fff" fill-opacity="0.96"/><text x="${mapW+20}" y="24" font-family="Arial,sans-serif" font-size="18" font-weight="700">${esc(title)}</text><g>${labels}</g><g transform="translate(25,${mapH-30})"><rect x="-8" y="-28" width="${barPx+20}" height="42" fill="#fff" fill-opacity="0.85"/><line x1="0" y1="0" x2="${barPx.toFixed(2)}" y2="0" stroke="#111" stroke-width="6"/><text x="0" y="-10" font-family="Arial" font-size="14">0</text><text x="${barPx.toFixed(2)}" y="-10" text-anchor="end" font-family="Arial" font-size="14">${barM} m</text></g><text x="${mapW-12}" y="22" text-anchor="end" font-family="Arial" font-size="13" fill="#222">EPSG:102319 · ${actualMpp.toFixed(4)} m/px · official DLS basemap</text></svg>`;
  return{svg,mpp:actualMpp,width:totalW,height:totalH,mapWidth:mapW,mapHeight:mapH,extent:ext,items};
}

async function masterSvg(mpp=2){
  const arsosKeys=Object.keys(catalog).filter(k=>catalog[k].area==='arsos');
  const pafosKeys=Object.keys(catalog).filter(k=>catalog[k].area==='pafos');
  const [a,p]=await Promise.all([renderPanel(arsosKeys,{mpp,title:'Άρσος Λεμεσού — ιδιοκτησίες & υποψήφια'}),renderPanel(pafosKeys,{mpp,title:'Άγιος Νικόλαος Πάφου — ιδιοκτησίες'})]);
  const gap=36,w=Math.max(a.width,p.width),h=a.height+gap+p.height;
  const bodyA=a.svg.replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'');
  const bodyP=p.svg.replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,'');
  return{svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#e9edf1"/><g>${bodyA}</g><g transform="translate(0,${a.height+gap})">${bodyP}</g></svg>`,mpp,panels:{arsos:a,pafos:p},width:w,height:h};
}

async function verify(){
  const pairs=[['IDI0006','AKI0003',0],['AKI0008','AKI0010',5.33],['AKI0006','AKI0009',150.94],['IDI0016','AKI0004',194.08],['IDI0008','IDI0010',0]];
  const results=[];
  for(const[a,b,expected]of pairs){const[fa,fb]=await Promise.all([getParcel(catalog[a]),getParcel(catalog[b])]);const d=polygonDistance(fa,fb);const ca=centroid(fa),cb=centroid(fb);results.push({a,b,expected_m:expected,distance_m:d,centroid_relation:{b_is_west_of_a:cb[0]<ca[0],delta_x_m:cb[0]-ca[0],delta_y_m:cb[1]-ca[1]}});}
  return{ok:true,crs:CRS,units:'metres',areas:areaCache,results};
}

const server=http.createServer(async(req,res)=>{
  try{
    if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS'});return res.end();}
    const u=new URL(req.url,`http://${req.headers.host}`);
    if(u.pathname==='/health')return json(res,200,{ok:true,service:'dls-gis-service',version:2,crs:CRS,units:'metres'});
    if(u.pathname==='/catalog')return json(res,200,{catalog,omitted:{AKI0005:'exact cadastral locator unresolved'}});
    if(u.pathname==='/parcel'){const key=u.searchParams.get('key');if(!catalog[key])throw new Error('Unknown key');return json(res,200,{key,feature:await getParcel(catalog[key]),crs:CRS,area:await areaCodes(catalog[key].area)});}
    if(u.pathname==='/distance'){const a=u.searchParams.get('a'),b=u.searchParams.get('b');if(!catalog[a]||!catalog[b])throw new Error('Unknown a/b key');const[fa,fb]=await Promise.all([getParcel(catalog[a]),getParcel(catalog[b])]);const d=polygonDistance(fa,fb);return json(res,200,{a,b,distance_m:d,touches:d<0.02,crs:CRS});}
    if(u.pathname==='/verify')return json(res,200,await verify());
    if(u.pathname==='/map.svg'){const group=u.searchParams.get('group')||'arsos',mpp=Math.max(0.25,Math.min(10,Number(u.searchParams.get('mpp')||2)));const keys=Object.keys(catalog).filter(k=>catalog[k].area===group);const out=await renderPanel(keys,{mpp,title:group==='pafos'?'Άγιος Νικόλαος Πάφου — ιδιοκτησίες':'Άρσος Λεμεσού — ιδιοκτησίες & υποψήφια'});res.writeHead(200,{'content-type':'image/svg+xml; charset=utf-8','access-control-allow-origin':'*','x-meters-per-pixel':String(out.mpp)});return res.end(out.svg);}
    if(u.pathname==='/master.svg'){const mpp=Math.max(0.25,Math.min(10,Number(u.searchParams.get('mpp')||2)));const out=await masterSvg(mpp);res.writeHead(200,{'content-type':'image/svg+xml; charset=utf-8','access-control-allow-origin':'*','x-meters-per-pixel':String(mpp)});return res.end(out.svg);}
    json(res,404,{error:'not found'});
  }catch(e){console.error('REQUEST_ERROR',e);json(res,500,{error:e.message});}
});
server.listen(PORT,()=>console.log(`DLS GIS service v2 listening on ${PORT}`));
