// Pendências pertencem ao usuário e à API. Tokens nunca são persistidos aqui.
(function () {
  'use strict';
  function create({ user, call, api, notify = () => {} }) {
    let database;
    const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'op-'+Date.now()+'-'+Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);
    const owner = () => { const u=user(); if (!u?.id) throw new Error('Entre novamente para recuperar seus envios.'); return api+'|'+u.id; };
    const open = () => database ||= new Promise((resolve,reject) => {
      if (!window.indexedDB) return reject(new Error('Este navegador não permite guardar pendências. Mantenha a tela aberta.'));
      const req=indexedDB.open('sgm-outbox-v1',1);
      req.onupgradeneeded=()=>{ const store=req.result.createObjectStore('operations',{keyPath:'id'}); store.createIndex('owner','owner'); };
      req.onerror=()=>reject(req.error); req.onblocked=()=>reject(new Error('Feche outras abas antigas do SGM e tente novamente.'));
      req.onsuccess=()=>{req.result.onversionchange=()=>{req.result.close();database=null;};resolve(req.result);};
    });
    async function access(mode, fn) {
      const db=await open();
      return new Promise((resolve,reject)=>{
        let tx; try {tx=db.transaction('operations',mode,{durability:'strict'});} catch(_){tx=db.transaction('operations',mode);}
        let request;
        try {request=fn(tx.objectStore('operations'));} catch(e){tx.abort();reject(e);return;}
        tx.oncomplete=()=>resolve(request?.result);
        tx.onerror=tx.onabort=()=>reject(tx.error||new Error('Não foi possível guardar o envio neste aparelho. Mantenha esta tela aberta.'));
      });
    }
    const list = (who=owner()) => access('readonly',s=>s.index('owner').getAll(who));
    const put = row => access('readwrite',s=>s.put(row));
    async function enqueue(candidate) {
      const db=await open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('operations','readwrite'),store=tx.objectStore('operations');
        const req=store.index('owner').getAll(candidate.owner); let row;
        req.onsuccess=()=>{
          row=req.result.find(x=>x.entity===candidate.entity && x.method===candidate.method && x.path===candidate.path && x.fingerprint===candidate.fingerprint) || candidate;
          store.put(row);
        };
        tx.oncomplete=()=>resolve(row); tx.onerror=tx.onabort=()=>reject(tx.error);
      });
    }
    async function lease(who, token, release=false) {
      const db=await open();
      return new Promise((resolve,reject)=>{
        const tx=db.transaction('operations','readwrite'), store=tx.objectStore('operations');
        const req=store.get('lease|'+who); let obtained=false;
        req.onsuccess=()=>{
          const current=req.result;
          if (release==='renew') { if(current?.token===token)store.put({...current,until:Date.now()+90000}); }
          else if (release) { if (current?.token===token) store.delete('lease|'+who); }
          else if (!current || current.until<Date.now()) {obtained=true;store.put({id:'lease|'+who,token,until:Date.now()+90000});}
        };
        tx.oncomplete=()=>resolve(obtained); tx.onerror=tx.onabort=()=>reject(tx.error);
      });
    }
    async function locked(who, task) {
      const token=uuid();
      if (!await lease(who,token)) throw Object.assign(new Error('Outro envio está em andamento. Sua pendência continua guardada.'),{transient:true});
      const renewal=setInterval(()=>lease(who,token,'renew').catch(()=>{}),20000);
      try {return await task();} finally {clearInterval(renewal);await lease(who,token,true);}
    }
    function announce(state,row,message) { notify({state,id:row?.id,entity:row?.entity,message}); }
    async function transmit(row) {
      if (owner()!==row.owner) throw new Error('Esta pendência pertence a outra sessão.');
      row.state='sending'; row.attempts=(row.attempts||0)+1; await put(row);
      announce('sending',row,'Enviando ao servidor…');
      try {
        const response=await call(row.method,row.path,row.body,{operationId:row.id});
        // Se a limpeza local falhar, o recibo do servidor torna a repetição segura.
        await access('readwrite',s=>s.delete(row.id));
        if(!user() || owner()!==row.owner)return response;
        announce('confirmed',row,'Confirmado no servidor');
        window.dispatchEvent(new CustomEvent('sgm:confirmed',{detail:{entity:row.entity,response}}));
        return response;
      } catch(error) {
        row.state=error.transient?'pending':error.status===401?'auth':'review';
        row.error=error.message;
        row.nextAttempt=Date.now()+Math.max(error.retryAfter||0,Math.min(60000,2000*Math.pow(2,Math.min(row.attempts,5)))+Math.random()*1000);
        await put(row);
        announce(row.state,row,'Pendente: '+error.message);
        error.pending=true; throw error;
      }
    }
    async function submit(method,path,body,entity) {
      const who=owner();
      const snapshot=JSON.parse(JSON.stringify(body));
      const fingerprint=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(snapshot))))).map(n=>n.toString(16).padStart(2,'0')).join('');
      // Guardar ANTES de disputar a rede: outro upload nunca impede o rascunho.
      const row=await enqueue({id:uuid(),owner:who,entity,method,path,body:snapshot,fingerprint,createdAt:Date.now(),state:'pending',attempts:0});
      announce('pending',row,'Guardado neste aparelho; aguardando confirmação');
      return locked(who,async()=>{
        const first=(await list(who)).filter(x=>x.entity===entity).sort((a,b)=>a.createdAt-b.createdAt)[0];
        if (first?.id!==row.id) throw Object.assign(new Error('Alteração guardada. Confirme o envio anterior deste item em “Envios pendentes”.'),{pending:true});
        return transmit(row);
      });
    }
    let replaying=false;
    async function retry(force=false) {
      if (replaying || !user()) return;
      replaying=true;
      try {
        const who=owner();
        await locked(who,async()=>{
          const rows=(await list(who)).sort((a,b)=>a.createdAt-b.createdAt);
          const blocked=new Set();
          for (const row of rows) {
            if (owner()!==who) break;
            if(blocked.has(row.entity))continue;
            if (row.state==='review' || (!force && (row.state==='auth' || row.nextAttempt>Date.now()))) {blocked.add(row.entity);continue;}
            try {await transmit(row);} catch(e){blocked.add(row.entity);if (e.status===401 || e.transient) break;}
          }
        });
      } catch(e) { if (!e.transient) notify({state:'error',message:e.message}); }
      finally {replaying=false;}
    }
    async function discard(id) {
      const who=owner();
      return locked(who,async()=>{
        const row=await access('readonly',s=>s.get(id));
        if (row?.owner===who) await access('readwrite',s=>s.delete(id));
      });
    }
    return {submit,list,retry,discard};
  }
  window.SGMOutbox={create};
})();
