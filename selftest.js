import { URL } from 'node:url';

const MAP='https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer';
const PARCELS=MAP+'/0';
const DISTRICTS=MAP+'/15';
const COMMUNITIES=MAP+'/16';
const CRS=102319;
const AREAS={
  arsos:{district:'LEMESOS',communityNeedle:'ARSOS'},
  pafos:{district:'PAFOS',communityNeedle:'AGIOS NIKOLAOS'}
};
const P={
  IDI0006:{area:'arsos',sheet:'46',plan:'48W1',block:4,parcel:287},
  AKI0003:{area:'arsos',sheet:'46',plan:'48W1',block:4,parcel:105},
  AKI0008:{area:'arsos',sheet:'46',plan:'39E2',block:3,parcel:149},
  AKI0010:{area:'arsos',sheet:'46',plan:'39E2',block:3,parcel:150},
  AKI0006:{area:'arsos',sheet:'46',plan:'39E1',block:3,parcel:139},
  AKI0009:{area:'arsos',sheet:'46',plan:'39E1',block:3,parcel:143},
  IDI0016:{area:'arsos',sheet:'46',plan:'40',block:0,parcel:743},
  AKI0004:{area:'arsos',sheet:'46',plan:'40W1',block:5,parcel:99},
  IDI0008:{area:'pafos',sheet:'46',plan:'24',block:0,parcel:260},
  IDI0010:{area:'pafos',sheet:'46',plan:'24',block:0,parcel:575}
};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function q(base,params){
  const u=new URL(base+'/query');for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));
  let lastErr;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const r=await fetch(u,{signal:AbortSignal.timeout(10000),headers:{'user-agent':'dls-gis-service-selftest/1.4'}});
      if(!r.ok){if(r.status>=500)throw new Error(`DLS HTTP ${r.status}`);throw new Error(`DLS HTTP ${r.status}`);}
      const j=await r.json();if(j.error)throw new Error(JSON.stringify(j.error));
      if(attempt>1)console.log(`DLS_RETRY_OK attempt=${attempt} url=${u.pathname}`);
      return j;
    }catch(e){
      lastErr=e;
      if(attempt===4)break;
      console.warn(`DLS_RETRY attempt=${attempt} reason=${e?.name||'Error'}:${e?.message||e}`);
      await sleep(750*attempt);
    }
  }
  throw lastErr;
}
const codeCache={};
async function areaCodes(key){if(codeCache[key])return codeCache[key];const a=AREAS[key];const dj=await q(DISTRICTS,{f:'json',where:`DIST_NM_E='${a.district}'`,outFields:'DIST_CODE,DIST_NM_E',returnGeometry:'false'});if(dj.features?.length!==1)throw new Error(`District ${a.district}: expected 1, got ${dj.features?.length??0}`);const dist=Number(dj.features[0].attributes.DIST_CODE);const cj=await q(COMMUNITIES,{f:'json',where:`DIST_CODE=${dist} AND UPPER(VIL_NM_E) LIKE '%${a.communityNeedle.toUpperCase()}%'`,outFields:'DIST_CODE,VIL_CODE,VIL_NM_E',returnGeometry:'false'});if(cj.features?.length!==1)throw new Error(`Community ${a.district}/${a.communityNeedle}: expected 1, got ${cj.features?.length??0}; matches=${JSON.stringify((cj.features||[]).map(x=>x.attributes))}`);const attrs=cj.features[0].attributes;const out={dist,vil:Number(attrs.VIL_CODE),district:a.district,community:String(attrs.VIL_NM_E)};console.log('DLS_AREA '+JSON.stringify(out));return codeCache[key]=out;}
async function parcel(p){const c=await areaCodes(p.area);const where=`DIST_CODE=${c.dist} AND VIL_CODE=${c.vil} AND BLCK_CODE=${p.block} AND PARCEL_NBR=${p.parcel} AND SHEET='${p.sheet}' AND PLAN_NBR='${p.plan}'`;const j=await q(PARCELS,{f:'json',where,outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,QRTR_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,SHAPE.STArea()',returnGeometry:'true',outSR:CRS,returnZ:'false'});if(j.features?.length!==1)throw new Error(`Locator ${where}: expected 1 feature, got ${j.features?.length??0}`);const f=j.features[0];console.log('DLS_RESOLVE '+JSON.stringify({area:p.area,locator:{sheet:p.sheet,plan:p.plan,block:p.block,parcel:p.parcel},parcel:f.attributes}));return f;}
const rings=f=>f.geometry?.rings||[];
function pd(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(!l2)return Math.hypot(p[0]-a[0],p[1]-a[1]);const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2));return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy));}
function sd(a,b,c,d){const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);const on=(p,q,r)=>Math.min(p[0],r[0])-1e-7<=q[0]&&q[0]<=Math.max(p[0],r[0])+1e-7&&Math.min(p[1],r[1])-1e-7<=q[1]&&q[1]<=Math.max(p[1],r[1])+1e-7;const o1=o(a,b,c),o2=o(a,b,d),o3=o(c,d,a),o4=o(c,d,b);if((Math.abs(o1)<1e-7&&on(a,c,b))||(Math.abs(o2)<1e-7&&on(a,d,b))||(Math.abs(o3)<1e-7&&on(c,a,d))||(Math.abs(o4)<1e-7&&on(c,b,d))||((o1>0)!=(o2>0)&&(o3>0)!=(o4>0)))return 0;return Math.min(pd(a,c,d),pd(b,c,d),pd(c,a,b),pd(d,a,b));}
function dist(a,b){let z=Infinity;for(const r1 of rings(a))for(const r2 of rings(b))for(let i=1;i<r1.length;i++)for(let j=1;j<r2.length;j++)z=Math.min(z,sd(r1[i-1],r1[i],r2[j-1],r2[j]));return z;}
const cache={};for(const [k,p]of Object.entries(P))cache[k]=await parcel(p);
const tests=[
 ['IDI0006','AKI0003',0,0.10,'touch 4/274 ↔ REMU42711'],
 ['AKI0008','AKI0010',5.33,1.0,'AKI0008 ↔ AKI0010'],
 ['AKI0006','AKI0009',150.94,2.0,'AKI0006 ↔ AKI0009'],
 ['IDI0016','AKI0004',194.08,3.0,'IDI0016 ↔ corrected AKI0004'],
 ['IDI0008','IDI0010',0,0.10,'Agios Nikolaos owned parcels touch']
];
const out=[];for(const[a,b,expected,tol,name]of tests){const actual=dist(cache[a],cache[b]);const pass=Math.abs(actual-expected)<=tol;out.push({name,a,b,expected_m:expected,actual_m:actual,tolerance_m:tol,pass});if(!pass)throw new Error(`SELFTEST FAIL ${name}: ${actual}m, expected ${expected}±${tol}`);}
console.log('DLS_SELFTEST '+JSON.stringify({ALL_PASS:true,crs:CRS,tests:out}));
