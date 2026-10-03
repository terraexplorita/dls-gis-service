import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';

// The legacy runtime bootstrap chain patches tracked source files in place.
// Always begin each process start from the committed HEAD versions. Do not restore
// those files while the process is running: the loaded viewer/core runtime depends
// on the patched source/data files remaining consistent for lazy/dynamic imports.
// The next start restores HEAD again before applying a fresh deterministic patch set.
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

// Limassol is an urban, widely-spread group. Querying the entire district inside the
// full group bounding box can return thousands of cadastral parcels and stall the browser.
// For Limassol only, scope the cadastral overlay to the distinct DLS SHEET+PLAN pairs
// actually represented by locatable properties. Other accepted area maps keep the
// existing district/viewport behaviour unchanged.
const oldScope="const groupProps=(mapGroups[group]?.keys||[]).map(k=>properties[k]).filter(Boolean),districts=[...new Set(groupProps.map(districtCode).filter(Boolean))];if(!districts.length)return[];const where=districts.length===1?'DIST_CODE='+districts[0]:'('+districts.map(d=>'DIST_CODE='+d).join(' OR ')+')',all=[];";
const newScope="const groupProps=(mapGroups[group]?.keys||[]).map(k=>properties[k]).filter(Boolean),districts=[...new Set(groupProps.map(districtCode).filter(Boolean))];if(!districts.length)return[];const q=x=>String(x).replaceAll(\"'\",\"''\"),scopes=[...new Set(groupProps.filter(hasLocator).map(p=>{const dist=districtCode(p);if(!dist)return null;let clause=\"DIST_CODE=\"+dist+\" AND SHEET='\"+q(p.sheet)+\"' AND PLAN_NBR='\"+q(p.plan)+\"'\";if(p.vilCode!=null)clause+=\" AND VIL_CODE=\"+Number(p.vilCode);return \"(\"+clause+\")\";}).filter(Boolean))],where=group==='limassol'&&scopes.length?'('+scopes.join(' OR ')+')':districts.length===1?'DIST_CODE='+districts[0]:'('+districts.map(d=>'DIST_CODE='+d).join(' OR ')+')',all=[];";
if(!b2.includes(oldScope)) throw new Error('platform patch not found: Limassol cadastral scope');
b2=b2.replace(oldScope,newScope);
writeFileSync('./bootstrap2.platform.js',b2,'utf8');

let b3=normalize(readFileSync('./bootstrap3.js','utf8'));
b3=b3.replace("readFileSync('./bootstrap2.js','utf8')","readFileSync('./bootstrap2.platform.js','utf8')");
if(!b3.includes("readFileSync('./bootstrap2.platform.js','utf8')")) throw new Error('platform patch not found: bootstrap3 source redirect');
writeFileSync('./bootstrap3.platform.js',b3,'utf8');

await import('./bootstrap3.platform.js?platform='+Date.now());
