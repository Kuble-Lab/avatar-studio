import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../sites/worker/index.js';

test('authenticated voice calls use only the caller’s encrypted OpenAI key', async t => {
  const records = new Map();
  const env = {
    AVATAR_KEY_ENCRYPTION:Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'),
    BUCKET:{
      head:name=>records.has(name), put:(name,value)=>records.set(name,value),
      get:name=>records.has(name)?{text:()=>records.get(name)}:null,
      delete:name=>records.delete(name)
    }
  };
  const origin='https://avatar.example';
  const key='sk-synthetic-realtime-test';
  function call(path,method,user,body) {
    const headers={origin,'content-type':'application/json'};
    if(user) headers['oai-authenticated-user-id']=user;
    return worker.fetch(new Request(origin+path,{method,headers,body:JSON.stringify(body)}),env);
  }
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/realtime/calls');
    assert.equal(options.headers.Authorization,'Bearer '+key);
    assert.equal(options.redirect,'manual');
    const multipart=await new Response(options.body,{headers:options.headers}).formData();
    assert.equal(multipart.get('sdp'),'v=0\r\n');
    const session=JSON.parse(multipart.get('session'));
    assert.equal(session.model,'gpt-realtime-2');
    assert.equal(session.audio.input.turn_detection.interrupt_response,true);
    assert.match(session.instructions,/Lerncoach/);
    return new Response('v=0\r\n');
  });
  const input={sdp:'v=0\r\n',profile:'Lerncoach'};
  assert.equal((await call('/api/openai-key','PUT',null,{key})).status,401);
  assert.equal((await call('/api/openai-key','PUT','alice',{key})).status,200);
  assert.ok(![...records.values()][0].includes(key));
  assert.equal((await call('/api/realtime/call','POST','bob',input)).status,409);
  assert.deepEqual(await (await call('/api/key','GET','alice')).json(),{configured:false});
  assert.deepEqual(await (await call('/api/realtime/call','POST','alice',input)).json(),{sdp:'v=0\r\n'});
  assert.equal((await call('/api/openai-key','DELETE','alice')).status,200);
  assert.equal((await call('/api/realtime/call','POST','alice',input)).status,409);
});
