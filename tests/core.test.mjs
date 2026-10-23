import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { authenticate, AppError } from '../server/auth.mjs';
import { compileDocument, verifyCustomEmoji } from '../server/document.mjs';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { handleUpdate } from '../server/bot.mjs';
import { packName } from '../server/catalog.mjs';

const token = '123456:test_token';
function auth(user = 10, date = Math.floor(Date.now() / 1000)) {
  const data = { auth_date: String(date), user: JSON.stringify({ id: user, first_name: 'Test' }) };
  const check = Object.entries(data).sort().map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  data.hash = createHmac('sha256', secret).update(check).digest('hex'); return new URLSearchParams(data).toString();
}
test('Telegram initData: authentic owner accepted; tamper, duplicates and expired data rejected', () => {
  const value = auth(); assert.equal(authenticate(value, token).id, 10);
  assert.throws(() => authenticate(value.replace('Test','Evil'), token));
  assert.throws(() => authenticate(value + '&user=%7B%22id%22%3A11%7D', token));
  assert.throws(() => authenticate(auth(10, Math.floor(Date.now()/1000)-3700), token));
  assert.throws(() => authenticate(auth(10, Math.floor(Date.now()/1000)+120), token));
});
test('Telegram entities preserve UTF-16 offsets, newlines, formatting and complete emoji sequences', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph', content: [
    { type: 'text', text: 'Привет 👩‍💻 ' },
    { type: 'customEmoji', attrs: { id: '123', alt: 'FORGED' }, marks: [{ type: 'bold' }] },
    { type: 'text', text: ' мир' },
  ] }, { type: 'paragraph', content: [{ type: 'text', text: 'Да', marks: [{ type: 'italic' }] }] }] };
  const r = compileDocument(doc, id => id === '123' ? { alt: '❤️‍🔥' } : null);
  assert.equal(r.text, 'Привет 👩‍💻 ❤️‍🔥 мир\nДа');
  assert.deepEqual(r.entities[0], { type:'custom_emoji', offset:'Привет 👩‍💻 '.length, length:'❤️‍🔥'.length, custom_emoji_id:'123' });
  assert.equal(r.entities.at(-1).offset, r.text.length-2);
  assert.throws(() => compileDocument(doc, () => null));
  assert.throws(() => compileDocument({ type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'a'.repeat(4097)}]}] }, () => null));
});
test('Pack import only accepts Telegram emoji links or set names', () => {
  assert.equal(packName('https://t.me/addemoji/RGBHearts'), 'RGBHearts');
  assert.throws(() => packName('http://localhost/admin'));
  assert.throws(() => packName('https://t.me/addstickers/Test'));
});

