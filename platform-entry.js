import {readFileSync,writeFileSync,existsSync} from 'node:fs';

// The runtime bootstrap chain performs exact source-string patches.
// Git for Windows may checkout text files with CRLF while Render/Linux uses LF.
// Normalize only the source files read and patched at runtime before importing bootstrap3.
for(const file of ['./bootstrap2.js','./data.js','./viewer.js','./server.js']){
  if(!existsSync(file)) continue;
  const source=readFileSync(file,'utf8');
  const normalized=source.replace(/\r\n?/g,'\n');
  if(normalized!==source) writeFileSync(file,normalized,'utf8');
}

await import('./bootstrap3.js');
