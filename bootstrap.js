import {readFileSync,writeFileSync} from 'node:fs';

const sourcePath='./viewer.js';
const runtimePath='./viewer.runtime.js';
let s=readFileSync(sourcePath,'utf8');

function replaceOnce(from,to,label){
  if(!s.includes(from)) throw new Error(`bootstrap patch not found: ${label}`);
  s=s.replace(from,to);
}

// High-resolution DLS raster must stay underneath the cadastral vector overlay.
replaceOnce(
  "const owned=svgDoc.getElementById('owned-overlay');if(owned)owned.parentNode.insertBefore(hi,owned);else svgDoc.documentElement.appendChild(hi);",
  "const cad=svgDoc.getElementById('cadastre-overlay'),owned=svgDoc.getElementById('owned-overlay'),anchor=cad||owned;if(anchor)anchor.parentNode.insertBefore(hi,anchor);else svgDoc.documentElement.appendChild(hi);",
  'hires raster layer order'
);

// Render the embedded SVG at its actual zoomed CSS size instead of scaling the whole
// <object> as one composited bitmap. This keeps vector cadastral lines crisp at zoom.
replaceOnce(
  "const apply=()=>{clamp();obj.style.transform='translate('+x+'px,'+y+'px) scale('+scale+')';};",
  "const apply=()=>{clamp();obj.style.transform='none';obj.style.left=x+'px';obj.style.top=y+'px';obj.style.width=(mapW*scale)+'px';obj.style.height=(mapH*scale)+'px';};",
  'actual-size SVG rendering'
);

// With actual-size rendering, embedded-document pointer coordinates are screen/CSS pixels.
replaceOnce(
  "lastX=e.clientX*scale;lastY=e.clientY*scale;",
  "lastX=e.clientX;lastY=e.clientY;",
  'pointerdown coordinates'
);

// During drag, move exactly with the pointer and avoid clamping every pointer event.
replaceOnce(
  "const sx=e.clientX*scale,sy=e.clientY*scale,dx=sx-lastX,dy=sy-lastY;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;x+=dx;y+=dy;lastX=sx;lastY=sy;apply();e.preventDefault();",
  "const dx=e.clientX-lastX,dy=e.clientY-lastY;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;x+=dx;y+=dy;lastX=e.clientX;lastY=e.clientY;obj.style.left=x+'px';obj.style.top=y+'px';e.preventDefault();",
  'pointermove pan'
);

// Clamp once, after dragging finishes.
replaceOnce(
  "drag=false;wrap.classList.remove('dragging');save();scheduleRasterRefresh(120);",
  "drag=false;wrap.classList.remove('dragging');apply();save();scheduleRasterRefresh(120);",
  'pointerup clamp'
);

// Give the visible-viewport DLS refresh more pixel headroom on high-density displays.
replaceOnce(
  "const dpr=Math.min(2,window.devicePixelRatio||1),outW=Math.max(512,Math.min(3072,Math.round(wrap.clientWidth*dpr))),outH=Math.max(512,Math.min(3072,Math.round(wrap.clientHeight*dpr)));",
  "const dpr=Math.min(3,window.devicePixelRatio||1),outW=Math.max(768,Math.min(4096,Math.round(wrap.clientWidth*dpr))),outH=Math.max(768,Math.min(4096,Math.round(wrap.clientHeight*dpr)));",
  'hires raster output size'
);
replaceOnce(
  "u.searchParams.set('dpi',scale>=8?'192':'144');",
  "u.searchParams.set('dpi',scale>=8?'288':'192');",
  'hires raster dpi'
);

// Greek UI labels requested during acceptance testing.
s=s.replaceAll('>Details</a>','>ΠΛΗΡΟΦΟΡΙΕΣ</a>')
   .replaceAll('>Source ↗</a>','>ΠΗΓΗ ↗</a>')
   .replaceAll('χωρίς source','χωρίς πηγή');

s=s.replaceAll('v=3.7','v=3.9').replaceAll('viewer v3.7','viewer v3.9');
writeFileSync(runtimePath,s,'utf8');
await import('./viewer.runtime.js');
