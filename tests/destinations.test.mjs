import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Store } from '../server/store.mjs';
import { createApp } from '../server/app.mjs';
import { handleUpdate } from '../server/bot.mjs';
const token = '123456:test_token';
function auth(user = 10, date = Math.floor(Date.now() / 1000)) {
  const data = { auth_date: String(date), user: JSON.stringify({ id: user, first_name: 'Test' }) };
  const check = Object.entries(data).sort().map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  data.hash = createHmac('sha256', secret).update(check).digest('hex'); return new URLSearchParams(data).toString();
}

test('Scoped native selection, revoked permissions, group/channel routing and idempotency', async () => {
 const store = new Store(':memory:'); let revoked = false; let botRevoked = false; const sends=[];
 const bot={id:99,username:'testbot'};
 const telegram={async call(method,p) {
   if(method==='getChat') return {id:p.chat_id,type:p.chat_id===-20?'channel':'supergroup',title:'Test'};
   if(method==='getChatMember') return {status:(p.user_id===99?botRevoked:revoked)?'member':'administrator',can_post_messages:true,is_anonymous:false};
   if(method==='savePreparedKeyboardButton') return {id:'prepared'};
   if(method==='sendMessage') {sends.push(p);return {message_id:1,text:p.text,entities:p.entities};}
   throw Error(method);
 }};
 const ctx={store,bot,telegram,config:{token}};
 const share=(id,owner=10)=>handleUpdate({message:{chat:{type:'private'},from:{id:owner},chat_shared:{request_id:id,chat_id:-20}}},ctx);
 store.destinationRequest(1,10,'channel');
 await share(1,11); assert.equal(store.destinations(11).length,0);
 await share(1); assert.equal(store.destinations(10).length,1);
 store.destinationRequest(2,10,'channel');store.db.prepare('UPDATE destination_requests SET expires=0 WHERE id=2').run();await share(2);assert.equal(store.selectedDestination(2,10),undefined);
 revoked=true;store.destinationRequest(3,10,'channel');await share(3);assert.match(store.selectedDestination(3,10).error,/владелец/);revoked=false;
 store.destination(10,{id:-30,type:'group',title:'Group',username:null});
 const app=createApp({...ctx,catalog:{list:()=>[],lookup:()=>null}});await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const send=(target,id,user=10)=>fetch('http://127.0.0.1:'+app.address().port+'/api/send',{method:'POST',headers:{'content-type':'application/json',authorization:'tma '+auth(user)},body:JSON.stringify({recipient:target,requestId:id,document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'Hello'}]}]}})});
 try {
   assert.equal((await send('bot:-20','channel-000000001',11)).status,403);
   assert.equal((await send('bot:-20','channel-000000001')).status,200);
   assert.equal((await send('bot:-20','channel-000000001')).status,200);
   assert.equal((await send('bot:-30','group-00000000001')).status,200);
   assert.equal(sends.length,2);assert.deepEqual(sends.map(p=>p.chat_id),[-20,-30]);assert.ok(sends.every(p=>!('business_connection_id' in p)));
   revoked=true;assert.equal((await send('bot:-20','channel-000000002')).status,403);revoked=false;
   botRevoked=true;assert.equal((await send('bot:-30','group-00000000002')).status,403);assert.equal(sends.length,2);
 } finally {app.closeAllConnections();await new Promise(r=>app.close(r));store.db.close();}
});
