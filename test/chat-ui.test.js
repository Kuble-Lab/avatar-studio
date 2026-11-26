import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function boot(configured = true) {
  class Element {
    constructor(){this.dataset={};this.children=[];this.handlers={};this.value='';this.style={setProperty(){}};}
    addEventListener(type,handler){this.handlers[type]=handler;}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    focus(){}
  }
  const elements=new Map();
  const document={getElementById(id){if(!elements.has(id))elements.set(id,new Element());return elements.get(id);},createElement(){return new Element();},documentElement:new Element()};
  const calls=[];
  let failChat=false;
  const fetch=async (url,options)=>{
    calls.push({url,options});
    const body=url==='/api/avatar'?{name:'Robin',description:'Support',greeting:'Hallo Robin',accent:'#123456',image:''}:url==='/api/health'?{openaiConfigured:configured}:failChat?{message:'Test error'}:{answer:'Eine hilfreiche Antwort.'};
    return {ok:!failChat||url!=='/api/avatar/text',json:async()=>body};
  };
  const context=vm.createContext({document,fetch,window:{addEventListener(){}},setTimeout,console,AbortSignal});
  vm.runInContext(fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'),context);
  return {elements,calls,fail(){failChat=true;}};
}
const ready=()=>new Promise(resolve=>setImmediate(resolve));
test('chat loads configured identity and sends bounded history through the avatar API',async()=>{
 const ui=boot();await ready();
 assert.equal(ui.elements.get('avatar-name').textContent,'Robin');
 assert.equal(ui.elements.get('send-button').disabled,false);
 const input=ui.elements.get('question');input.value='Hallo';
 await ui.elements.get('chat-form').handlers.submit({preventDefault(){}});
 assert.equal(ui.calls.at(-1).url,'/api/avatar/text');
 assert.deepEqual(JSON.parse(ui.calls.at(-1).options.body),{question:'Hallo',history:[]});
 input.value='Noch eine Frage';
 await ui.elements.get('chat-form').handlers.submit({preventDefault(){}});
 assert.equal(JSON.parse(ui.calls.at(-1).options.body).history.length,1);
 ui.fail();input.value='Fehlerfall';await ui.elements.get('chat-form').handlers.submit({preventDefault(){}});
 assert.equal(ui.elements.get('send-button').disabled,false);
 assert.equal(ui.elements.get('status').textContent,'Antwort fehlgeschlagen');
});
test('missing API key leaves chat and microphone disabled',async()=>{
 const ui=boot(false);await ready();
 assert.equal(ui.elements.get('send-button').disabled,true);
 assert.equal(ui.elements.get('voice-button').disabled,true);
 assert.match(ui.elements.get('status').textContent,/OPENAI_API_KEY/);
});
