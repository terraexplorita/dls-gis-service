import {readFileSync,writeFileSync} from 'node:fs';

let s=readFileSync('./bootstrap2.js','utf8');

// Preserve stable human labels for current multi-area groups and attach verified locality codes.
s=s.replace("if(mapGroups.arsos){mapGroups.arsos.isAreaGroup=true;mapGroups.arsos.district='Λεμεσός';mapGroups.arsos.community='Άρσος';}","if(mapGroups.arsos){mapGroups.arsos.isAreaGroup=true;mapGroups.arsos.district='Λεμεσός';mapGroups.arsos.community='Άρσος';}\nfor(const p of Object.values(properties)){if(p.areaKey==='arsos')p.vilCode=322;else if(p.areaKey==='pafos')p.vilCode=218;else if(p.areaKey==='pentakomo')p.vilCode=126;}\n");
s=s.replace("for(const [key,g] of Object.entries(mapGroups))if(g?.isAreaGroup)g.title=(g.community||key)+' — Ιδιόκτητα & προς αγορά';","if(mapGroups.limassol){mapGroups.limassol.district='Λεμεσός';mapGroups.limassol.community='Λεμεσός';}\nif(mapGroups.pentakomo){mapGroups.pentakomo.district='Λεμεσός';mapGroups.pentakomo.community='Πεντάκωμο';}\nfor(const [key,g] of Object.entries(mapGroups))if(g?.isAreaGroup)g.title=(g.community||key)+' — Ιδιόκτητα & προς αγορά';");

// Exact-property query: use district when known and verified VIL_CODE when present; unknown districts may still resolve if globally unique.
s=s.replace("for(const p of loc){const dist=districtCode(p);if(!dist)continue;const q=x=>String(x).replaceAll(\"'\",\"''\");clauses.push(\"(DIST_CODE=\"+dist+\" AND SHEET='\"+q(p.sheet)+\"' AND PLAN_NBR='\"+q(p.plan)+\"' AND BLCK_CODE=\"+Number(p.block)+\" AND PARCEL_NBR=\"+Number(p.parcel)+\")\");}","for(const p of loc){const dist=districtCode(p);const q=x=>String(x).replaceAll(\"'\",\"''\");let clause=\"SHEET='\"+q(p.sheet)+\"' AND PLAN_NBR='\"+q(p.plan)+\"' AND BLCK_CODE=\"+Number(p.block)+\" AND PARCEL_NBR=\"+Number(p.parcel);if(dist)clause=\"DIST_CODE=\"+dist+\" AND \"+clause;if(p.vilCode!=null)clause+=(\" AND VIL_CODE=\"+Number(p.vilCode));clauses.push(\"(\"+clause+\")\");}");

// Never choose the first feature when an exact cadastral tuple is ambiguous; no loose fallback.
s=s.replace("writeFileSync('./server.js',c,'utf8');","c=replaceOnce(c,\"function safeFeature(fs,p){const exact=exactFeature(fs,p);if(exact)return exact;const loose=(fs||[]).filter(f=>{const a=f.attributes||{};return Number(a.BLCK_CODE)===Number(p.block)&&Number(a.PARCEL_NBR)===Number(p.parcel);});if(loose.length===1){console.warn(`PARCEL_LOOSE_MATCH ${p.code||p.title||p.parcel}`);return loose[0];}return null;}\",\"function safeFeature(fs,p){let exact=(fs||[]).filter(f=>{const a=f.attributes||{};return Number(a.BLCK_CODE)===Number(p.block)&&Number(a.PARCEL_NBR)===Number(p.parcel)&&norm(a.SHEET)===norm(p.sheet)&&norm(a.PLAN_NBR)===norm(p.plan);});if(p.vilCode!=null)exact=exact.filter(f=>Number(f.attributes?.VIL_CODE)===Number(p.vilCode));if(exact.length===1)return exact[0];if(exact.length>1)console.warn(`PARCEL_AMBIGUOUS ${p.code||p.title||p.parcel}: ${exact.length} exact matches`);return null;}\",'strict unique parcel matching');\nwriteFileSync('./server.js',c,'utf8');");

// Keep DLS URLs small by batching exact-property clauses.
const from=`  const where=clauses.join(' OR ');
  const j=await query(PARCELS,{f:'json',where,outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,OBJECTID,SHAPE.STArea()',returnGeometry:true,outSR:CRS,returnZ:false,resultRecordCount:1000},2,10000);
  return j.features||[];`;
const to=`  const all=[];
  for(let i=0;i<clauses.length;i+=4){
    const where=clauses.slice(i,i+4).join(' OR ');
    const j=await query(PARCELS,{f:'json',where,outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,OBJECTID,SHAPE.STArea()',returnGeometry:true,outSR:CRS,returnZ:false,resultRecordCount:1000},2,10000);
    all.push(...(j.features||[]));
  }
  return all;`;
if(!s.includes(from))throw new Error('bootstrap3 patch not found: exact DLS batch query');
s=s.replace(from,to);
writeFileSync('./bootstrap2.runtime.js',s,'utf8');
await import('./bootstrap2.runtime.js?chunked='+Date.now());
import('./audit-runtime.js?audit='+Date.now()).catch(e=>console.error('GIS_AUDIT_IMPORT_FAIL '+(e?.stack||e)));
import('./smoke-runtime.js?smoke='+Date.now()).catch(e=>console.error('RUNTIME_SMOKE_IMPORT_FAIL '+(e?.stack||e)));
