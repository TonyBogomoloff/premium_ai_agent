// Isolated local UI fixture. No real token, recipient, polling, or Telegram requests.
import { createHmac } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
const token = '123456:local_browser_fixture';
const data = { auth_date: String(Math.floor(Date.now()/1000)), user: JSON.stringify({id:101,first_name:'UI test'}) };
const secret = createHmac('sha256','WebAppData').update(token).digest();
data.hash = createHmac('sha256',secret).update(Object.entries(data).sort().map(([k,v])=>`${k}=${v}`).join('\n')).digest('hex');
const initData = new URLSearchParams(data).toString();
const staticDir = process.env.QA_STATIC_DIR || '.data/qa-dist'; await mkdir(staticDir,{recursive:true}); await cp('dist',staticDir,{recursive:true});
const html = (await readFile(`${staticDir}/index.html`,'utf8')).replace('https://telegram.org/js/telegram-web-app.js','/qa-telegram.js');
await writeFile(`${staticDir}/index.html`,html);
await writeFile(`${staticDir}/qa-telegram.js`,`window.Telegram={WebApp:{initData:${JSON.stringify(initData)},initDataUnsafe:{user:{id:101}},ready(){},expand(){},setHeaderColor(){},setBackgroundColor(){},setBottomBarColor(){},enableClosingConfirmation(){},BackButton:{onClick(){},show(){},hide(){}},HapticFeedback:{selectionChanged(){},notificationOccurred(){}},isVersionAtLeast(){return true},requestChat(id,done){done(true)}}};`);
await writeFile(`${staticDir}/qa-emoji.svg`,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><text x="2" y="38" font-size="36">✨</text></svg>');
await writeFile(`${staticDir}/qa-sticker.svg`,'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><circle cx="64" cy="64" r="52" fill="#b49af6"/><circle cx="48" cy="54" r="6" fill="#182533"/><circle cx="80" cy="54" r="6" fill="#182533"/><path d="M42 76 Q64 100 86 76" fill="none" stroke="#182533" stroke-width="6" stroke-linecap="round"/></svg>');
const store = new Store(':memory:'); const connection = {id:'qa-connection',user:{id:101},is_enabled:true,rights:{can_reply:true}};
store.connection(connection); store.recipient(101,connection.id,{id:202,type:'private',first_name:'Тестовый получатель'},Math.floor(Date.now()/1000));
let sends=0;
const telegram={async call(method,payload){
  if(method==='getBusinessConnection')return connection;
  if(method==='savePreparedKeyboardButton'){
    store.recipient(101,connection.id,{id:203,type:'private',first_name:'Выбранный контакт'});
    store.completeSelection(payload.button.request_users.request_id,101,203);
    return{id:'qa-prepared-button'};
  }
  if(method==='sendMessage'){sends++;console.log(JSON.stringify({mockSend:sends,text:payload.text,entities:payload.entities}));await new Promise(resolve=>setTimeout(resolve,Number(process.env.QA_SEND_DELAY_MS)||0));return{message_id:sends,text:payload.text,entities:process.env.QA_DROP_EMOJI==='1'?[]:payload.entities};}
  if(method==='sendSticker'){sends++;console.log(JSON.stringify({mockStickerSend:sends,replyTo:payload.reply_parameters?.message_id}));await new Promise(resolve=>setTimeout(resolve,Number(process.env.QA_SEND_DELAY_MS)||0));return{message_id:sends,sticker:{file_unique_id:payload.sticker,emoji:'❤️',thumbnail:{file_id:'qa-thumb'},...(payload.sticker==='qa-premium'?{premium_animation:{file_id:'qa-effect'}}:{})},...(payload.reply_parameters?{reply_to_message:{message_id:payload.reply_parameters.message_id}}:{})};}
  throw Error('Unexpected mock method');
},async file(){return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP2kAAAAASUVORK5CYII=','base64');}};
const stickerPack={name:'QAStickers',title:'Тестовые стикеры',kind:'sticker',stickers:[{id:'a'.repeat(64),alt:'❤️',premium:true},{id:'b'.repeat(64),alt:'🔥',premium:false}].map(s=>({...s,format:'webp',src:'/qa-sticker.svg',pack:'QAStickers'}))};
const catalog={list:(owner,kind)=>kind==='sticker'?[stickerPack]:[{name:'QATest',title:'Тестовый набор',emojis:[{id:'1234567',alt:'✨',format:'webp',src:'/qa-emoji.svg',pack:'QATest'}]}],
  lookup:(id,owner,kind)=>kind==='sticker'?(stickerPack.stickers.find(s=>s.id===id)?{file:id==='a'.repeat(64)?'qa-premium':'qa-regular',unique:id==='a'.repeat(64)?'qa-premium':'qa-regular',premium:id==='a'.repeat(64)}:null):id==='1234567'?{alt:'✨'}:null,
  add:async(owner,name,kind)=>{if(kind!=='sticker')throw Error('Use a sticker pack in this fixture');return stickerPack;}};
const port = Number(process.env.QA_PORT) || 8788;
createApp({config:{token,publicUrl:''},store,telegram,catalog,bot:{username:'premium_ai_agent'},staticDir}).listen(port,'127.0.0.1',()=>console.log(`Local mock UI: http://127.0.0.1:${port}`));
