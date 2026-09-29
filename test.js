const base=process.env.BASE_URL||'http://localhost:10000';
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function get(path){const r=await fetch(base+path); const t=await r.text(); let j; try{j=JSON.parse(t)}catch{j=t} if(!r.ok)throw new Error(`${path}: ${r.status} ${t}`); return j;}

const health=await get('/health');
assert(health.ok===true,'health failed');
const verify=await get('/verify');
const byPair=new Map(verify.results.map(x=>[`${x.a}:${x.b}`,x.distance_m]));
const dTouch=byPair.get('IDI0006:AKI0003');
const d5=byPair.get('AKI0008:AKI0010');
const d151=byPair.get('AKI0006:AKI0009');
const d194=byPair.get('IDI0016:AKI0004');
assert(dTouch<0.05,`4/274 ↔ AKI0003 must touch, got ${dTouch}`);
assert(Math.abs(d5-5.33)<1.0,`AKI0008 ↔ AKI0010 expected ~5.33m, got ${d5}`);
assert(Math.abs(d151-150.94)<2.0,`AKI0006 ↔ AKI0009 expected ~150.94m, got ${d151}`);
assert(Math.abs(d194-194.08)<3.0,`IDI0016 ↔ AKI0004 expected ~194.08m, got ${d194}`);
const cat=await get('/catalog');
assert(!cat.catalog.AKI0005,'AKI0005 must not be guessed before locator resolution');
console.log(JSON.stringify({ALL_PASS:true,distances:{touch:dTouch,d5,d151,d194}},null,2));
