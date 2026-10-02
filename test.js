const base=process.env.BASE_URL||'http://localhost:10000';
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function text(path){const r=await fetch(base+path,{signal:AbortSignal.timeout(180000)});const t=await r.text();if(!r.ok)throw new Error(`${path}: ${r.status} ${t.slice(0,500)}`);return{r,t};}
async function json(path){const {t}=await text(path);return JSON.parse(t);}

const health=await json('/health');
assert(health.ok===true,'health failed');

const landing=await text('/map');
assert(landing.t.includes('ΟΛΕΣ ΟΙ ΠΕΡΙΟΧΕΣ'),'all-areas landing missing');
assert(landing.t.includes('Άρσος')&&landing.t.includes('Πεντάκωμο')&&landing.t.includes('Λεμεσ'),'area cards missing');

for(const group of ['arsos','limassol','pentakomo','pafos']){
  const page=await text(`/map?group=${group}&mpp=2`);
  assert(page.t.includes('id="mapobj"'),`${group}: map object missing`);
  const svg=await text(`/map.svg?group=${group}&mpp=2&smoketest=1`);
  assert(svg.t.includes('<svg'),`${group}: svg missing`);
}

const lim=await text('/map.svg?group=limassol&mpp=2&smoketest=panthea');
assert(lim.t.includes('data-property-key="IDI0018"'),'Panthea IDI0018 missing from Limassol map');
assert(!lim.r.headers.get('x-missing-parcels')?.split(',').includes('IDI0018'),'Panthea reported missing');

const p18=await text('/property/IDI0018?from=limassol');
assert(p18.t.includes('420203')&&p18.t.includes('Πανθέα'),'Panthea corrected locator/details not visible');

const pent=await text('/map?group=pentakomo&mpp=2');
assert(pent.t.includes('IDI0022')&&pent.t.includes('IDI0023'),'Pentakomo properties missing');
assert(pent.t.includes('ΑΚΙΝΗΤΑ ΠΟΥ ΕΦΑΠΤΟΝΤΑΙ'),'Pentakomo relation section missing');

const props=await text('/properties');
assert(props.t.includes('ΕΡΓ-ΙΔΙ-0018')&&props.t.includes('ΕΡΓ-ΑΚΙ-0011'),'properties catalogue incomplete');

console.log(JSON.stringify({ALL_PASS:true,groups:['arsos','limassol','pentakomo','pafos'],panthea:'54/420203 block 9 parcel 158'},null,2));
