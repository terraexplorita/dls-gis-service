const base='http://127.0.0.1:'+Number(process.env.PORT||10000);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function req(path){const r=await fetch(base+path,{signal:AbortSignal.timeout(180000)}),t=await r.text();if(!r.ok)throw new Error(`${path}: ${r.status}`);return{r,t};}
try{
  for(let i=0;i<40;i++){try{const x=await req('/health');if(JSON.parse(x.t).ok)break;}catch{}await sleep(250);}
  const landing=await req('/map');assert(landing.t.includes('ΟΛΕΣ ΟΙ ΠΕΡΙΟΧΕΣ'),'landing missing');
  for(const g of ['arsos','limassol','pentakomo','pafos']){const p=await req(`/map?group=${g}&mpp=2`);assert(p.t.includes('id="mapobj"'),`${g}: map object missing`);const s=await req(`/map.svg?group=${g}&mpp=2&runtimeSmoke=1`);assert(s.t.includes('<svg'),`${g}: svg missing`);}
  const lim=await req('/map.svg?group=limassol&mpp=2&runtimeSmoke=panthea');assert(lim.t.includes('data-property-key="IDI0018"'),'Panthea absent');assert(!(lim.r.headers.get('x-missing-parcels')||'').split(',').includes('IDI0018'),'Panthea marked missing');
  const d=await req('/property/IDI0018?from=limassol');assert(d.t.includes('420203')&&d.t.includes('Πανθέα'),'Panthea details stale');
  const pent=await req('/map?group=pentakomo&mpp=2');assert(pent.t.includes('ΑΚΙΝΗΤΑ ΠΟΥ ΕΦΑΠΤΟΝΤΑΙ')&&pent.t.includes('IDI0022')&&pent.t.includes('IDI0023'),'Pentakomo relation UI missing');
  console.log('RUNTIME_SMOKE_PASS '+JSON.stringify({groups:4,panthea:true,pentakomoRelation:true}));
}catch(e){console.error('RUNTIME_SMOKE_FAIL '+(e?.stack||e));}
