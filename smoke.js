const base='http://127.0.0.1:'+String(process.env.PORT||10000);
const assert=(c,m)=>{if(!c)throw new Error(m)};
async function fetchText(path){const r=await fetch(base+path,{signal:AbortSignal.timeout(120000)});const t=await r.text();if(!r.ok)throw new Error(`${path} -> HTTP ${r.status}: ${t.slice(0,1000)}`);return{r,t};}
async function fetchBytes(path){const r=await fetch(base+path,{signal:AbortSignal.timeout(120000)});const b=Buffer.from(await r.arrayBuffer());if(!r.ok)throw new Error(`${path} -> HTTP ${r.status}`);return{r,b};}

const verifyRes=await fetchText('/verify');
const verify=JSON.parse(verifyRes.t);
assert(verify.ok===true,'/verify did not return ok');
const known=new Map(verify.results.map(x=>[`${x.a}:${x.b}`,x]));
for(const [pair,expected,tol] of [
 ['IDI0006:AKI0003',0,0.10],
 ['AKI0008:AKI0010',5.33,1],
 ['AKI0006:AKI0009',150.94,2],
 ['IDI0016:AKI0004',194.08,3],
 ['IDI0008:IDI0010',0,0.10]
]){
 const x=known.get(pair);assert(x,`missing verify pair ${pair}`);assert(Math.abs(x.distance_m-expected)<=tol,`${pair}: ${x.distance_m}m expected ${expected}±${tol}`);
}
const touch=known.get('IDI0006:AKI0003');
assert(touch.centroid_relation.b_is_west_of_a===true,`REMU 42711 is not west of 4/274 according to rendered DLS geometry; delta_x=${touch.centroid_relation.delta_x_m}`);

async function checkSvg(path,name,minChars){
 const {r,t}=await fetchText(path);
 const mpp=Number(r.headers.get('x-meters-per-pixel'));
 assert(Number.isFinite(mpp)&&mpp>0,`${name}: invalid x-meters-per-pixel`);
 assert(Math.abs(mpp-2)<0.02,`${name}: requested 2 m/px but header=${mpp}`);
 assert(t.startsWith('<svg'),`${name}: not SVG`);
 assert(t.includes('data:image/png'),`${name}: official DLS basemap image not embedded`);
 assert(t.includes('EPSG:102319'),`${name}: CRS label missing`);
 assert(t.length>minChars,`${name}: SVG suspiciously small (${t.length} chars; expected >${minChars})`);
 return{mpp,bytes:t.length};
}
const arsos=await checkSvg('/map.svg?group=arsos&mpp=2','arsos',50000);
const pafos=await checkSvg('/map.svg?group=pafos&mpp=2','pafos',10000);
const master=await checkSvg('/master.svg?mpp=2','master',60000);

const scaleChecks={
 gap_5_328m_px:known.get('AKI0008:AKI0010').distance_m/arsos.mpp,
 gap_150_942m_px:known.get('AKI0006:AKI0009').distance_m/arsos.mpp,
 gap_194_076m_px:known.get('IDI0016:AKI0004').distance_m/arsos.mpp
};
assert(Math.abs(scaleChecks.gap_5_328m_px-2.664106)<0.02,'5.33m scale conversion failed');
assert(Math.abs(scaleChecks.gap_150_942m_px-75.470892)<0.05,'150.94m scale conversion failed');
assert(Math.abs(scaleChecks.gap_194_076m_px-97.038054)<0.05,'194.08m scale conversion failed');

// Property web app smoke checks.
const catalogue=await fetchText('/properties');
assert((catalogue.r.headers.get('content-type')||'').includes('text/html'),'catalogue is not HTML');
assert(catalogue.t.includes('ΟΛΑ ΤΑ ΑΚΙΝΗΤΑ'),'catalogue heading missing');
assert(catalogue.t.includes('ΕΡΓ-ΙΔΙ-0006'),'owned property missing from catalogue');
assert(catalogue.t.includes('ΕΡΓ-ΑΚΙ-0008'),'candidate property missing from catalogue');

const detail=await fetchText('/property/ERG-AKI-0008');
assert(detail.t.includes('ΕΡΓ-ΑΚΙ-0008'),'property detail code missing');
assert(detail.t.includes('10.040'),'auction minimum price missing');
assert(detail.t.includes('Αρχική πηγή'),'source link section missing');

const interactive=await fetchText('/map/arsos?mpp=2');
assert(interactive.t.includes('ΙΔΙΟΚΤΗΤΑ ΑΚΙΝΗΤΑ'),'owned sidebar missing');
assert(interactive.t.includes('ΑΚΙΝΗΤΑ ΠΡΟΣ ΑΓΟΡΑ'),'candidate sidebar missing');
assert(interactive.t.includes('ΟΛΑ ΤΑ ΑΚΙΝΗΤΑ'),'catalogue link missing from map page');
assert(interactive.t.includes('/property/ERG-AKI-0008'),'details link missing from map page');
assert(interactive.t.includes('DLS Road Network'),'road layer label missing');

const png=await fetchBytes('/map.png?group=arsos&mpp=2');
assert((png.r.headers.get('content-type')||'').includes('image/png'),'map PNG endpoint is not image/png');
assert(png.b.length>20000,`map PNG suspiciously small (${png.b.length} bytes)`);

console.log('MAP_SMOKE '+JSON.stringify({ALL_PASS:true,crs:102319,requested_mpp:2,arsos,pafos,master,orientation:{REMU42711_west_of_4_274:true,delta_x_m:touch.centroid_relation.delta_x_m},scaleChecks,webApp:{catalogue:true,propertyDetail:true,interactiveMap:true,png:true}}));
