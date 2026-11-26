(() => {
  const button = $('live-voice');
  const info = $('voice-info');
  let active;
  let configured = false;

  async function refresh() {
    try {
      const response = await fetch('/api/openai-key');
      if (!response.ok) throw Error();
      configured = (await response.json()).configured;
      info.textContent = configured ? 'Mikrofon bereit für OpenAI Realtime.' : 'Für Sprachgespräche den OpenAI-Key unter «Admin» hinterlegen.';
    } catch {
      configured = false;
      info.textContent = 'OpenAI-Key-Status konnte nicht geladen werden.';
    }
    button.disabled = !configured;
  }

  function stop(note) {
    if (!active) return;
    const call = active;
    active = null;
    call.controller.abort();
    clearTimeout(call.timeout);
    call.peer?.close();
    call.stream?.getTracks().forEach(track => track.stop());
    call.audio.pause();
    call.audio.srcObject = null;
    button.textContent = 'Sprachgespräch starten';
    $('voice-button').disabled = false;
    info.textContent = note;
    status(note);
  }

  async function start() {
    if (active) return stop('Sprachgespräch beendet.');
    if (!configured) return;
    stopSpeech();
    const call = {audio:new Audio(), controller:new AbortController()};
    active = call;
    button.textContent = 'Gespräch beenden';
    $('voice-button').disabled = true;
    info.textContent = 'Bitte Mikrofonzugriff erlauben.';
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) throw Error('Dieser Browser unterstützt den Mikrofonzugriff über WebRTC nicht.');
      const stream = await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true}});
      if (active !== call) {stream.getTracks().forEach(track=>track.stop());return;}
      call.stream = stream;
      info.textContent = 'Verbindung mit OpenAI wird aufgebaut …';
      call.timeout = setTimeout(()=>{if(active===call)stop('Verbindungsaufbau dauerte zu lange. Bitte erneut versuchen.');},35000);
      const peer = call.peer = new RTCPeerConnection();
      stream.getAudioTracks().forEach(track => peer.addTrack(track,stream));
      peer.ontrack = event => {
        if (active !== call) return;
        call.audio.srcObject = event.streams[0] || new MediaStream([event.track]);
        call.audio.play().catch(()=>{if(active===call)stop('Audiowiedergabe blockiert. Bitte erneut starten.');});
      };
      peer.onconnectionstatechange = () => {
        if (active===call && ['failed','disconnected'].includes(peer.connectionState)) stop('Sprachverbindung unterbrochen.');
      };
      const channel = peer.createDataChannel('avatar-events');
      channel.onopen = () => {
        if (active!==call) return;
        clearTimeout(call.timeout);
        info.textContent = 'Verbunden. Du kannst sprechen und den Avatar unterbrechen.';
        status('Ich höre zu …','listening');
      };
      channel.onclose = () => {if(active===call)stop('Sprachgespräch beendet.');};
      channel.onmessage = event => {
        if(active!==call)return;
        let data;
        try {data=JSON.parse(event.data);} catch {return;}
        if(data.type==='input_audio_buffer.speech_started')status('Ich höre zu …','listening');
        if(data.type==='output_audio_buffer.started')status('Avatar spricht …','speaking');
        if(data.type==='output_audio_buffer.stopped')status('Ich höre zu …','listening');
        if(data.type==='error' || (data.type==='response.done' && data.response?.status==='failed'))stop('OpenAI konnte die Sprachantwort nicht abschliessen. Bitte Zugriff und Guthaben prüfen.');
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (active!==call) return;
      const profile = [config.name,config.description,config.personality,config.knowledge,config.mode==='knowledge'?'Antworte nur anhand des hinterlegten Wissens.':''].join('\n');
      const response = await fetch('/api/realtime/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sdp:offer.sdp,profile}),signal:call.controller.signal});
      const answer = await response.json();
      if (!response.ok) throw Error(answer.error || 'OpenAI-Verbindung fehlgeschlagen.');
      if (active===call) await peer.setRemoteDescription({type:'answer',sdp:answer.sdp});
    } catch (error) {
      if(active===call)stop(error.name==='NotAllowedError'?'Mikrofonzugriff blockiert. Bitte in den Browser-Einstellungen erlauben.':error.message || 'Sprachverbindung fehlgeschlagen.');
    }
  }
  button.addEventListener('click',start);
  $('configure-button').addEventListener('click',()=>stop('Sprachgespräch beendet.'));
  $('clear-button').addEventListener('click',()=>stop('Sprachgespräch beendet.'));
  window.addEventListener('pagehide',()=>stop('Sprachgespräch beendet.'));
  window.addEventListener('pageshow',event=>{if(event.persisted)refresh();});
  refresh();
})();
