// Renders reel.html to PNG frames: node render.js <outDir> [fps] [onlyTimes,comma]
const {chromium}=require('playwright');const path=require('path');const fs=require('fs');
(async()=>{const out=process.argv[2];const fps=+(process.argv[3]||30);const only=process.argv[4];
fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+path.resolve(__dirname,'reel.html')+'?t=0');await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(800);
const dur=await p.evaluate(()=>window.DUR);
const times=only?only.split(',').map(Number):[...Array(Math.round(dur*fps)).keys()].map(i=>i/fps);
for(let i=0;i<times.length;i++){await p.evaluate(t=>render(t),times[i]);
 await p.screenshot({path:`${out}/f${String(i).padStart(4,'0')}.${only?'png':'jpg'}`,...(only?{}:{type:'jpeg',quality:92})});}
await b.close();})();
