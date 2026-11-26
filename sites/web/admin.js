for (const section of document.querySelectorAll('[data-endpoint]')) {
  const form=section.querySelector('form');
  const input=form.querySelector('input');
  const remove=section.querySelector('[data-remove]');
  async function update(method,body) {
    form.querySelector('button').disabled=true;
    remove.disabled=true;
    const result=section.querySelector('[data-result]');
    result.textContent='';
    try {
      const response=await fetch(section.dataset.endpoint,{method,headers:{'Content-Type':'application/json'},body});
      const data=await response.json();
      if (!response.ok) throw Error(data.error);
      section.querySelector('[data-state]').textContent=data.configured?'Ein Key ist für dein Konto hinterlegt.':'Für dein Konto ist noch kein Key hinterlegt.';
      remove.hidden=!data.configured;
      if(method==='PUT') {input.value='';result.textContent=section.dataset.endpoint==='/api/key'?'Key geprüft und gespeichert.':'Key gespeichert. OpenAI prüft den Zugriff beim Gesprächsstart.';}
      if(method==='DELETE') result.textContent='Key entfernt.';
    } catch(error) {result.textContent=error.message || 'Verbindung fehlgeschlagen.';}
    finally {form.querySelector('button').disabled=false;remove.disabled=false;}
  }
  form.onsubmit=event=>{event.preventDefault();update('PUT',JSON.stringify({key:input.value.trim()}));};
  remove.onclick=()=>update('DELETE');
  update('GET');
}
