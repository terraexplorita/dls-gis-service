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

// Pointer coordinates are already screen pixels. Multiplying by zoom caused over-correction/jitter.
replaceOnce(
  "lastX=e.clientX*scale;lastY=e.clientY*scale;",
  "lastX=e.clientX;lastY=e.clientY;",
  'pointerdown coordinates'
);

// During drag, move 1:1 with the pointer and avoid clamping every pointer event.
replaceOnce(
  "const sx=e.clientX*scale,sy=e.clientY*scale,dx=sx-lastX,dy=sy-lastY;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;x+=dx;y+=dy;lastX=sx;lastY=sy;apply();e.preventDefault();",
  "const dx=e.clientX-lastX,dy=e.clientY-lastY;if(Math.abs(dx)+Math.abs(dy)>2)moved=true;x+=dx;y+=dy;lastX=e.clientX;lastY=e.clientY;obj.style.transform='translate('+x+'px,'+y+'px) scale('+scale+')';e.preventDefault();",
  'pointermove pan'
);

// Clamp once, after dragging finishes.
replaceOnce(
  "drag=false;wrap.classList.remove('dragging');save();scheduleRasterRefresh(120);",
  "drag=false;wrap.classList.remove('dragging');apply();save();scheduleRasterRefresh(120);",
  'pointerup clamp'
);

s=s.replaceAll('v=3.7','v=3.8').replaceAll('viewer v3.7','viewer v3.8');
writeFileSync(runtimePath,s,'utf8');
await import('./viewer.runtime.js');
