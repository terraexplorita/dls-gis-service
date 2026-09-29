import { URL } from 'node:url';

const DLS='https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/CadastralMap_EN/MapServer/0';
const PROP='https://eservices.dls.moi.gov.cy/arcgis/rest/services/National/General_Search/MapServer/14';
const CRS=102319;
const P={
  IDI0006:{regBlock:4,regNo:'274',sheet:'46',plan:'48W1',block:4,parcel:287},
  AKI0003:{regBlock:4,regNo:'103',sheet:'46',plan:'48W1',block:4,parcel:105},
  AKI0008:{regBlock:3,regNo:'147',sheet:'46',plan:'39E2',block:3,parcel:149},
  AKI0010:{regBlock:3,regNo:'148',sheet:'46',plan:'39E2',block:3,parcel:150},
  AKI0006:{regBlock:3,regNo:'137',sheet:'46',plan:'39E1',block:3,parcel:139},
  AKI0009:{regBlock:3,regNo:'141',sheet:'46',plan:'39E1',block:3,parcel:143},
  IDI0016:{regBlock:0,regNo:'12110',sheet:'46',plan:'40',block:0,parcel:743},
  AKI0004:{regBlock:4,regNo:'97',sheet:'46',plan:'40W1',block:5,parcel:99}
};
async function q(base,params){const u=new URL(base+'/query');for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));const r=await fetch(u,{signal:AbortSignal.timeout(25000),headers:{'user-agent':'dls-gis-service-selftest/1.1'}});if(!r.ok)throw new Error(`DLS HTTP ${r.status}`);const j=await r.json();if(j.error)throw new Error(JSON.stringify(j.error));return j;}
async function registration(p){const where=`RegistrationBlock=${p.regBlock} AND RegistrationNo='${p.regNo}'`;const j=await q(PROP,{f:'json',where,outFields:'PropertyId,DistrictId,MunicipalityId,QuarterId,RegistrationBlock,RegistrationNo,ParcelId,ParcelNo,Extents,ParcelExtent',returnGeometry:'false'});if(j.features?.length!==1)throw new Error(`Registration ${p.regBlock}/${p.regNo}: expected 1 row, got ${j.features?.length??0}`);return j.features[0].attributes;}
async function parcel(p){const reg=await registration(p);const where=`DIST_CODE=${Number(reg.DistrictId)} AND VIL_CODE=${Number(reg.MunicipalityId)} AND BLCK_CODE=${p.block} AND PARCEL_NBR=${p.parcel} AND SHEET='${p.sheet}' AND PLAN_NBR='${p.plan}'`;const j=await q(DLS,{f:'json',where,outFields:'SBPI_ID_NO,DIST_CODE,VIL_CODE,QRTR_CODE,BLCK_CODE,PARCEL_NBR,SHEET,PLAN_NBR,SHAPE.STArea()',returnGeometry:'true',outSR:CRS,returnZ:'false'});if(j.features?.length!==1)throw new Error(`Resolved ${p.regBlock}/${p.regNo}; locator ${where}: expected 1 feature, got ${j.features?.length??0}; reg=${JSON.stringify(reg)}`);const f=j.features[0];console.log('DLS_RESOLVE '+JSON.stringify({registration:`${p.regBlock}/${p.regNo}`,reg,parcel:f.attributes}));return f;}
const rings=f=>f.geometry?.rings||[];
function pd(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;if(!l2)return Math.hypot(p[0]-a[0],p[1]-a[1]);const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2));return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy));}
function sd(a,b,c,d){const o=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);const on=(p,q,r)=>Math.min(p[0],r[0])-1e-7<=q[0]&&q[0]<=Math.max(p[0],r[0])+1e-7&&Math.min(p[1],r[1])-1e-7<=q[1]&&q[1]<=Math.max(p[1],r[1])+1e-7;const o1=o(a,b,c),o2=o(a,b,d),o3=o(c,d,a),o4=o(c,d,b);if((Math.abs(o1)<1e-7&&on(a,c,b))||(Math.abs(o2)<1e-7&&on(a,d,b))||(Math.abs(o3)<1e-7&&on(c,a,d))||(Math.abs(o4)<1e-7&&on(c,b,d))||((o1>0)!=(o2>0)&&(o3>0)!=(o4>0)))return 0;return Math.min(pd(a,c,d),pd(b,c,d),pd(c,a,b),pd(d,a,b));}
function dist(a,b){let z=Infinity;for(const r1 of rings(a))for(const r2 of rings(b))for(let i=1;i<r1.length;i++)for(let j=1;j<r2.length;j++)z=Math.min(z,sd(r1[i-1],r1[i],r2[j-1],r2[j]));return z;}
const cache={};for(const [k,p] of Object.entries(P))cache[k]=await parcel(p);
const tests=[['IDI0006','AKI0003',0,0.10,'touch 4/274 ↔ REMU42711'],['AKI0008','AKI0010',5.33,1.0,'AKI0008 ↔ AKI0010'],['AKI0006','AKI0009',150.94,2.0,'AKI0006 ↔ AKI0009'],['IDI0016','AKI0004',194.08,3.0,'IDI0016 ↔ corrected AKI0004']];
const out=[];for(const[a,b,expected,tol,name]of tests){const actual=dist(cache[a],cache[b]);const pass=Math.abs(actual-expected)<=tol;out.push({name,a,b,expected_m:expected,actual_m:actual,tolerance_m:tol,pass});if(!pass)throw new Error(`SELFTEST FAIL ${name}: ${actual}m, expected ${expected}±${tol}`);}
console.log('DLS_SELFTEST '+JSON.stringify({ALL_PASS:true,crs:CRS,tests:out}));
