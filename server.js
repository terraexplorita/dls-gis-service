import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 10000);
const DLS_CADASTRAL = 'https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer/0';
const DLS_PROPERTY = 'https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/General_Search/MapServer/14';
const CRS = 102319; // Cyprus Local Transverse Mercator used by DLS General_Search, metres

const catalog = {
  // OWNED — ARSOS
  'IDI0001': {kind:'owned', share:'1/2', label:'99/25 Μέσα στο χωριό', sheet:'46', plan:'5322V01', block:1, parcel:262},
  'IDI0002': {kind:'owned', share:'100%', label:'4/30 ΣΤΑΥΡΟΣ', sheet:'46', plan:'40W2', block:4, parcel:32},
  'IDI0003': {kind:'owned', share:'100%', label:'5/120 ΚΟΙΛΙΑΡΟΥ', sheet:'46', plan:'40W2', block:5, parcel:120},
  'IDI0004': {kind:'owned', share:'100%', label:'5/122 ΒΑΛΑΝΤΟΣ', sheet:'46', plan:'40W2', block:5, parcel:122},
  'IDI0005': {kind:'owned', share:'100%', label:'2/124 ΚΟΚΚΙΝΟΚΑΜΠΟΣ', sheet:'46', plan:'31E1', block:2, parcel:124},
  'IDI0006': {kind:'owned', share:'100%', label:'4/274 ΣΤΑΖΟΥΣΑ Αμπέλι', sheet:'46', plan:'48W1', block:4, parcel:287},
  'IDI0007': {kind:'owned', share:'100%', label:'3/286 ΒΥΖΑΤΖΙΑ', sheet:'46', plan:'47E1', block:3, parcel:296},
  'IDI0009': {kind:'owned', share:'100%', label:'0/7732 ΦΡΑΚΤΗ', sheet:'46', plan:'40', block:0, parcel:434},
  'IDI0011': {kind:'owned', share:'100%', label:'0/9564 ΦΟΥΡΝΟΣ', sheet:'46', plan:'5322V01', block:1, parcel:301},
  'IDI0012': {kind:'owned', share:'100%', label:'0/10226 ΑΓΙΟΣ ΓΕΩΡΓΙΟΣ', sheet:'46', plan:'47', block:0, parcel:470},
  'IDI0013': {kind:'owned', share:'100%', label:'0/10436 ΣΠΙΤΙ', sheet:'46', plan:'5322V01', block:1, parcel:912},
  'IDI0014': {kind:'owned', share:'1/2', label:'0/10488 ΑΓ. ΓΙΩΡΚΗΣ', sheet:'46', plan:'47', block:0, parcel:91},
  'IDI0015': {kind:'owned', share:'100%', label:'0/11338 ΚΑΖΑΝΙΑ', sheet:'46', plan:'5322V01', block:1, parcel:827},
  'IDI0016': {kind:'owned', share:'1/2', label:'0/12110 ΜΙΛΟΝΗΣ', sheet:'46', plan:'40', block:0, parcel:743},
  'IDI0017': {kind:'owned', share:'2/3', label:'0/12563 ΚΟΥΤΖΙΕΝΑ', sheet:'46', plan:'5322V01', block:1, parcel:832},

  // OWNED — AGIOS NIKOLAOS PAFOS
  'IDI0008': {kind:'owned', share:'100%', label:'0/7638 ΚΑΜΙΝΟΥΔΙΑ', sheet:'46', plan:'24', block:0, parcel:260, group:'pafos'},
  'IDI0010': {kind:'owned', share:'100%', label:'0/8225 ΓΟΥΠΠΟΣ', sheet:'46', plan:'24', block:0, parcel:575, group:'pafos'},

  // CANDIDATES — ARSOS (AKI0005 deliberately absent: exact locator unresolved)
  'AKI0002': {kind:'candidate', label:'ΕΡΓ-ΑΚΙ-0002 GoGordian 7281', sheet:'46', plan:'47E1', block:4, parcel:117},
  'AKI0003': {kind:'candidate', label:'ΕΡΓ-ΑΚΙ-0003 REMU 42711', sheet:'46', plan:'48W1', block:4, parcel:105},
  'AKI0004': {kind:'candidate', label:'ΕΡΓ-ΑΚΙ-0004 Altamira PR37313', sheet:'46', plan:'40W1', block:5, parcel:99},
  'AKI0006': {kind:'candidate', label:'ΕΡΓ-ΑΚΙ-0006 GoGordian 8057', sheet:'46', plan:'39E1', block:3, parcel:139},
  'AKI0007': {kind:'candidate', label:'ΕΡΓ-ΑΚΙ-0007 REMU 40761', sheet:'46', plan:'39E2', block:3, parcel:215},
  'AKI0008': {kind:'candidate', label:'ΕΡΓ-ΑΚΙ-0008 Πλειστηριασμός 3/147', sheet:'46', plan:'39E2', block:3, parcel:149},
  'AKI0009': {kind:'candidate', label:'ΕΡΓ-ΑΚΙ-0009 REMU 39724', sheet:'46', plan:'39E1', block:3, parcel:143},
  'AKI0010': {kind:'candidate', label:'ΕΡΓ-ΑΚΙ-0010 Altamira PR45469', sheet:'46', plan:'39E2', block:3, parcel:150},
  'AKI0011': {kind:'candidate', label:'ΕΡΓ-ΑΚΙ-0011 Altamira PR39414', sheet:'46', plan:'40', block:0, parcel:702},
};

