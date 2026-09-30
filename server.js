import http from 'node:http';
import {URL} from 'node:url';
import sharp from 'sharp';
import {properties,mapGroups} from './data.js';

const PORT=Number(process.env.PORT||10000);
const MAP='https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer';
const PARCELS=MAP+'/0';
const EXPORT=MAP+'/export';
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
      const r=await fetch(u,{signal:AbortSignal.timeout(12000),headers:{'user-agent':'dls-gis-service/3.5'}});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      const j=await r.json();
      if(j.error)throw new Error(j.error.message||'DLS error');
      return j;
    }catch(e){last=e;if(i<retries)await sleep(i*350);}
  }
  throw last;
}

const parcelCache=new Map();
function exactFeature(fs,p){
  const m=(fs||[]).filter(f=>{const a=f.attributes||{};return Number(a.BLCK_CODE)===Number(p.block)&&Number(a.PARCEL_NBR)===Number(p.parcel)&&norm(a.SHEET)===norm(p.sheet)&&norm(a.PLAN_NBR)===norm(p.plan);});
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
    for(let i=1;i<=2;i++){
      const j=await query(PARCELS,{...params,where},2);
      best=Math.max(best,j.features?.length||0);
      const f=exactFeature(j.features,p);
      if(f){parcelCache.set(ck,f);return f;}
      if(i<2)await sleep(250);
    }
  }
  throw new Error(`no exact parcel match; best=${best}`);
}

const rings=f=>f?.geometry?.rings||[];
const points=f=>rings(f).flat();
function bbox(f){let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;for(const[x,y]of points(f)){xmin=Math.min(xmin,x);ymin=Math.min(ymin,y);xmax=Math.max(xmax,x);ymax=Math.max(ymax,y);}return{xmin,ymin,xmax,ymax};}
function merge(bs){return bs.reduce((a,b)=>({xmin:Math.min(a.xmin,b.xmin),ymin:Math.min(a.ymin,b.ymin),xmax:Math.max(a.xmax,b.xmax),ymax:Math.max(a.ymax,b.ymax)}));}
function svgPath(f,tx,ty){return rings(f).map(r=>r.map(([x,y],i)=>`${i?'L':'M'}${tx(x).toFixed(2)},${ty(y).toFixed(2)}`).join(' ')+' Z').join(' ');}
function center(f){const ps=points(f);if(!ps.length)return[0,0];let sx=0,sy=0;for(const[x,y]of ps){sx+=x;sy+=y;}return[sx/ps.length,sy/ps.length];}

async function load(keys){
  const settled=await Promise.all(keys.map(async key=>{const p=properties[key];if(!p)return null;try{return{ok:true,key,p,f:await getParcel(p)};}catch(e){console.warn(`PARCEL_SKIP ${key}: ${e.message}`);return{ok:false,key,p};}}));
  const items=[],missing=[];
  for(const r of settled){if(!r)continue;if(r.ok)items.push({key:r.key,p:r.p,f:r.f,box:bbox(r.f)});else missing.push(r.key);}
  return{items,missing};
}
function extent(items,margin=120){if(!items.length)return{xmin:0,ymin:0,xmax:1600,ymax:1000};const b=merge(items.map(x=>x.box));return{xmin:b.xmin-margin,ymin:b.ymin-margin,xmax:b.xmax+margin,ymax:b.ymax+margin};}
function normalizeExtent(e,mpp){const sx=e.xmax-e.xmin,sy=e.ymax-e.ymin,w=Math.max(1,Math.ceil(sx/mpp)),h=Math.max(1,Math.ceil(sy/mpp)),dx=(w*mpp-sx)/2,dy=(h*mpp-sy)/2;return{ext:{xmin:e.xmin-dx,xmax:e.xmax+dx,ymin:e.ymin-dy,ymax:e.ymax+dy},w,h};}

function basemapUrl(ext,w,h){
  const maxDim=Math.max(w,h),ratio=Math.max(1,Math.min(1.5,3072/Math.max(1,maxDim))),hiW=Math.max(1,Math.round(w*ratio)),hiH=Math.max(1,Math.round(h*ratio));
  const u=new URL(EXPORT);
  for(const[k,v]of Object.entries({bbox:`${ext.xmin},${ext.ymin},${ext.xmax},${ext.ymax}`,bboxSR:CRS,imageSR:CRS,size:`${hiW},${hiH}`,dpi:120,format:'png32',transparent:false,f:'image'}))u.searchParams.set(k,String(v));
  return{url:u.toString(),ratio};
}

