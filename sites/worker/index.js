const base = 'https://openrouter.ai/api/v1';
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
function json(data, status=200) {
  return Response.json(data,{status,headers});
}
async function encryptionKey(env) {
  return crypto.subtle.importKey('raw',Uint8Array.from(atob(env.AVATAR_KEY_ENCRYPTION),c=>c.charCodeAt(0)), 'AES-GCM',false,['encrypt','decrypt']);
}
async function handle(request,env) {
  const url = new URL(request.url);
  const user = request.headers.get('oai-authenticated-user-id');
  const admin = url.pathname === '/admin' || url.pathname === '/admin.html';
  if ((admin || url.pathname.startsWith('/api/')) && !user) return json({error:'Bitte bei ChatGPT anmelden.'},401);
  if (!url.pathname.startsWith('/api/')) {
    const name = admin ? 'admin.html' : url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    if (!Object.hasOwn(assets,name)) return new Response(null,{status:404});
    const type = name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
    return new Response(assets[name],{headers:{...headers,'Content-Type':type+'; charset=utf-8'}});
  }
  const voice = ['/api/openai-key','/api/realtime/call'].includes(url.pathname);
  const record = (voice ? 'openai/' : 'openrouter/') + encodeURIComponent(user);
  if (request.method !== 'GET' && (request.headers.get('origin') !== url.origin || !request.headers.get('content-type')?.startsWith('application/json'))) return json({error:'Anfrage abgelehnt.'},403);
  if (['/api/key','/api/openai-key'].includes(url.pathname)) {
    if (request.method === 'GET') return json({configured:Boolean(await env.BUCKET.head(record))});
    if (request.method === 'DELETE') {
      await env.BUCKET.delete(record);
      return json({configured:false});
    }
    if (request.method !== 'PUT') return json({},405);
    const {key} = await request.json();
    if (voice) {
      if (typeof key !== 'string' || !/^sk-(?!or-)[A-Za-z0-9_-]{12,500}$/.test(key)) return json({error:'Bitte einen OpenAI-API-Key eingeben.'},400);
    } else {
      if (typeof key !== 'string' || !/^sk-or-[a-zA-Z0-9_-]{8,240}$/.test(key)) return json({error:'Bitte einen gültigen OpenRouter-Key eingeben.'},400);
      const check = await fetch(base+'/key',{headers:{Authorization:'Bearer '+key},redirect:'manual'});
      if (!check.ok) return json({error:check.status===401 ? 'OpenRouter hat den Key abgelehnt.' : 'OpenRouter konnte den Key gerade nicht prüfen.'},422);
    }
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(record)},await encryptionKey(env),new TextEncoder().encode(key));
    await env.BUCKET.put(record,JSON.stringify({iv:Array.from(iv),cipher:Array.from(new Uint8Array(cipher))}));
    return json({configured:true});
  }
  if (!['/api/chat','/api/realtime/call'].includes(url.pathname) || request.method !== 'POST') return json({},404);
  let saved;
  try { saved = await env.BUCKET.get(record); }
  catch { return json({error:'Der Schlüsselspeicher ist momentan nicht erreichbar.'},503); }
  if (!saved) return json({error:voice?'Bitte den OpenAI-Key im Admin-Bereich hinterlegen.':'Bitte zuerst deinen OpenRouter-Key hinterlegen.'},409);
  let plain;
  try {
    const {iv,cipher} = JSON.parse(await saved.text());
    plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(iv),additionalData:new TextEncoder().encode(record)},await encryptionKey(env),new Uint8Array(cipher));
  } catch { return json({error:'Der gespeicherte Key konnte nicht entschlüsselt werden. Bitte im Admin erneut speichern.'},503); }
  if (voice) {
    const {sdp,profile} = await request.json();
    if (typeof sdp !== 'string' || !sdp.startsWith('v=0') || sdp.length>65536 || typeof profile!=='string' || profile.length>10000) return json({error:'Ungültige Sprachverbindung.'},400);
    const session = {
      type:'realtime', model:'gpt-realtime-2', output_modalities:['audio'],
      instructions:'Führe ein natürliches Gespräch auf Deutsch, sofern keine andere Sprache gewünscht ist. Antworte kurz und berücksichtige dieses Avatar-Profil und Wissen:\n'+profile,
      audio:{input:{turn_detection:{type:'server_vad',create_response:true,interrupt_response:true}},output:{voice:'marin'}}
    };
    const form=new FormData();
    form.set('sdp',sdp);
    form.set('session',JSON.stringify(session));
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),25000);
    let upstream;
    try {
      // Serialize once so the hosting transport receives bytes and the matching multipart boundary.
      const encoded = new Response(form);
      upstream = await fetch('https://api.openai.com/v1/realtime/calls',{
        method:'POST', headers:{Authorization:'Bearer '+new TextDecoder().decode(plain),'Content-Type':encoded.headers.get('Content-Type')},
        body:await encoded.arrayBuffer(),redirect:'manual',signal:controller.signal
      });
    } catch {
      return json({error:controller.signal.aborted?'OpenAI hat nicht rechtzeitig geantwortet.':'Der Hosting-Server konnte OpenAI Realtime nicht erreichen.'},502);
    } finally { clearTimeout(timer); }
    if (!upstream.ok) return json({error:({401:'OpenAI hat den Key abgelehnt. Bitte im Admin ersetzen.',403:'Dem Key fehlt der Zugriff auf OpenAI Realtime.',429:'OpenAI-Kontingent oder Anfragelimit erreicht.'})[upstream.status] || 'OpenAI konnte das Gespräch nicht starten. Bitte Modellzugriff und Abrechnung prüfen.'},502);
    const answer=await upstream.text();
    if (!answer.startsWith('v=0')) return json({error:'OpenAI lieferte keine gültige Sprachverbindung.'},502);
    return json({sdp:answer});
  }
  const {question,profile,history} = await request.json();
  if (typeof question !== 'string' || !question.trim() || question.length>8000 || typeof profile!=='string' || profile.length>10000 || !Array.isArray(history) || history.length>10 || history.some(m=>!['user','assistant'].includes(m?.role)||typeof m.content!=='string'||m.content.length>8000)) return json({error:'Ungültige Chat-Nachricht.'},400);
  const response = await fetch(base+'/chat/completions',{method:'POST',redirect:'manual',headers:{Authorization:'Bearer '+new TextDecoder().decode(plain),'Content-Type':'application/json'},body:JSON.stringify({model:'openai/gpt-4o-mini',max_tokens:800,messages:[{role:'system',content:profile},...history,{role:'user',content:question}]})});
  if (!response.ok) return json({error:({401:'Bitte den API-Key im Admin-Bereich erneuern.',402:'Das OpenRouter-Guthaben reicht nicht aus.',429:'OpenRouter ist ausgelastet. Bitte erneut versuchen.'})[response.status] || 'OpenRouter konnte die Anfrage nicht beantworten.'},502);
  const answer = (await response.json()).choices?.[0]?.message?.content;
  return typeof answer==='string' && answer.trim() ? json({answer}) : json({error:'OpenRouter lieferte eine leere Antwort.'},502);
}
export default {async fetch(request,env) {
  try {return await handle(request,env);} catch {return json({error:'Server-Verbindung fehlgeschlagen. Bitte erneut versuchen.'},503);}
}};
