const $ = (id) => document.getElementById(id);
let avatar, available = false, busy = false, history = [], peer, channel, stream, remoteAudio, connecting = false, generation = 0;
let userTranscript = '', answerTranscript = '';
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `Anfrage fehlgeschlagen (${response.status})`);
  return data;
}
function status(text, state = 'ready') { $('status').textContent = text; $('avatar-stage').dataset.state = state; }
function message(text, role = 'assistant') {
  const el = document.createElement('article'); el.className = `message ${role}`;
  const label = document.createElement('div'); label.className = 'message-label'; label.textContent = role === 'user' ? 'DU' : role === 'error' ? 'HINWEIS' : avatar?.name || 'Avatar';
  const content = document.createElement('div'); content.className = 'message-text'; content.textContent = text;
  el.append(label, content); $('messages').append(el); $('messages').scrollTop = $('messages').scrollHeight;
}
function controls() {
  $('voice-button').disabled = !available || busy || connecting;
  $('send-button').disabled = !available || busy || connecting || !!peer;
  $('question').disabled = busy || connecting || !!peer;
  $('clear-button').disabled = busy || connecting;
}
function stopVoice(note = 'Gespräch beendet') {
  generation++; connecting = false;
  const oldPeer = peer; peer = null;
  channel?.close(); channel = null;
  oldPeer?.close(); stream?.getTracks().forEach(track => track.stop()); stream = null;
  if (remoteAudio) { remoteAudio.pause(); remoteAudio.srcObject = null; remoteAudio = null; }
  userTranscript = ''; answerTranscript = '';
  $('voice-button').textContent = 'Gespräch starten'; status(note); controls();
}
async function handleRealtime(event, session) {
  if (session !== generation) return;
  if (event.type === 'input_audio_buffer.speech_started') status('Ich höre zu …', 'listening');
  if (event.type === 'conversation.item.input_audio_transcription.completed') { userTranscript = event.transcript || ''; if (userTranscript) message(userTranscript, 'user'); }
  if (event.type === 'response.output_audio_transcript.delta' || event.type === 'response.audio_transcript.delta') { answerTranscript += event.delta || ''; status('Spricht …', 'speaking'); }
  if (event.type === 'response.output_audio_transcript.done' || event.type === 'response.audio_transcript.done') {
    const answer = event.transcript || answerTranscript;
    if (answer) { message(answer); if (userTranscript) history.push({question:userTranscript,answer}); }
    answerTranscript = ''; userTranscript = '';
  }
  if (event.type === 'response.function_call_arguments.done') {
    let output;
    try { const args = JSON.parse(event.arguments); output = await api('/api/rag', {query:args.query,limit:5}); }
    catch { output = {error:'Wissenssuche momentan nicht verfügbar. Keine Quellen erfinden.'}; }
    if (session !== generation || channel?.readyState !== 'open') return;
    channel.send(JSON.stringify({type:'conversation.item.create',item:{type:'function_call_output',call_id:event.call_id,output:JSON.stringify(output)}}));
    channel.send(JSON.stringify({type:'response.create'}));
  }
  if (event.type === 'response.done') {
    if (event.response?.status === 'failed') { message('Die Sprachantwort ist fehlgeschlagen. Bitte erneut versuchen.', 'error'); }
    status('Verbunden · Du kannst sprechen', 'listening');
  }
  if (event.type === 'error') { message(event.error?.message || 'Fehler in der Sprachverbindung.', 'error'); stopVoice('Sprachverbindung beendet'); }
}
async function startVoice() {
  if (peer) return stopVoice();
  connecting = true; controls(); status('Mikrofon und Verbindung werden vorbereitet …');
  const session = ++generation;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Mikrofon benötigt HTTPS oder localhost und einen unterstützten Browser.');
    const media = await navigator.mediaDevices.getUserMedia({audio:true});
    if (session !== generation) { media.getTracks().forEach(t=>t.stop()); return; }
    stream = media; peer = new RTCPeerConnection();
    remoteAudio = new Audio(); remoteAudio.autoplay = true;
    peer.ontrack = (event) => { if (session !== generation) return; remoteAudio.srcObject = event.streams[0]; remoteAudio.play().catch(() => { message('Die Audiowiedergabe wurde blockiert. Bitte das Gespräch erneut starten.', 'error'); stopVoice(); }); };
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    channel = peer.createDataChannel('avatar-events');
    channel.onmessage = (event) => { try { handleRealtime(JSON.parse(event.data), session).catch(() => { stopVoice('Verbindung unterbrochen'); }); } catch {} };
    channel.onopen = () => { if (session !== generation) return; connecting = false; $('voice-button').textContent = 'Gespräch beenden'; status('Verbunden · Du kannst sprechen', 'listening'); controls(); };
    channel.onclose = () => { if (session === generation && peer) stopVoice('Verbindung beendet · Erneut starten'); };
    peer.onconnectionstatechange = () => { if (session === generation && peer && ['failed','disconnected'].includes(peer.connectionState)) stopVoice('Verbindung unterbrochen · Erneut starten'); };
    const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
    const response = await fetch('/api/realtime/call', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sdp:offer.sdp,history:history.slice(-8)}),signal:AbortSignal.timeout(30000)});
    const answer = await response.text();
    if (!response.ok) throw new Error('Sprachverbindung fehlgeschlagen. Bitte API-Key, Modell und Verbindung prüfen.');
    if (session !== generation) return;
    await peer.setRemoteDescription({type:'answer',sdp:answer});
    setTimeout(() => { if (session === generation && connecting) stopVoice('Verbindungsaufbau dauerte zu lange. Bitte erneut starten.'); },15000);
  } catch (error) { if (session !== generation) return; stopVoice('Sprachverbindung nicht verfügbar'); message(error.message, 'error'); }
}
$('voice-button').addEventListener('click', startVoice);
$('chat-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const question = $('question').value.trim(); if (!question || busy || peer || !available) return;
  busy = true; controls(); $('question').value = ''; message(question,'user'); status('Denkt nach …','thinking');
  try { const result = await api('/api/avatar/text',{question,history:history.slice(-8)}); message(result.answer); history.push({question,answer:result.answer}); status('Bereit'); }
  catch (error) { message(error.message,'error'); status('Antwort fehlgeschlagen'); }
  finally { busy = false; controls(); $('question').focus(); }
});
$('question').addEventListener('keydown', event => { if(event.key==='Enter' && !event.shiftKey && !event.isComposing){event.preventDefault();$('chat-form').requestSubmit();} });
$('clear-button').addEventListener('click', () => { stopVoice('Bereit'); history = []; $('messages').replaceChildren(); message(avatar.greeting); });
window.addEventListener('pagehide', () => stopVoice());
(async () => {
  try {
    [avatar, health] = await Promise.all([api('/api/avatar'),api('/api/health')]);
    document.documentElement.style.setProperty('--accent',avatar.accent);
    $('avatar-name').textContent = avatar.name; document.title = `${avatar.name} · Avatar Studio`;
    $('avatar-description').textContent = avatar.description; $('avatar-initial').textContent = Array.from(avatar.name)[0];
    if (avatar.image) { $('avatar-image').src = avatar.image; $('avatar-image').alt = avatar.name; $('avatar-image').hidden = false; $('avatar-initial').hidden = true; }
    message(avatar.greeting); available = health.openaiConfigured;
    status(available ? 'Bereit für dein Gespräch' : 'Einrichtung erforderlich: OPENAI_API_KEY auf dem Server setzen.'); controls();
  } catch(error) { status(error.message); }
})();
let health;
