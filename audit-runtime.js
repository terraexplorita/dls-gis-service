import {properties} from './data.js';

const PARCELS='https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer/0';
const COMMUNITIES='https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer/16';
const DISTRICT_CODE={'Λεμεσός':5,'ΛΕΜΕΣΟΣ':5,'LEMESOS':5,'Πάφος':6,'ΠΑΦΟΣ':6,'PAFOS':6};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const qv=x=>String(x).replaceAll("'","''");
async function query(base,params,retries=3){
  const u=new URL(base+'/query');for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));
  let last;for(let i=1;i<=retries;i++){try{const r=await fetch(u,{signal:AbortSignal.timeout(12000),headers:{'user-agent':'dls-gis-audit/1.0'}});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();if(j.error)throw new Error(j.error.message||'DLS error');return j;}catch(e){last=e;if(i<retries)await sleep(300*i);}}
  throw last;
}
function center(f){const ring=f?.geometry?.rings?.[0]||[];if(!ring.length)return null;let x=0,y=0;for(const p of ring){x+=Number(p[0]);y+=Number(p[1]);}return{x:x/ring.length,y:y/ring.length};}
function hasLocator(p){return p?.sheet&&p?.plan&&p?.block!=null&&p?.parcel!=null&&DISTRICT_CODE[p?.district];}
async function resolveOne(key,p){
  const dist=DISTRICT_CODE[p.district];
  const where=`DIST_CODE=${dist} AND SHEET='${qv(p.sheet)}' AND PLAN_NBR='${qv(p.plan)}' AND BLCK_CODE=${Number(p.block)} AND PARCEL_NBR=${Number(p.parcel)}`;
  const j=await query(PARCELS,{f:'json',where,outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,OBJECTID,SHAPE.STArea()',returnGeometry:true,outSR:4326,returnZ:false,resultRecordCount:20});
  const fs=j.features||[];
  return{key,code:p.code,title:p.title,locator:{district:dist,sheet:p.sheet,plan:p.plan,block:p.block,parcel:p.parcel},matches:fs.length,features:fs.map(f=>({a:f.attributes,center:center(f)}))};
}
async function communityNames(vils){
  if(!vils.length)return{};const where=vils.map(v=>`VIL_CODE=${Number(v)}`).join(' OR ');
  const j=await query(COMMUNITIES,{f:'json',where,outFields:'DIST_CODE,VIL_CODE,VIL_NM_E,VIL_NM_G',returnGeometry:false,resultRecordCount:200});
  return Object.fromEntries((j.features||[]).map(f=>[String(f.attributes.VIL_CODE),f.attributes]));
}
async function alternatePanthea(){
  const j=await query(PARCELS,{f:'json',where:"DIST_CODE=5 AND SHEET='54' AND PLAN_NBR='420203' AND PARCEL_NBR=158",outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,OBJECTID,SHAPE.STArea()',returnGeometry:true,outSR:4326,returnZ:false,resultRecordCount:50});
  return (j.features||[]).map(f=>({a:f.attributes,center:center(f)}));
}
try{
  const details=[];
  for(const [key,p] of Object.entries(properties)){
    if(!hasLocator(p))continue;
    try{details.push(await resolveOne(key,p));}catch(e){details.push({key,code:p.code,title:p.title,error:e.message});}
  }
  const vils=[...new Set(details.flatMap(d=>(d.features||[]).map(f=>f.a?.VIL_CODE)).filter(v=>v!=null))];
  const communities=await communityNames(vils);
  let pantheaAlt=[];try{pantheaAlt=await alternatePanthea();}catch(e){pantheaAlt=[{error:e.message}];}
  const zero=details.filter(d=>d.matches===0||d.error).map(d=>d.key),ambiguous=details.filter(d=>Number(d.matches)>1).map(d=>d.key);
  const duplicates={};for(const d of details){if(d.matches!==1)continue;const oid=String(d.features[0].a?.OBJECTID);(duplicates[oid]??=[]).push(d.key);}for(const k of Object.keys(duplicates))if(duplicates[k].length<2)delete duplicates[k];
  console.log('GIS_AUDIT_SUMMARY '+JSON.stringify({checked:details.length,zero,ambiguous,duplicateGeometry:duplicates,communities,pantheaCurrent:details.find(d=>d.key==='IDI0018'),pantheaOriginalLocator:pantheaAlt},null,0));
  for(const d of details)console.log('GIS_AUDIT_ITEM '+JSON.stringify(d));
}catch(e){console.error('GIS_AUDIT_FATAL '+(e?.stack||e));}
