import {properties} from './data.js';

const PARCELS='https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer/0';
const DISTRICT_CODE={'Λεμεσός':5,'ΛΕΜΕΣΟΣ':5,'LEMESOS':5,'Πάφος':6,'ΠΑΦΟΣ':6,'PAFOS':6};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const esc=x=>String(x).replaceAll("'","''");
async function query(where){const u=new URL(PARCELS+'/query');for(const[k,v]of Object.entries({f:'json',where,outFields:'OBJECTID,DIST_CODE,VIL_CODE,SHEET,PLAN_NBR,BLCK_CODE,PARCEL_NBR',returnGeometry:false,resultRecordCount:20}))u.searchParams.set(k,String(v));let last;for(let i=1;i<=3;i++){try{const r=await fetch(u,{signal:AbortSignal.timeout(12000),headers:{'user-agent':'dls-gis-preflight/1.0'}});if(!r.ok)throw new Error('HTTP '+r.status);const j=await r.json();if(j.error)throw new Error(j.error.message||'DLS error');return j.features||[];}catch(e){last=e;if(i<3)await sleep(300*i);}}throw last;}
const failures=[],verified=[],notLocatable=[];
for(const [key,p] of Object.entries(properties)){
  if(!p.areaKey)failures.push({key,reason:'missing areaKey'});
  if(!(p.sheet&&p.plan&&p.block!=null&&p.parcel!=null)){notLocatable.push(key);continue;}
  const parts=[];const dist=DISTRICT_CODE[p.district];if(dist)parts.push('DIST_CODE='+dist);parts.push(`SHEET='${esc(p.sheet)}'`,`PLAN_NBR='${esc(p.plan)}'`,`BLCK_CODE=${Number(p.block)}`,`PARCEL_NBR=${Number(p.parcel)}`);if(p.vilCode!=null)parts.push(`VIL_CODE=${Number(p.vilCode)}`);
  try{const fs=await query(parts.join(' AND '));if(fs.length!==1)failures.push({key,code:p.code,reason:fs.length===0?'zero DLS matches':'ambiguous DLS locator',matches:fs.map(f=>f.attributes)});else verified.push({key,code:p.code,objectId:fs[0].attributes.OBJECTID,vilCode:fs[0].attributes.VIL_CODE});}catch(e){failures.push({key,code:p.code,reason:'DLS query failed: '+e.message});}
}
const duplicateObjectIds={};for(const x of verified)(duplicateObjectIds[x.objectId]??=[]).push(x.key);for(const k of Object.keys(duplicateObjectIds))if(duplicateObjectIds[k].length<2)delete duplicateObjectIds[k];
const result={ok:failures.length===0,checked:verified.length,notLocatable,failures,duplicateObjectIds};
console.log('REGISTRY_PREFLIGHT '+JSON.stringify(result,null,2));
if(failures.length)process.exitCode=1;
