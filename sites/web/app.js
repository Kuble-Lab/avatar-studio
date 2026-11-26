const $ = id => document.getElementById(id);
const presets = {
 alex: {name:'Alex',description:'Dein persönlicher KI-Avatar',greeting:'Hallo, ich bin Alex. Hier kannst du ausprobieren, wie sich dein eigener Avatar anfühlt. Was möchtest du entdecken?',accent:'#5369e8',personality:'Freundlich, neugierig und klar. Hilf dabei, Gedanken zu ordnen und nächste Schritte zu finden.'},
 mira: {name:'Mira',description:'Dein Lerncoach für neue Perspektiven',greeting:'Hallo, ich bin Mira. Lass uns etwas Neues entdecken. Welches Thema interessiert dich?',accent:'#298675',personality:'Geduldig und ermutigend. Erkläre verständlich, verwende Beispiele und stelle hilfreiche Rückfragen.'},
 noah: {name:'Noah',description:'Antworten, die dich weiterbringen',greeting:'Hallo, ich bin Noah. Ich helfe dir, dich schnell zurechtzufinden. Wobei brauchst du Unterstützung?',accent:'#9b6848',personality:'Ruhig, präzise und lösungsorientiert. Verwende das hinterlegte Wissen und frage bei Unklarheiten nach.'}
};
const defaults = {...presets.alex,image:'',voice:'',mode:'general',knowledge:'Avatar Studio ist eine Open-Source-Web-App unter der MIT-Lizenz.\nDu kannst Name, Bild, Farbe, Stimme, Persönlichkeit und Wissen konfigurieren.\nFür echte KI-Gespräche benötigt die Vollversion einen OpenAI-API-Key auf dem Server.'};
let connected=false, pending=false, generation=0, history=[];
let config = {...defaults}, draftImage = '', speaking = false;
try { const saved=JSON.parse(localStorage.getItem('avatar-studio-demo') || 'null'); if(saved && typeof saved==='object') config={...defaults,...saved}; } catch {}
function status(text,state='ready') { $('status').textContent=text; $('avatar-stage').dataset.state=state; }
function message(text,role='assistant') {
 const el=document.createElement('article');el.className=`message ${role}`;
 const label=document.createElement('div');label.className='message-label';label.textContent=role==='user'?'DU':`${config.name} · ${connected?"OpenRouter":"Demo"}`;
 const body=document.createElement('div');body.className='message-text';body.textContent=text;el.append(label,body);$('messages').append(el);$('messages').scrollTop=$('messages').scrollHeight;
}
function apply(reset=true) {
 document.documentElement.style.setProperty('--accent',/^#[a-f0-9]{6}$/i.test(config.accent)?config.accent:defaults.accent);
 $('avatar-name').textContent=config.name; $('avatar-description').textContent=config.description; $('avatar-initial').textContent=Array.from(config.name||'A')[0];
 const validImage=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(config.image||'');
 $('avatar-image').hidden=!validImage; $('avatar-initial').hidden=validImage;
 if(validImage){$('avatar-image').src=config.image;$('avatar-image').alt=config.name;}else $('avatar-image').removeAttribute('src');
 if(reset){generation++;history=[];$('messages').replaceChildren();message(config.greeting);}
 status('Demo bereit · frei ausprobieren');
}
function stopSpeech(){window.speechSynthesis?.cancel();speaking=false;$('voice-button').textContent='Stimme anhören';status('Demo bereit');}
$('voice-button').addEventListener('click',()=>{
 if(speaking)return stopSpeech();
 if(!('speechSynthesis' in window)){status('Dein Browser unterstützt keine Sprachausgabe.');return;}
 const utterance=new SpeechSynthesisUtterance(`Hallo, ich bin ${config.name}. Das ist eine Stimmprobe aus deinem Browser. ${config.greeting}`);
 const selected=speechSynthesis.getVoices().find(v=>v.voiceURI===config.voice);if(selected)utterance.voice=selected;
 utterance.lang='de-DE';utterance.rate=.95;utterance.onend=stopSpeech;utterance.onerror=()=>{stopSpeech();status('Stimmprobe nicht verfügbar. Wähle eine andere Browser-Stimme.');};
 speaking=true;$('voice-button').textContent='Stimmprobe stoppen';status('Stimmprobe · Browser-Sprachausgabe','speaking');speechSynthesis.speak(utterance);
});
function reply(question){
 const q=question.toLocaleLowerCase('de');
 const words=q.match(/[\p{L}\p{N}]+/gu)?.filter(w=>w.length>3&&!['kannst','bitte','etwas','einen','eine','deine','deinen','welche','welchen'].includes(w))||[];
 const snippets=config.knowledge.split(/\n+/).filter(Boolean).map(text=>({text,score:words.filter(w=>text.toLowerCase().includes(w)).length})).sort((a,b)=>b.score-a.score);
 if(snippets[0]?.score>0)return `Aus deinem Beispielwissen:\n${snippets[0].text}`;
 if(config.mode==='knowledge')return 'In deinem Beispielwissen finde ich dazu noch keine passende Information. Ergänze einen Text unter «Avatar gestalten» und frag mich erneut.';
 if(/start|einricht|install/.test(q))return 'Öffne das GitHub-Repository, installiere die App und hinterlege deinen OpenAI-API-Key auf dem Server. Im Admin gestaltest du dann deinen Avatar und lädst sein Wissen hoch. Hier in der Demo kannst du die Oberfläche direkt ausprobieren.';
 if(/kann|funktion|hilf/.test(q))return 'Du kannst mir einen eigenen Namen, ein Bild, eine Farbe und eine Persönlichkeit geben. Probier «Avatar gestalten» oben rechts. Diese Demo zeigt vorbereitete Antworten; die Vollversion kann echte Text- und Sprachgespräche führen.';
 if(/wer|heiss|name/.test(q))return `Ich bin ${config.name}. ${config.description}. Meine Persönlichkeit in dieser Demo: ${config.personality}`;
 if(/stimm|sprech|voice/.test(q))return 'Mit «Stimme anhören» spielst du eine Browser-Stimmprobe ab. Die Vollversion verbindet dich über WebRTC mit OpenAI Realtime für natürliche Sprachgespräche.';
 return `Danke für deine Nachricht! Als ${config.name} würde ich mit dir darüber sprechen. Diese Demo hat keine KI-Verbindung und zeigt deshalb nur Beispielantworten. Frag nach einem Begriff aus deinem Beispielwissen oder probier eine andere Avatar-Rolle aus.`;
}
async function connection() {
 const response=await fetch('/api/key');
 if(!response.ok) throw Error('Verbindungsstatus nicht verfügbar.');
 connected=(await response.json()).configured;
 document.querySelector('.demo-notice').textContent=connected?'Textchat mit OpenRouter · GPT-4o mini':'Demo mit Beispielantworten. Für KI-Antworten hinterlege deinen OpenRouter-Key unter «Admin».';
 document.querySelector('.privacy-note').textContent=connected?'Deine Nachrichten und dein Avatar-Wissen werden zur Beantwortung an OpenRouter gesendet.':'Demo-Chat bleibt in diesem Tab.';
}
const ready=connection().catch(()=>{ status('OpenRouter-Verbindungsstatus nicht verfügbar.'); });
$('chat-form').addEventListener('submit',async event=>{
 event.preventDefault();
 const question=$('question').value.trim();
 if(!question||pending)return;
 pending=true;
 $('send-button').disabled=true;
 const current=generation;
 try {
  await ready;
  if(current!==generation)return;
  message(question,'user');$('question').value='';
  if(!connected){message(reply(question));return;}
  const profile=[config.name,config.description,config.personality,config.knowledge,config.mode==='knowledge'?'Antworte ausschliesslich anhand des hinterlegten Wissens.':''].join('\n');
  const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question,profile,history})});
  const data=await response.json();
  if(current!==generation)return;
  if(!response.ok)throw Error(data.error);
  message(data.answer);
  history=[...history,{role:'user',content:question},{role:'assistant',content:data.answer.slice(0,8000)}].slice(-10);
 } catch(error){if(current===generation)status(error.message || 'Nachricht konnte nicht gesendet werden.');}
 finally {pending=false;$('send-button').disabled=false;}
});
window.addEventListener('pageshow',event=>{if(event.persisted)connection().catch(()=>status('Verbindungsstatus nicht verfügbar.'));});
$('question').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('chat-form').requestSubmit();}});
document.querySelectorAll('[data-question]').forEach(button=>button.addEventListener('click',()=>{$('question').value=button.dataset.question;$('chat-form').requestSubmit();}));
$('clear-button').addEventListener('click',()=>{stopSpeech();apply();});
function populate(value){
 for(const field of ['name','description','greeting','accent','personality','voice','knowledge','mode'])$(`edit-${field}`).value=value[field]??'';
 draftImage=value.image||''; $('edit-image').value='';
}
$('configure-button').addEventListener('click',()=>{stopSpeech();populate(config);$('config-status').textContent='';$('config-dialog').showModal();});
$('close-config').addEventListener('click',()=>$('config-dialog').close());
$('config-dialog').addEventListener('click',event=>{if(event.target===$('config-dialog')){const r=$('config-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('config-dialog').close();}});
document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>{populate({...defaults,...presets[button.dataset.preset]});$('config-status').textContent='Vorlage geladen. Übernimm die Änderungen, um sie auszuprobieren.';}));
$('edit-image').addEventListener('change',event=>{const file=event.target.files[0];if(!file)return;if(file.size>1000000||!['image/png','image/jpeg','image/webp'].includes(file.type)){$('config-status').textContent='Bitte PNG, JPEG oder WebP mit maximal 1 MB wählen.';event.target.value='';return;}const reader=new FileReader();reader.onload=()=>{draftImage=reader.result;$('config-status').textContent='Bild bereit. Änderungen übernehmen, um es zu verwenden.';};reader.onerror=()=>$('config-status').textContent='Bild konnte nicht gelesen werden.';reader.readAsDataURL(file);});
$('remove-image').addEventListener('click',()=>{draftImage='';$('edit-image').value='';$('config-status').textContent='Das neutrale Avatar-Symbol wird verwendet.';});
$('reset-demo').addEventListener('click',()=>{populate(defaults);$('config-status').textContent='Standardwerte geladen. Zum Speichern Änderungen übernehmen.';});
$('demo-config').addEventListener('submit',event=>{
 event.preventDefault();for(const field of ['name','description','greeting','accent','personality','voice','knowledge','mode'])config[field]=$(`edit-${field}`).value.trim();config.image=draftImage;config.name=config.name||'Alex';
 let saved=true;try{localStorage.setItem('avatar-studio-demo',JSON.stringify(config));}catch{saved=false;}
 stopSpeech();apply();$('config-dialog').close();if(!saved)status('Änderungen gelten für diesen Tab. Browser-Speicher ist nicht verfügbar.');
});
function loadVoices(){const selected=$('edit-voice').value||config.voice;const select=$('edit-voice');select.replaceChildren(new Option('Standardstimme des Browsers',''));for(const voice of window.speechSynthesis?.getVoices()||[]){select.add(new Option(`${voice.name} (${voice.lang})`,voice.voiceURI));}select.value=selected;}
if('speechSynthesis' in window){speechSynthesis.addEventListener('voiceschanged',loadVoices);loadVoices();}
window.addEventListener('pagehide',stopSpeech);apply();
