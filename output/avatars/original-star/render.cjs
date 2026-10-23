const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('/home/tony/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
 const browser = await chromium.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
 const page = await browser.newPage({viewport:{width:640,height:640},deviceScaleFactor:1});
 for (const file of fs.readdirSync(__dirname).filter(x=>x.endsWith('.tgs'))) {
  const id=path.basename(file,'.tgs');
  const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,file))));
  await page.setContent('<html><body style="margin:0;background:#191724;width:640px;height:640px;display:flex;align-items:center;justify-content:center"><div id="a" style="width:480px;height:480px"></div></body></html>');
  await page.addScriptTag({path:path.resolve('node_modules/lottie-web/build/player/lottie.min.js')});
  await page.evaluate(data=>new Promise(resolve=>{window.anim=lottie.loadAnimation({container:document.getElementById('a'),renderer:'svg',loop:false,autoplay:false,animationData:data});anim.addEventListener('DOMLoaded',resolve)}),data);
  await page.evaluate(()=>anim.goToAndStop(0,true));
  await page.screenshot({path:path.join(__dirname,id+'.png')});
  if(process.argv.includes('--video')) {
   const dir=path.join(__dirname,id+'-frames'); fs.mkdirSync(dir,{recursive:true});
   const count=Math.round((data.op-data.ip)/data.fr*30);
   for(let i=0;i<count;i++) {
    await page.evaluate(frame=>anim.goToAndStop(frame,true),data.ip+i*data.fr/30);
    await page.screenshot({path:path.join(dir,String(i).padStart(4,'0')+'.png')});
   }
  }
  console.log(id);
 }
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