async function cadastralParcels(group,ext){
  const ac=AREA[group];if(!ac)return[];
  const all=[];
  for(let offset=0,page=0;page<5;page++,offset+=1000){
    const j=await query(PARCELS,{f:'json',where:`DIST_CODE=${ac.dist} AND VIL_CODE=${ac.vil}`,geometry:`${ext.xmin},${ext.ymin},${ext.xmax},${ext.ymax}`,geometryType:'esriGeometryEnvelope',inSR:CRS,outSR:CRS,spatialRel:'esriSpatialRelIntersects',outFields:'OBJECTID,PARCEL_NBR,BLCK_CODE,SHEET,PLAN_NBR',returnGeometry:true,returnZ:false,resultOffset:offset,resultRecordCount:1000,orderByFields:'OBJECTID'},2);
    const fs=j.features||[];all.push(...fs);if(!j.exceededTransferLimit||fs.length<1000)break;
  }
  return all;
}
function parcelToken(a){return [a.SHEET,a.PLAN_NBR,a.BLCK_CODE,a.PARCEL_NBR].map(norm).join('|');}

async function renderBase(group,mpp=2){
  const g=mapGroups[group];if(!g)throw new Error('Unknown group');
  const {items,missing}=await load(g.keys);
  const n=normalizeExtent(extent(items),mpp),{ext,w:mapW,h:mapH}=n,tx=x=>(x-ext.xmin)/mpp,ty=y=>(ext.ymax-y)/mpp;
  const bg=basemapUrl(ext,mapW,mapH);
  const bgSvg=`<rect x="0" y="0" width="${mapW}" height="${mapH}" fill="#eeeeea"/><image href="${esc(bg.url)}" x="0" y="0" width="${mapW}" height="${mapH}" preserveAspectRatio="none"/>`;
  const polys=items.map(({key,p,f})=>{const partial=p.kind==='owned'&&p.share&&p.share!=='100%';const fill=p.kind==='owned'?(partial?'#9bdba8':'#176b32'):'#e8562a';const stroke=p.kind==='owned'?(partial?'#3f8f55':'#0a4720'):'#9b2d13';const token=[p.sheet,p.plan,p.block,p.parcel].map(norm).join('|');return`<a href="/property/${key}" target="_top" data-property-key="${key}"><path data-property-key="${key}" data-parcel-number="${esc(p.parcel)}" data-parcel-token="${esc(token)}" d="${svgPath(f,tx,ty)}" fill="${fill}" fill-opacity="${partial?'.76':'.68'}" stroke="${stroke}" stroke-width="${partial?'3':'2.6'}" vector-effect="non-scaling-stroke"><title>${esc(p.code)} — ${esc(p.title)} · Τεμάχιο ${esc(p.parcel)}</title></path></a>`;}).join('');
  const overlayUrl=`/cadastre.svg?group=${encodeURIComponent(group)}&mpp=${encodeURIComponent(mpp)}&xmin=${encodeURIComponent(ext.xmin)}&ymin=${encodeURIComponent(ext.ymin)}&xmax=${encodeURIComponent(ext.xmax)}&ymax=${encodeURIComponent(ext.ymax)}&w=${mapW}&h=${mapH}`;
  const loader=`<script><![CDATA[(function(){var root=document.documentElement;fetch(${JSON.stringify(overlayUrl)}).then(function(r){if(!r.ok)throw new Error('overlay '+r.status);return r.text();}).then(function(t){var d=new DOMParser().parseFromString(t,'image/svg+xml');var g=d.documentElement.querySelector('#cadastre-overlay');if(g){root.insertBefore(document.importNode(g,true),root.querySelector('#owned-overlay'));root.setAttribute('data-cadastral-loaded','1');}}).catch(function(e){console.warn('cadastral overlay skipped',e);});})();]]></script>`;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${mapW}" height="${mapH}" viewBox="0 0 ${mapW} ${mapH}" data-missing-parcels="${esc(missing.join(','))}" data-basemap-pixel-ratio="${bg.ratio.toFixed(2)}"><style>.cadparcel:hover{stroke:#000;stroke-width:2.2}.parcel-number{opacity:.34}.cadparcel-group:hover .parcel-number{opacity:1;font-size:10px;fill:#000}</style>${bgSvg}<g id="owned-overlay">${polys}</g>${loader}</svg>`;
  return{svg,mpp,mapW,mapH,missing,pixelRatio:bg.ratio};
}

