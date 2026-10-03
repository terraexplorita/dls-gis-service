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

// Limassol's registered properties form a tall, narrow geographic extent. Pad only its
// display extent to a desktop-friendly ratio while preserving geography and scale.
let core=normalize(readFileSync('./server.js','utf8'));
const renderMarker='\nasync function renderBase(group,mpp=2){';
if(!core.includes(renderMarker)) throw new Error('platform patch not found: renderBase marker');
const aspectHelper=`
function padExtentToAspect(e,target=1.45){
  const w=Math.max(1,e.xmax-e.xmin),h=Math.max(1,e.ymax-e.ymin),ratio=w/h;
  if(ratio<target){const want=h*target,extra=(want-w)/2;return{xmin:e.xmin-extra,xmax:e.xmax+extra,ymin:e.ymin,ymax:e.ymax};}
  if(ratio>target){const want=w/target,extra=(want-h)/2;return{xmin:e.xmin,xmax:e.xmax,ymin:e.ymin-extra,ymax:e.ymax+extra};}
  return e;
}
`;
core=core.replace(renderMarker,'\n'+aspectHelper+renderMarker);
const oldExtent="  const n=normalizeExtent(extent(items),mpp),{ext,w:mapW,h:mapH}=n,tx=x=>(x-ext.xmin)/mpp,ty=y=>(ext.ymax-y)/mpp,bg=basemapUrls(ext,mapW,mapH);";
const newExtent="  const rawExtent=extent(items),displayExtent=group==='limassol'?padExtentToAspect(rawExtent,1.45):rawExtent,n=normalizeExtent(displayExtent,mpp),{ext,w:mapW,h:mapH}=n,tx=x=>(x-ext.xmin)/mpp,ty=y=>(ext.ymax-y)/mpp,bg=basemapUrls(ext,mapW,mapH);";
if(!core.includes(oldExtent)) throw new Error('platform patch not found: renderBase extent');
core=core.replace(oldExtent,newExtent);

// Parcel numbers are a vector overlay. Keep them readable at every zoom instead of the
// old faint 34% opacity, especially after the high-resolution raster refresh.
const oldLabelCss='.parcel-number{opacity:.34}.cadparcel-group:hover .parcel-number{opacity:1;font-size:10px;fill:#000}';
const newLabelCss='.parcel-number{opacity:.94;font-size:9px;fill:#111}.cadparcel-group:hover .parcel-number{opacity:1;font-size:11px;fill:#000}';
if(!core.includes(oldLabelCss)) throw new Error('platform patch not found: parcel label CSS');
core=core.replace(oldLabelCss,newLabelCss);
writeFileSync('./server.js',core,'utf8');

let b2=normalize(readFileSync('./bootstrap2.js','utf8'));

// Replace the complete bootstrap2 cadastral implementation rather than patching fragile
// internal snippets. For Limassol, do NOT download whole cadastral plans. Use the already
// resolved exact property geometries to create small local windows around each unique
// registered parent parcel, query only those neighbourhoods, and deduplicate OBJECTIDs.
// This preserves detailed parcel context where it matters while making initial load much
// lighter. Other area maps keep their existing district/viewport behaviour unchanged.
const cadImpl=[
"const newCad=`async function cadastralParcels(group,ext){",
"  const groupKeys=mapGroups[group]?.keys||[],groupProps=groupKeys.map(k=>properties[k]).filter(Boolean),districts=[...new Set(groupProps.map(districtCode).filter(Boolean))];",
"  if(!districts.length)return[];",
"  const q=x=>String(x).replaceAll(\"'\",\"''\"),districtWhere=districts.length===1?'DIST_CODE='+districts[0]:'('+districts.map(d=>'DIST_CODE='+d).join(' OR ')+')';",
"  let windows=[];",
"  if(group==='limassol'){",
"    try{",
"      const batch=await groupPropertyFeatures(group,groupKeys),used=new Set();",
"      for(const p of groupProps.filter(hasLocator)){",
"        const f=safeFeature(batch.features,p);if(!f)continue;",
"        const id=String(f.attributes?.OBJECTID??f.attributes?.SBPI_ID_NO??'');if(id&&used.has(id))continue;if(id)used.add(id);",
"        const b=bbox(f),pad=220,dist=districtCode(p);if(!dist)continue;",
"        let where=\"DIST_CODE=\"+dist+\" AND SHEET='\"+q(p.sheet)+\"' AND PLAN_NBR='\"+q(p.plan)+\"'\";if(p.vilCode!=null)where+=\" AND VIL_CODE=\"+Number(p.vilCode);",
"        windows.push({where,geometry:[b.xmin-pad,b.ymin-pad,b.xmax+pad,b.ymax+pad].join(',')});",
"      }",
"    }catch(e){console.warn('LIMASSOL_LOCAL_CADASTRE_FALLBACK '+e.message);}",
"  }",
"  if(!windows.length)windows=[{where:districtWhere,geometry:[ext.xmin,ext.ymin,ext.xmax,ext.ymax].join(',')}];",
"  const all=[],seen=new Set();",
"  for(const win of windows){",
"    for(let offset=0,page=0;page<2;page++,offset+=1000){",
"      const j=await query(PARCELS,{f:'json',where:win.where,geometry:win.geometry,geometryType:'esriGeometryEnvelope',inSR:CRS,outSR:CRS,spatialRel:'esriSpatialRelIntersects',outFields:'OBJECTID,PARCEL_NBR,BLCK_CODE,SHEET,PLAN_NBR',returnGeometry:true,returnZ:false,resultOffset:offset,resultRecordCount:1000,orderByFields:'OBJECTID'},2,10000);",
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