function json(res, status, body) {
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*'});
  res.end(data);
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }

async function arcQuery(base, params) {
  const u = new URL(base + '/query');
  for (const [k,v] of Object.entries(params)) u.searchParams.set(k, String(v));
  const r = await fetch(u, {headers:{'user-agent':'dls-gis-service/1.0'}, signal:AbortSignal.timeout(20000)});
  if (!r.ok) throw new Error(`DLS HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`DLS ${j.error.code}: ${j.error.message}`);
  return j;
}

async function getParcel(p) {
  const where = [
    `SHEET='${String(p.sheet).replaceAll("'", "''")}'`,
    `PLAN_NBR='${String(p.plan).replaceAll("'", "''")}'`,
    `BLCK_CODE=${Number(p.block)}`,
    `PARCEL_NBR=${Number(p.parcel)}`
  ].join(' AND ');
  const j = await arcQuery(DLS_CADASTRAL, {
    f:'json', where, outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,QRTR_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,OBJECTID,SHAPE.STArea()',
    returnGeometry:'true', outSR:CRS, returnZ:'false'
  });
  if (!Array.isArray(j.features) || j.features.length !== 1) {
    throw new Error(`Expected exactly 1 DLS feature for ${p.sheet}/${p.plan} block ${p.block} parcel ${p.parcel}; got ${j.features?.length ?? 0}`);
  }
  return j.features[0];
}

