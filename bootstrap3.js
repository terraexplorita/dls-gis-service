import {readFileSync,writeFileSync} from 'node:fs';

let s=readFileSync('./bootstrap2.js','utf8');
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
