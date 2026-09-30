import http from 'node:http';
import {URL} from 'node:url';
import sharp from 'sharp';
import {properties,mapGroups} from './data.js';

const PORT=Number(process.env.PORT||10000);
const MAP='https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer';
const PARCELS=MAP+'/0';
const EXPORT=MAP+'/export';
const GENERAL='https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/General_Search/MapServer';
const ROADS=GENERAL+'/13';
const CRS=102319;
const AREA={arsos:{dist:5,vil:322},pafos:{dist:6,vil:218}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v??'').trim().toUpperCase();
const json=(res,status,obj)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj,null,2));};

async function query(base,params,retries=3){
  const u=new URL(base+'/query');
  for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));
  let last;
  for(let i=1;i<=retries;i++){
    try{
      const r=await fetch(u,{signal:AbortSignal.timeout(15000),headers:{'user-agent':'dls-gis-service/3.2'}});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const j=await r.json();
      if(j.error)throw new Error(j.error.message||'DLS error');
      return j;
    }catch(e){last=e;if(i<retries)await sleep(i*500);}
  }
  throw last;
}

const parcelCache=new Map();
function exactFeature(fs,p){
  const m=(fs||[]).filter(f=>{
    const a=f.attributes||{};
    return Number(a.BLCK_CODE)===Number(p.block)&&Number(a.PARCEL_NBR)===Number(p.parcel)&&norm(a.SHEET)===norm(p.sheet)&&norm(a.PLAN_NBR)===norm(p.plan);
  });
  return m.length===1?m[0]:null;
}
async function getParcel(p){
  const ac=AREA[p.areaKey];
  if(!ac)throw new Error(`Unsupported area ${p.areaKey}`);
  if(!p.sheet||!p.plan||p.block==null||p.parcel==null)throw new Error('Missing cadastral locator');
  const ck=[p.areaKey,p.sheet,p.plan,p.block,p.parcel].join(':');
  if(parcelCache.has(ck))return parcelCache.get(ck);
  const exact=`DIST_CODE=${ac.dist} AND VIL_CODE=${ac.vil} AND BLCK_CODE=${Number(p.block)} AND PARCEL_NBR=${Number(p.parcel)} AND SHEET='${p.sheet}' AND PLAN_NBR='${p.plan}'`;
  const wheres=[exact,`DIST_CODE=${ac.dist} AND VIL_CODE=${ac.vil} AND BLCK_CODE=${Number(p.block)} AND PARCEL_NBR=${Number(p.parcel)}`,`DIST_CODE=${ac.dist} AND VIL_CODE=${ac.vil} AND PARCEL_NBR=${Number(p.parcel)}`];
  const params={f:'json',outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,OBJECTID,SHAPE.STArea()',returnGeometry:true,outSR:CRS,returnZ:false};
  let best=0;
  for(const where of wheres){
    for(let i=1;i<=3;i++){
      const j=await query(PARCELS,{...params,where});
      best=Math.max(best,j.features?.length||0);
      const f=exactFeature(j.features,p);
      if(f){parcelCache.set(ck,f);return f;}
      if(i<3)await sleep(i*400);
    }
  }
  throw new Error(`no exact parcel match; best=${best}`);
}

const rings=f=>f?.geometry?.rings||[];
const points=f=>rings(f).flat();
function bbox(f){let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;for(const[x,y]of points(f)){xmin=Math.min(xmin,x);ymin=Math.min(ymin,y);xmax=Math.max(xmax,x);ymax=Math.max(ymax,y);}return{xmin,ymin,xmax,ymax};}
function merge(bs){return bs.reduce((a,b)=>({xmin:Math.min(a.xmin,b.xmin),ymin:Math.min(a.ymin,b.ymin),xmax:Math.max(a.xmax,b.xmax),ymax:Math.max(a.ymax,b.ymax)}));}
function svgPath(f,tx,ty){return rings(f).map(r=>r.map(([x,y],i)=>`${i?'L':'M'}${tx(x).toFixed(2)},${ty(y).toFixed(2)}`).join(' ')+' Z').join(' ');}

async function load(keys){
  const items=[],missing=[];
  for(const key of keys){
    const p=properties[key];if(!p)continue;
    try{const f=await getParcel(p);items.push({key,p,f,box:bbox(f)});}
    catch(e){missing.push(key);console.warn(`PARCEL_SKIP ${key}: ${e.message}`);}
  }
  return{items,missing};
}
function extent(items,margin=120){if(!items.length)return{xmin:0,ymin:0,xmax:1600,ymax:1000};const b=merge(items.map(x=>x.box));return{xmin:b.xmin-margin,ymin:b.ymin-margin,xmax:b.xmax+margin,ymax:b.ymax+margin};}
function normalizeExtent(e,mpp){const sx=e.xmax-e.xmin,sy=e.ymax-e.ymin,w=Math.max(1,Math.ceil(sx/mpp)),h=Math.max(1,Math.ceil(sy/mpp)),dx=(w*mpp-sx)/2,dy=(h*mpp-sy)/2;return{ext:{xmin:e.xmin-dx,xmax:e.xmax+dx,ymin:e.ymin-dy,ymax:e.ymax+dy},w,h};}

async function basemap(ext,w,h){
  for(let i=1;i<=3;i++){
    try{
      const u=new URL(EXPORT);
      for(const[k,v]of Object.entries({bbox:`${ext.xmin},${ext.ymin},${ext.xmax},${ext.ymax}`,bboxSR:CRS,imageSR:CRS,size:`${w},${h}`,dpi:96,format:'png32',transparent:false,f:'image'}))u.searchParams.set(k,String(v));
      const r=await fetch(u,{signal:AbortSignal.timeout(15000),headers:{'user-agent':'dls-gis-service/3.2'}});
      if(!r.ok)throw new Error(`export ${r.status}`);
      const ct=r.headers.get('content-type')||'';
      if(!ct.includes('image'))throw new Error(`export ${ct}`);
      return`data:${ct};base64,${Buffer.from(await r.arrayBuffer()).toString('base64')}`;
    }catch(e){console.warn(`BASEMAP_RETRY ${i}: ${e.message}`);if(i<3)await sleep(i*500);}
  }
  return null;
}
async function roads(ext){
  try{
    const j=await query(ROADS,{f:'json',where:'1=1',geometry:`${ext.xmin},${ext.ymin},${ext.xmax},${ext.ymax}`,geometryType:'esriGeometryEnvelope',inSR:CRS,outSR:CRS,spatialRel:'esriSpatialRelIntersects',outFields:'*',returnGeometry:true},2);
    return j.features||[];
  }catch{return[];}
}

async function render(group,mpp=2){
  const g=mapGroups[group];
  if(!g)throw new Error('Unknown group');
  const {items,missing}=await load(g.keys);
  const n=normalizeExtent(extent(items),mpp),{ext,w:mapW,h:mapH}=n,tx=x=>(x-ext.xmin)/mpp,ty=y=>(ext.ymax-y)/mpp;
  const bg=await basemap(ext,mapW,mapH),rs=await roads(ext);
  const bgSvg=bg?`<image href="${bg}" x="0" y="0" width="${mapW}" height="${mapH}" preserveAspectRatio="none"/>`:`<rect x="0" y="0" width="${mapW}" height="${mapH}" fill="#eeeeea"/><text x="30" y="42" font-family="Arial" font-size="16" fill="#a00">Το DLS basemap είναι προσωρινά μη διαθέσιμο</text>`;
  const roadSvg=rs.map(f=>(f.geometry?.paths||[]).map(r=>`<path d="${r.map(([x,y],i)=>`${i?'L':'M'}${tx(x).toFixed(1)},${ty(y).toFixed(1)}`).join(' ')}" fill="none" stroke="#2869b8" stroke-width="2" stroke-opacity=".72" vector-effect="non-scaling-stroke"/>`).join('')).join('');
  const polys=items.map(({key,p,f})=>{
    const partial=p.kind==='owned'&&p.share&&p.share!=='100%';
    const fill=p.kind==='owned'?(partial?'#9bdba8':'#176b32'):'#e8562a';
    const stroke=p.kind==='owned'?(partial?'#3f8f55':'#0a4720'):'#9b2d13';
    return`<a href="/property/${key}" target="_top" data-property-key="${key}"><path data-property-key="${key}" d="${svgPath(f,tx,ty)}" fill="${fill}" fill-opacity="${partial?'.76':'.68'}" stroke="${stroke}" stroke-width="${partial?'3':'2.6'}" vector-effect="non-scaling-stroke"><title>${esc(p.code)} — ${esc(p.title)}</title></path></a>`;
  }).join('');
  const missingAttr=esc(missing.join(','));
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${mapW}" height="${mapH}" viewBox="0 0 ${mapW} ${mapH}" data-missing-parcels="${missingAttr}"><rect width="100%" height="100%" fill="#f5f5f2"/>${bgSvg}${roadSvg}${polys}</svg>`;
  return{svg,mpp,mapW,mapH,missing};
}

const server=http.createServer(async(req,res)=>{
  try{
    const u=new URL(req.url,'http://local');
    if(u.pathname==='/health')return json(res,200,{ok:true,version:'3.2',crs:CRS});
    if(u.pathname==='/api/properties')return json(res,200,properties);
    if(u.pathname==='/verify')return json(res,200,{ok:true,note:'verification is non-blocking; use map endpoints for live DLS status'});
    if(u.pathname==='/map.svg'){
      const group=u.searchParams.get('group')||'arsos',mpp=Number(u.searchParams.get('mpp')||2),r=await render(group,mpp);
      res.writeHead(200,{'content-type':'image/svg+xml; charset=utf-8','x-meters-per-pixel':String(r.mpp),'x-missing-parcels':r.missing.join(','),'cache-control':'no-store'});
      return res.end(r.svg);
    }
    if(u.pathname==='/map.png'){
      const group=u.searchParams.get('group')||'arsos',mpp=Number(u.searchParams.get('mpp')||2),r=await render(group,mpp),png=await sharp(Buffer.from(r.svg)).png().toBuffer();
      res.writeHead(200,{'content-type':'image/png','content-length':png.length,'x-missing-parcels':r.missing.join(',')});
      return res.end(png);
    }
    return json(res,404,{error:'Not found'});
  }catch(e){console.error(e);return json(res,500,{error:e.message});}
});
server.listen(PORT,()=>console.log(`DLS GIS core v3.2 listening on ${PORT}`));