function ringsOf(f) { return f?.geometry?.rings || []; }
function pointsOf(f) { return ringsOf(f).flat(); }
function bbox(f) {
  const pts = pointsOf(f); if (!pts.length) throw new Error('No polygon points');
  let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;
  for (const [x,y] of pts) { xmin=Math.min(xmin,x); ymin=Math.min(ymin,y); xmax=Math.max(xmax,x); ymax=Math.max(ymax,y); }
  return {xmin,ymin,xmax,ymax};
}
function mergeBbox(boxes) {
  return boxes.reduce((a,b)=>({xmin:Math.min(a.xmin,b.xmin),ymin:Math.min(a.ymin,b.ymin),xmax:Math.max(a.xmax,b.xmax),ymax:Math.max(a.ymax,b.ymax)}));
}
function centroid(f) {
  const pts = pointsOf(f); return pts.reduce((a,[x,y])=>[a[0]+x/pts.length,a[1]+y/pts.length],[0,0]);
}
function segDist(a,b,c,d) {
  // Minimum distance between two line segments in 2D, including intersections.
  const orient=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);
  const on=(p,q,r)=>Math.min(p[0],r[0])-1e-9<=q[0]&&q[0]<=Math.max(p[0],r[0])+1e-9&&Math.min(p[1],r[1])-1e-9<=q[1]&&q[1]<=Math.max(p[1],r[1])+1e-9;
  const o1=orient(a,b,c),o2=orient(a,b,d),o3=orient(c,d,a),o4=orient(c,d,b);
  if (((o1===0&&on(a,c,b))||(o2===0&&on(a,d,b))||(o3===0&&on(c,a,d))||(o4===0&&on(c,b,d))) || ((o1>0)!=(o2>0)&&(o3>0)!=(o4>0))) return 0;
  const pd=(p,a,b)=>{ const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy; if(!l2)return Math.hypot(p[0]-a[0],p[1]-a[1]); const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2)); return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy)); };
  return Math.min(pd(a,c,d),pd(b,c,d),pd(c,a,b),pd(d,a,b));
}
function polygonDistance(f1,f2) {
  let best=Infinity;
  for (const r1 of ringsOf(f1)) for (const r2 of ringsOf(f2)) {
    for(let i=1;i<r1.length;i++) for(let j=1;j<r2.length;j++) best=Math.min(best,segDist(r1[i-1],r1[i],r2[j-1],r2[j]));
  }
  return best;
}

function svgPath(f, tx, ty) {
  return ringsOf(f).map(r => r.map(([x,y],i)=>`${i?'L':'M'}${tx(x).toFixed(2)},${ty(y).toFixed(2)}`).join(' ')+' Z').join(' ');
}

async function renderSvg(keys, width=1800, paddingPx=80) {
  const items=[];
  for (const key of keys) {
    const p=catalog[key]; if(!p) throw new Error(`Unknown key ${key}`);
    const f=await getParcel(p); items.push({key,p,f,box:bbox(f),centroid:centroid(f)});
  }
  const raw=mergeBbox(items.map(x=>x.box));
  const spanX=raw.xmax-raw.xmin, spanY=raw.ymax-raw.ymin;
  const margin=Math.max(spanX,spanY)*0.06;
  const ext={xmin:raw.xmin-margin,ymin:raw.ymin-margin,xmax:raw.xmax+margin,ymax:raw.ymax+margin};
  const innerW=width-2*paddingPx;
  const mpp=(ext.xmax-ext.xmin)/innerW;
  const height=Math.ceil((ext.ymax-ext.ymin)/mpp+2*paddingPx);
  const tx=x=>paddingPx+(x-ext.xmin)/mpp;
  const ty=y=>paddingPx+(ext.ymax-y)/mpp;
  const parcelSvg=items.map(({key,p,f})=>{
    const owned=p.kind==='owned'; const partial=owned&&p.share!=='100%';
    const fill=owned?(partial?'#9bd58e':'#2e9f48'):'#f2a53b';
    const stroke=owned?'#126b2c':'#bc5a00';
    return `<path d="${svgPath(f,tx,ty)}" fill="${fill}" fill-opacity="0.62" stroke="${stroke}" stroke-width="2.5" data-key="${key}"/>`;
  }).join('\n');
  // Labels are outside geometry area on a right-side gutter when possible; leaders never alter polygon geometry.
  const sorted=[...items].sort((a,b)=>b.centroid[1]-a.centroid[1]);
  const labelX=Math.max(...items.map(i=>tx(i.box.xmax)))+35;
  const labels=sorted.map((it,idx)=>{
    const cx=tx(it.centroid[0]),cy=ty(it.centroid[1]); const ly=Math.max(35, Math.min(height-35, 45+idx*34));
    return `<line x1="${cx.toFixed(1)}" y1="${cy.toFixed(1)}" x2="${labelX.toFixed(1)}" y2="${ly}" stroke="#333" stroke-width="1"/><text x="${(labelX+6).toFixed(1)}" y="${ly+4}" font-family="Arial,sans-serif" font-size="16">${esc(it.p.label)}${it.p.share?` (${esc(it.p.share)})`:''}</text>`;
  }).join('\n');
  const barM=500; const barPx=barM/mpp;
  return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#f8f6ef"/><g>${parcelSvg}</g><g>${labels}</g><g transform="translate(${paddingPx},${height-42})"><line x1="0" y1="0" x2="${barPx.toFixed(2)}" y2="0" stroke="#111" stroke-width="6"/><text x="0" y="-10" font-family="Arial" font-size="15">0</text><text x="${barPx.toFixed(2)}" y="-10" text-anchor="end" font-family="Arial" font-size="15">${barM} m</text></g><text x="${width-20}" y="24" text-anchor="end" font-family="Arial" font-size="14">DLS geometry · EPSG:102319 · ${mpp.toFixed(4)} m/px</text></svg>`, mpp, extent:ext, width, height, items};
}

