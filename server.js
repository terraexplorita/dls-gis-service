import http from 'node:http';
import {URL} from 'node:url';
import sharp from 'sharp';
import {properties,mapGroups} from './data.js';

const PORT=Number(process.env.PORT||10000);
const MAP='https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer';
const PARCELS=MAP+'/0',EXPORT=MAP+'/export';
const GENERAL='https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/General_Search/MapServer';
const ROADS=GENERAL+'/13';
const CRS=102319;
const AREA={arsos:{dist:5,vil:322},pafos:{dist:6,vil:218}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v??'').trim().toUpperCase();
const json=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj,null,2))};

async function query(base,params,retries=3){
  const u=new URL(base+'/query');for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));
  let last;
  for(let i=1;i<=retries;i++){
    try{const r=await fetch(u,{signal:AbortSignal.timeout(15000),headers:{'user-agent':'dls-gis-service/2.6'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);const j=await r.json();if(j.error)throw new Error(j.error.message||'DLS error');return j;}
    catch(e){last=e;if(i<retries)await sleep(i*500)}
  }
  throw last;
}

const parcelCache=new Map();
function exactFeature(fs,p){const m=(fs||[]).filter(f=>{const a=f.attributes||{};return Number(a.BLCK_CODE)===Number(p.block)&&Number(a.PARCEL_NBR)===Number(p.parcel)&&norm(a.SHEET)===norm(p.sheet)&&norm(a.PLAN_NBR)===norm(p.plan)});return m.length===1?m[0]:null}
async function getParcel(p){
  const ac=AREA[p.areaKey];if(!ac)throw new Error(`Unsupported area ${p.areaKey}`);
  const ck=[p.areaKey,p.sheet,p.plan,p.block,p.parcel].join(':');if(parcelCache.has(ck))return parcelCache.get(ck);
  const exact=`DIST_CODE=${ac.dist} AND VIL_CODE=${ac.vil} AND BLCK_CODE=${Number(p.block)} AND PARCEL_NBR=${Number(p.parcel)} AND SHEET='${p.sheet}' AND PLAN_NBR='${p.plan}'`;
  const wheres=[exact,`DIST_CODE=${ac.dist} AND VIL_CODE=${ac.vil} AND BLCK_CODE=${Number(p.block)} AND PARCEL_NBR=${Number(p.parcel)}`,`DIST_CODE=${ac.dist} AND VIL_CODE=${ac.vil} AND PARCEL_NBR=${Number(p.parcel)}`];
  const params={f:'json',outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,OBJECTID,SHAPE.STArea()',returnGeometry:true,outSR:CRS,returnZ:false};
  let best=0;
  for(const where of wheres){
    for(let i=1;i<=3;i++){
      const j=await query(PARCELS,{...params,where});best=Math.max(best,j.features?.length||0);const f=exactFeature(j.features,p);if(f){parcelCache.set(ck,f);return f}if(i<3)await sleep(i*400);
    }
  }
  throw new Error(`no exact parcel match; best=${best}`);
}

const rings=f=>f?.geometry?.rings||[];
const points=f=>rings(f).flat();
function bbox(f){let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;for(const[x,y]of points(f)){xmin=Math.min(xmin,x);ymin=Math.min(ymin,y);xmax=Math.max(xmax,x);ymax=Math.max(ymax,y)}return{xmin,ymin,xmax,ymax}}
function merge(bs){return bs.reduce((a,b)=>({xmin:Math.min(a.xmin,b.xmin),ymin:Math.min(a.ymin,b.ymin),xmax:Math.max(a.xmax,b.xmax),ymax:Math.max(a.ymax,b.ymax)}))}
function path(f,tx,ty){return rings(f).map(r=>r.map(([x,y],i)=>`${i?'L':'M'}${tx(x).toFixed(2)},${ty(y).toFixed(2)}`).join(' ')+' Z').join(' ')}

async function load(keys){const items=[],missing=[];for(const key of keys){const p=properties[key];if(!p)continue;try{const f=await getParcel(p);items.push({key,p,f,box:bbox(f)})}catch(e){missing.push(key);console.warn(`PARCEL_SKIP ${key}: ${e.message}`)}}return{items,missing}}
function extent(items,margin=120){if(!items.length)return{xmin:0,ymin:0,xmax:1600,ymax:1000};const b=merge(items.map(x=>x.box));return{xmin:b.xmin-margin,ymin:b.ymin-margin,xmax:b.xmax+margin,ymax:b.ymax+margin}}
function normalizeExtent(e,mpp){const sx=e.xmax-e.xmin,sy=e.ymax-e.ymin,w=Math.max(1,Math.ceil(sx/mpp)),h=Math.max(1,Math.ceil(sy/mpp)),dx=(w*mpp-sx)/2,dy=(h*mpp-sy)/2;return{ext:{xmin:e.xmin-dx,xmax:e.xmax+dx,ymin:e.ymin-dy,ymax:e.ymax+dy},w,h}}

async function basemap(ext,w,h){for(let i=1;i<=3;i++){try{const u=new URL(EXPORT);for(const[k,v]of Object.entries({bbox:`${ext.xmin},${ext.ymin},${ext.xmax},${ext.ymax}`,bboxSR:CRS,imageSR:CRS,size:`${w},${h}`,dpi:96,format:'png32',transparent:false,f:'image'}))u.searchParams.set(k,String(v));const r=await fetch(u,{signal:AbortSignal.timeout(15000),headers:{'user-agent':'dls-gis-service/2.6'}});if(!r.ok)throw new Error(`export ${r.status}`);const ct=r.headers.get('content-type')||'';if(!ct.includes('image'))throw new Error(`export ${ct}`);return`data:${ct};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`}catch(e){console.warn(`BASEMAP_RETRY ${i}: ${e.message}`);if(i<3)await sleep(i*500)}}return null}
async function roads(ext){try{const j=await query(ROADS,{f:'json',where:'1=1',geometry:`${ext.xmin},${ext.ymin},${ext.xmax},${ext.ymax}`,geometryType:'esriGeometryEnvelope',inSR:CRS,outSR:CRS,spatialRel:'esriSpatialRelIntersects',outFields:'*',returnGeometry:true},2);return j.features||[]}catch{return[]}}

async function render(group,mpp=2){
  const g=mapGroups[group];if(!g)throw new Error('Unknown group');const {items,missing}=await load(g.keys);
  const n=normalizeExtent(extent(items),mpp),{ext,w:mapW,h:mapH}=n,labelW=620,totalW=mapW+labelW,totalH=Math.max(mapH,900),tx=x=>(x-ext.xmin)/mpp,ty=y=>(ext.ymax-y)/mpp;
  const bg=await basemap(ext,mapW,mapH),rs=await roads(ext);
  const bgSvg=bg?`<image href="${bg}" x="0" y="0" width="${mapW}" height="${mapH}" preserveAspectRatio="none"/>`:`<rect x="0" y="0" width="${mapW}" height="${mapH}" fill="#eeeeea"/><text x="30" y="150" font-family="Arial" font-size="20" fill="#a00">Το DLS basemap είναι προσωρινά μη διαθέσιμο</text>`;
  const roadSvg=rs.map(f=>(f.geometry?.paths||[]).map(r=>`<path d="${r.map(([x,y],i)=>`${i?'L':'M'}${tx(x).toFixed(1)},${ty(y).toFixed(1)}`).join(' ')}" fill="none" stroke="#2869b8" stroke-width="2" stroke-opacity=".72" vector-effect="non-scaling-stroke"/>`).join('')).join('');
  const defs='<defs><pattern id="partial" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="10" height="10" fill="#8fd394" fill-opacity=".55"/><line x1="0" y1="0" x2="0" y2="10" stroke="#176a2c" stroke-width="3"/></pattern></defs>';
  const polys=items.map(({key,p,f})=>{const partial=p.kind==='owned'&&p.share&&p.share!=='100%',fill=p.kind==='owned'?(partial?'url(#partial)':'#32a852'):'#e8562a',stroke=p.kind==='owned'?'#0b6a2c':'#9b2d13';return`<a href="/property/${key}" target="_top"><path d="${path(f,tx,ty)}" fill="${fill}" fill-opacity=".58" stroke="${stroke}" stroke-width="2.2" vector-effect="non-scaling-stroke"><title>${esc(p.code)} — ${esc(p.title)}</title></path></a>`}).join('');
  const sideRows=g.keys.map((key,i)=>{const p=properties[key];if(!p)return'';const miss=missing.includes(key)?' — ΔΕΝ ΕΜΦΑΝΙΖΕΤΑΙ ΣΤΟΝ ΧΑΡΤΗ':'';return`<text x="${mapW+24}" y="${70+i*25}" font-family="Arial" font-size="12" fill="${missing.includes(key)?'#c00':'#222'}">${esc(p.code)} — ${esc(p.title)}${esc(miss)}</text>`}).join('');
  const legend=`<g transform="translate(24,28)"><rect width="390" height="78" rx="7" fill="#fff" fill-opacity=".92" stroke="#bbb"/><text x="14" y="22" font-family="Arial" font-size="15" font-weight="700">${esc(g.title)}</text><rect x="14" y="34" width="20" height="12" fill="#32a852"/><text x="40" y="44" font-family="Arial" font-size="12">Ιδιόκτητο</text><rect x="122" y="34" width="20" height="12" fill="#e8562a"/><text x="148" y="44" font-family="Arial" font-size="12">Προς αγορά</text><text x="14" y="64" font-family="Arial" font-size="11" fill="#555">EPSG:102319 · ${mpp.toFixed(3)} m/px${missing.length?` · μη διαθέσιμα: ${missing.length}`:''}</text></g>`;
  const missingAttr=esc(missing.join(','));
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}" data-missing-parcels="${missingAttr}">${defs}<rect width="100%" height="100%" fill="#f5f5f2"/>${bgSvg}${roadSvg}${polys}${legend}<rect x="${mapW}" y="0" width="${labelW}" height="${totalH}" fill="#fff"/>${sideRows}</svg>`;
  return{svg,mpp,mapW,mapH,totalW,totalH,missing};
}

const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://local');if(u.pathname==='/health')return json(res,200,{ok:true,version:'2.6',crs:CRS});if(u.pathname==='/api/properties')return json(res,200,properties);if(u.pathname==='/verify')return json(res,200,{ok:true,note:'verification is non-blocking; use map endpoints for live DLS status'});if(u.pathname==='/map.svg'){const group=u.searchParams.get('group')||'arsos',mpp=Number(u.searchParams.get('mpp')||2),r=await render(group,mpp);res.writeHead(200,{'content-type':'image/svg+xml; charset=utf-8','x-meters-per-pixel':String(r.mpp),'x-missing-parcels':r.missing.join(',')});return res.end(r.svg)}if(u.pathname==='/map.png'){const group=u.searchParams.get('group')||'arsos',mpp=Number(u.searchParams.get('mpp')||2),r=await render(group,mpp),png=await sharp(Buffer.from(r.svg)).png().toBuffer();res.writeHead(200,{'content-type':'image/png','content-length':png.length,'x-missing-parcels':r.missing.join(',')});return res.end(png)}return json(res,404,{error:'Not found'})}catch(e){console.error(e);return json(res,500,{error:e.message})}});
server.listen(PORT,()=>console.log(`DLS GIS core v2.6 listening on ${PORT}`));