async function renderCadastre(group,mpp,ext,mapW,mapH){
  const tx=x=>(x-ext.xmin)/mpp,ty=y=>(ext.ymax-y)/mpp,cadastral=await cadastralParcels(group,ext);
  const body=cadastral.map(f=>{const a=f.attributes||{},n=a.PARCEL_NBR??'',token=parcelToken(a),[cx,cy]=center(f);return `<g class="cadparcel-group" data-parcel-token="${esc(token)}"><path class="cadparcel" data-cadastral-parcel="1" data-parcel-number="${esc(n)}" data-parcel-token="${esc(token)}" d="${svgPath(f,tx,ty)}" fill="none" stroke="#343434" stroke-width="1.05" stroke-opacity=".92" vector-effect="non-scaling-stroke" pointer-events="stroke"><title>Τεμάχιο ${esc(n)}</title></path><text class="parcel-number" x="${tx(cx).toFixed(1)}" y="${ty(cy).toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="7" font-weight="700" fill="#222" stroke="#fff" stroke-width="2.4" paint-order="stroke" pointer-events="none">${esc(n)}</text></g>`;}).join('');
  return{svg:`<svg xmlns="http://www.w3.org/2000/svg" width="${mapW}" height="${mapH}" viewBox="0 0 ${mapW} ${mapH}"><g id="cadastre-overlay">${body}</g></svg>`,count:cadastral.length};
}

const server=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://local');
  if(u.pathname==='/health')return json(res,200,{ok:true,version:'3.5',crs:CRS});
  if(u.pathname==='/api/properties')return json(res,200,properties);
  if(u.pathname==='/verify')return json(res,200,{ok:true,note:'map, basemap and cadastral overlay load independently'});
  if(u.pathname==='/map.svg'){
    const group=u.searchParams.get('group')||'arsos',mpp=Number(u.searchParams.get('mpp')||2),r=await renderBase(group,mpp);
    res.writeHead(200,{'content-type':'image/svg+xml; charset=utf-8','x-meters-per-pixel':String(r.mpp),'x-missing-parcels':r.missing.join(','),'x-basemap-pixel-ratio':String(r.pixelRatio),'cache-control':'no-store'});return res.end(r.svg);
  }
  if(u.pathname==='/cadastre.svg'){
    const group=u.searchParams.get('group')||'arsos',mpp=Number(u.searchParams.get('mpp')||2),mapW=Number(u.searchParams.get('w')||1000),mapH=Number(u.searchParams.get('h')||1000),ext={xmin:Number(u.searchParams.get('xmin')),ymin:Number(u.searchParams.get('ymin')),xmax:Number(u.searchParams.get('xmax')),ymax:Number(u.searchParams.get('ymax'))};
    if(!Object.values(ext).every(Number.isFinite)||!Number.isFinite(mpp))return json(res,400,{error:'Invalid extent'});
    const r=await renderCadastre(group,mpp,ext,mapW,mapH);res.writeHead(200,{'content-type':'image/svg+xml; charset=utf-8','x-cadastral-count':String(r.count),'cache-control':'public, max-age=600'});return res.end(r.svg);
  }
  if(u.pathname==='/map.png'){
    const group=u.searchParams.get('group')||'arsos',mpp=Number(u.searchParams.get('mpp')||2),r=await renderBase(group,mpp),clean=r.svg.replace(/<script[\s\S]*?<\/script>/,'').replace(/<image[^>]*>/,'');const png=await sharp(Buffer.from(clean)).png().toBuffer();res.writeHead(200,{'content-type':'image/png','content-length':png.length,'x-missing-parcels':r.missing.join(',')});return res.end(png);
  }
  return json(res,404,{error:'Not found'});
}catch(e){console.error(e);return json(res,500,{error:e.message});}});
server.listen(PORT,()=>console.log(`DLS GIS core v3.5 listening on ${PORT}`));