const server=http.createServer(async(req,res)=>{
  try {
    if(req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-methods':'GET,OPTIONS'});return res.end();}
    const u=new URL(req.url,`http://${req.headers.host}`);
    if(u.pathname==='/health') return json(res,200,{ok:true,service:'dls-gis-service',crs:CRS,units:'metres'});
    if(u.pathname==='/catalog') return json(res,200,{catalog, omitted:['AKI0005']});
    if(u.pathname==='/parcel') {
      const p={sheet:u.searchParams.get('sheet'),plan:u.searchParams.get('plan'),block:Number(u.searchParams.get('block')),parcel:Number(u.searchParams.get('parcel'))};
      return json(res,200,{query:p,feature:await getParcel(p),crs:CRS});
    }
    if(u.pathname==='/registration') {
      const block=Number(u.searchParams.get('block')); const no=u.searchParams.get('no');
      const j=await arcQuery(DLS_PROPERTY,{f:'json',where:`RegistrationBlock=${block} AND RegistrationNo='${String(no).replaceAll("'","''")}'`,outFields:'*',returnGeometry:'false'});
      return json(res,200,j);
    }
    if(u.pathname==='/distance') {
      const a=u.searchParams.get('a'),b=u.searchParams.get('b'); if(!catalog[a]||!catalog[b]) throw new Error('Unknown a/b key');
      const [fa,fb]=await Promise.all([getParcel(catalog[a]),getParcel(catalog[b])]);
      const d=polygonDistance(fa,fb); return json(res,200,{a,b,distance_m:d,touches:d<0.02,crs:CRS});
    }
    if(u.pathname==='/map.svg') {
      const group=u.searchParams.get('group')||'arsos';
      const keys=group==='pafos'?['IDI0008','IDI0010']:Object.keys(catalog).filter(k=>catalog[k].group!=='pafos');
      const out=await renderSvg(keys, Number(u.searchParams.get('width')||1800));
      res.writeHead(200,{'content-type':'image/svg+xml; charset=utf-8','access-control-allow-origin':'*','x-meters-per-pixel':String(out.mpp)}); return res.end(out.svg);
    }
    if(u.pathname==='/verify') {
      const pairs=[['IDI0006','AKI0003'],['AKI0008','AKI0010'],['AKI0006','AKI0009'],['IDI0016','AKI0004']];
      const results=[];
      for(const [a,b] of pairs){const [fa,fb]=await Promise.all([getParcel(catalog[a]),getParcel(catalog[b])]);results.push({a,b,distance_m:polygonDistance(fa,fb)});}
      return json(res,200,{ok:true,crs:CRS,results});
    }
    json(res,404,{error:'not found'});
  } catch(e) { json(res,500,{error:e.message}); }
});
server.listen(PORT,()=>console.log(`DLS GIS service listening on ${PORT}`));