async function fixture({ uncertain = false, revoked = false, droppedEmoji = false } = {}) {
  const store = new Store(':memory:'); let sends = 0; const payloads = [];
  const connection = { id:'connection-A', user:{id:10}, is_enabled:true, rights:{can_reply:true} };
  store.connection(connection); store.recipient(10, connection.id, {id:30,first_name:'Recipient',type:'private'}, Math.floor(Date.now()/1000));
  const telegram = { async call(method, payload) {
    if (method === 'getBusinessConnection') return {...connection, is_enabled: !revoked};
    if (method === 'sendPhoto' || method === 'sendVideo' || method === 'sendDocument') { sends++; payloads.push({method,payload}); if (uncertain) throw new AppError(502, 'timeout', 'telegram_unavailable'); return {message_id:100,caption:payload.get('caption'),caption_entities:droppedEmoji?[]:JSON.parse(payload.get('caption_entities'))}; }
    if (method === 'sendMessage') { sends++; payloads.push(payload); if (uncertain) throw new AppError(502, 'timeout', 'telegram_unavailable'); return {message_id:99,text:payload.text,entities:droppedEmoji ? [] : payload.entities}; }
    return {};
  } };
  const config = {token,publicUrl:''}; const catalog = {list:()=>[],lookup:()=>({alt:'✨'})};
  const app = createApp({ config, store, telegram, catalog });
  await new Promise(r => app.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${app.address().port}`;
  const document = {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Привет'}]}]};
  const request = (user=10,extra={}) => fetch(`${base}/api/send`,{method:'POST',headers:{'content-type':'application/json',authorization:`tma ${auth(user)}`},body:JSON.stringify({requestId:'11111111-1111-1111-1111-111111111111',recipient:'connection-A:30',document,...extra})});
  const upload = (user=10, extra={}, bytes=Buffer.from('test file'), name='test.txt') => { const form=new FormData(); form.set('payload',JSON.stringify({requestId:'22222222-2222-2222-2222-222222222222',recipient:'connection-A:30',document,attachmentKind:'document',...extra})); form.set('attachment',new Blob([bytes]),name); return fetch(`${base}/api/send`,{method:'POST',headers:{authorization:`tma ${auth(user)}`},body:form}); };
  return { store, telegram, config, request, upload, sends:()=>sends, payloads, close:()=>{app.closeAllConnections();app.close();store.db.close();} };
}
test('Only the connection owner can send, duplicate delivery does not send again', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request(11)).status,403); assert.equal(f.sends(),0);
    const first = await f.request(); assert.equal(first.status,200); assert.equal((await first.json()).sent,true);
    const again = await f.request(); assert.equal((await again.json()).messageId,99); assert.equal(f.sends(),1);
    assert.equal(f.payloads[0].business_connection_id,'connection-A'); assert.equal(f.payloads[0].chat_id,30);
    assert.equal((await f.request(10,{document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Changed'}]}]}})).status,409);
  } finally { f.close(); }
});
test('Uncertain delivery and revoked rights never silently cause a second send', async () => {
  const f = await fixture({uncertain:true});
  try { const r = await f.request(); assert.equal((await r.json()).code,'delivery_unknown'); assert.equal((await f.request()).status,409); assert.equal(f.sends(),1); } finally {f.close();}
  const revoked = await fixture({revoked:true});
  try { assert.equal((await revoked.request()).status,403); assert.equal(revoked.sends(),0); } finally {revoked.close();}
});
test('Accepted deliveries report lost custom emoji and keep that result without sending a duplicate', async () => {
  const document = {type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Привет 👋 '},{type:'customEmoji',attrs:{id:'123'}}]}]};
  for (const droppedEmoji of [false,true]) {
    const f = await fixture({droppedEmoji});
    try {
      const first = await f.request(10,{document});
      assert.equal(first.status,200);
      const result = await first.json();
      assert.equal(result.sent,true);
      assert.deepEqual(result.emojiDelivery,{expected:1,returned:droppedEmoji?0:1,confirmed:droppedEmoji?0:1,preserved:!droppedEmoji});
      assert.deepEqual((await (await f.request(10,{document})).json()),result);
      assert.equal(f.sends(),1);
      const stored = f.store.delivery(10,'11111111-1111-1111-1111-111111111111');
      assert.deepEqual(JSON.parse(stored.emoji_report),result.emojiDelivery);
      assert.equal(stored.status,'sent');
    } finally { f.close(); }
  }
});
test('Emoji verification checks IDs and positions while allowing Telegram to trim whitespace', () => {
  const text = '  Привет 👩‍💻 ✨ ✨  ';
  const first = text.indexOf('✨');
  const entities = [first,first+2].map(offset=>({type:'custom_emoji',offset,length:1,custom_emoji_id:'123'}));
  const compiled = {text,entities};
  const message = {text:text.trim(),entities:entities.map(e=>({...e,offset:e.offset-2}))};
  assert.equal(verifyCustomEmoji(compiled,message).preserved,true);
  assert.equal(verifyCustomEmoji(compiled,{...message,entities:[message.entities[0],message.entities[0]]}).preserved,false);
  assert.equal(verifyCustomEmoji(compiled,{...message,entities:message.entities.map(e=>({...e,custom_emoji_id:'456'}))}).preserved,false);
});
test('Native recipient selection is bound to the requesting owner and works for existing contacts', async () => {
  const f = await fixture();
  try {
    f.store.selection(42,10);
    const message = user => ({message:{chat:{id:user,type:'private'},from:{id:user},users_shared:{request_id:42,users:[{user_id:30,first_name:'Known contact'}]}}});
    await handleUpdate(message(11),f); assert.equal(f.store.selected(42,10),null);
    await handleUpdate(message(10),f); assert.equal(f.store.selected(42,10),30);
    assert.equal(f.store.recipients(10)[0].name,'Known contact'); assert.equal(f.store.selected(42,11),undefined);
  } finally {f.close();}
});


test('Telegram formatting preserves UTF-16 offsets and rejects unsafe combinations', () => {
  const doc = {type:'doc',content:[
    {type:'paragraph',attrs:{quote:'expandable'},content:[{type:'text',text:'😀секрет',marks:[{type:'spoiler'},{type:'strike'},{type:'link',attrs:{href:'https://example.com/'}}]}]},
    {type:'codeBlock',content:[{type:'text',text:'x = 1'}]},
    {type:'paragraph',content:[{type:'text',text:'code',marks:[{type:'code'}]}]},
  ]};
  const result = compileDocument(doc,()=>null);
  assert.equal(result.text,'😀секрет\nx = 1\ncode');
  for (const type of ['spoiler','strikethrough','text_link','expandable_blockquote']) assert.ok(result.entities.some(e=>e.type===type && e.offset===0 && e.length===8));
  assert.ok(result.entities.some(e=>e.type==='pre' && e.offset===9 && e.length===5));
  assert.ok(result.entities.some(e=>e.type==='code' && e.offset===15 && e.length===4));
  const bad = structuredClone(doc); bad.content[0].content[0].marks[2].attrs.href='javascript:alert(1)';
  assert.throws(()=>compileDocument(bad,()=>null),/ссылка/);
  bad.content[0].content[0].marks=[{type:'code'},{type:'bold'}];
  assert.throws(()=>compileDocument(bad,()=>null),/Код/);
});

test('File delivery binds owner, bytes and caption to one request; custom emoji remain in caption', async () => {
  const f = await fixture();
  const document = {type:'doc',content:[{type:'paragraph',content:[{type:'customEmoji',attrs:{id:'123'}}]}]};
  try {
    assert.equal((await f.upload(11,{document})).status,403);
    const first = await (await f.upload(10,{document})).json();
    assert.equal(first.sent,true); assert.equal(first.emojiDelivery.preserved,true);
    assert.equal(f.payloads[0].method,'sendDocument');
    const form=f.payloads[0].payload;
    assert.equal(form.get('business_connection_id'),'connection-A');
    assert.equal(form.get('chat_id'),'30'); assert.equal(form.get('caption'),'✨');
    assert.equal(await form.get('document').text(),'test file');
    assert.deepEqual(await (await f.upload(10,{document})).json(),first);assert.equal(f.sends(),1);
    assert.equal((await f.upload(10,{document},Buffer.from('changed'))).status,409);
  } finally { f.close(); }
});

test('Photo without caption works; bad photo, long caption, uncertain and revoked sends are guarded', async () => {
  const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP2kAAAAASUVORK5CYII=','base64');
  const empty={type:'doc',content:[{type:'paragraph'}]};
  const f=await fixture();
  try {
    assert.equal((await f.upload(10,{attachmentKind:'photo',document:empty})).status,400);
    const tooLong={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'a'.repeat(1025)}]}]};
    assert.equal((await f.upload(10,{document:tooLong})).status,400);assert.equal(f.sends(),0);
    assert.equal((await f.upload(10,{},Buffer.alloc(50_000_001))).status,413);
    assert.equal(f.sends(),0);
    assert.equal((await f.upload(10,{attachmentKind:'photo',document:empty},png,'photo.png')).status,200);
    assert.equal(f.payloads[0].method,'sendPhoto'); assert.equal(f.payloads[0].payload.get('caption'),'');
  } finally { f.close(); }
  for(const options of [{uncertain:true},{revoked:true}]) {
    const f=await fixture(options);
    try {
      const r=await f.upload();assert.equal(r.status,options.uncertain?502:403);
      if(options.uncertain){assert.equal((await f.upload()).status,409);assert.equal(f.sends(),1);}
      else assert.equal(f.sends(),0);
    }finally{f.close();}
  }
});

test('MP4 uses video delivery and documents larger than the old 20 MB cap are accepted', async () => {
  const f=await fixture();
  try {
    assert.equal((await f.upload(10,{attachmentKind:'video'},Buffer.from('not video'),'test.mp4')).status,400);
    const mp4=Buffer.concat([Buffer.from([0,0,0,24]),Buffer.from('ftypisom'),Buffer.alloc(12)]);
    assert.equal((await f.upload(10,{attachmentKind:'video'},mp4,'test.mp4')).status,200);
    assert.equal(f.payloads[0].method,'sendVideo');
    assert.equal(f.payloads[0].payload.get('video').name,'test.mp4');
    const r=await f.upload(10,{requestId:'33333333-3333-3333-3333-333333333333'},Buffer.alloc(20_000_001));
    assert.equal(r.status,200);assert.equal(f.payloads[1].method,'sendDocument');
  }finally{f.close();}
});
