import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

// Always begin each process start from the committed HEAD versions. The legacy bootstrap
// chain patches tracked source files in place, so a clean baseline is required on restart.
const tracked=['data.js','viewer.js','server.js'];
for(const file of tracked){
  try{
    const committed=execFileSync('git',['show',`HEAD:${file}`],{encoding:'utf8'});
    writeFileSync(file,committed,'utf8');
  }catch(e){
    throw new Error(`Unable to restore committed source ${file}: ${e.message}`);
  }
}

const normalize=s=>s.replace(/\r\n?/g,'\n');
for(const file of tracked){
  if(!existsSync(file)) continue;
  const source=readFileSync(file,'utf8');
  const normalized=normalize(source);
  if(normalized!==source) writeFileSync(file,normalized,'utf8');
}

let b2=normalize(readFileSync('./bootstrap2.js','utf8'));

// Replace the complete bootstrap2 cadastral implementation rather than patching fragile
// internal snippets. Limassol is queried per distinct DLS SHEET+PLAN(+VIL_CODE), while
// other area groups retain one district-scoped query. Results are paged and deduplicated.
const cadImpl=[
"const newCad=`async function cadastralParcels(group,ext){",
"  const groupProps=(mapGroups[group]?.keys||[]).map(k=>properties[k]).filter(Boolean),districts=[...new Set(groupProps.map(districtCode).filter(Boolean))];",
"  if(!districts.length)return[];",
"  const q=x=>String(x).replaceAll(\"'\",\"''\");",
"  const scopes=[...new Set(groupProps.filter(hasLocator).map(p=>{const dist=districtCode(p);if(!dist)return null;let clause=\"DIST_CODE=\"+dist+\" AND SHEET='\"+q(p.sheet)+\"' AND PLAN_NBR='\"+q(p.plan)+\"'\";if(p.vilCode!=null)clause+=\" AND VIL_CODE=\"+Number(p.vilCode);return \"(\"+clause+\")\";}).filter(Boolean))];",
"  const districtWhere=districts.length===1?'DIST_CODE='+districts[0]:'('+districts.map(d=>'DIST_CODE='+d).join(' OR ')+')';",
"  const queries=group==='limassol'&&scopes.length?scopes:[districtWhere],all=[],seen=new Set();",
"  for(const scopedWhere of queries){",
"    for(let offset=0,page=0;page<4;page++,offset+=1000){",
"      const geometry=String(ext.xmin)+','+String(ext.ymin)+','+String(ext.xmax)+','+String(ext.ymax);",
"      const j=await query(PARCELS,{f:'json',where:scopedWhere,geometry,geometryType:'esriGeometryEnvelope',inSR:CRS,outSR:CRS,spatialRel:'esriSpatialRelIntersects',outFields:'OBJECTID,PARCEL_NBR,BLCK_CODE,SHEET,PLAN_NBR',returnGeometry:true,returnZ:false,resultOffset:offset,resultRecordCount:1000,orderByFields:'OBJECTID'},2,12000);",
"      const fs=j.features||[];",
"      for(const f of fs){const id=String(f.attributes?.OBJECTID??'');if(id&&seen.has(id))continue;if(id)seen.add(id);all.push(f);}",
"      if(!j.exceededTransferLimit||fs.length<1000)break;",
"    }",
"  }",
"  return all;",
"}`;"
].join('\n');
const cadPattern=/const newCad=`async function cadastralParcels\(group,ext\)\{[\s\S]*?\n\}`;/;
if(!cadPattern.test(b2)) throw new Error('platform patch not found: cadastral implementation');
b2=b2.replace(cadPattern,()=>cadImpl);
writeFileSync('./bootstrap2.platform.js',b2,'utf8');

let b3=normalize(readFileSync('./bootstrap3.js','utf8'));
b3=b3.replace("readFileSync('./bootstrap2.js','utf8')","readFileSync('./bootstrap2.platform.js','utf8')");
if(!b3.includes("readFileSync('./bootstrap2.platform.js','utf8')")) throw new Error('platform patch not found: bootstrap3 source redirect');
writeFileSync('./bootstrap3.platform.js',b3,'utf8');

await import('./bootstrap3.platform.js?platform='+Date.now());
