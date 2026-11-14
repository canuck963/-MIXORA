const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync('reset-password.html','utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
function page(search,fetch){
 const elements=Object.fromEntries(['reset','confirm','password','result'].map(id=>[id,{disabled:false,value:'new-safe-password',textContent:'',attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];},reportValidity(){return true;},addEventListener(_,fn){this.submit=fn;}}]));
 const history=[];
 vm.runInNewContext(script,{URLSearchParams,location:{search,pathname:'/api/reset-password'},history:{replaceState(...args){history.push(args);}},document:{getElementById:id=>elements[id]},fetch});
 return {...elements,history,submit:()=>elements.reset.submit({preventDefault(){}})};
}
test('missing or oversized token prevents requests and is removed from URL',async()=>{
 for(const query of ['', '?token='+ 'a'.repeat(257)]){
  const p=page(query,()=>assert.fail('unexpected request'));await p.submit();
  assert.equal(p.confirm.disabled,true);assert.equal(p.password.disabled,true);assert.equal(p.history[0][2],'/api/reset-password');
 }
});
test('pending request blocks duplicate submissions; success clears credentials',async()=>{
 let finish,calls=0;
 const p=page('?token=secret',(_,options)=>{calls++;assert.deepEqual(JSON.parse(options.body),{token:'secret',password:'new-safe-password'});return new Promise(resolve=>finish=resolve);});
 const pending=p.submit();await p.submit();assert.equal(calls,1);assert.equal(p.reset.attributes['aria-busy'],'true');
 finish({ok:true,json:async()=>({ok:true})});await pending;
 assert.equal(p.confirm.disabled,true);assert.equal(p.password.value,'');assert.equal(p.reset.attributes['aria-busy'],undefined);
 await p.submit();assert.equal(calls,1);
});
test('network, non-JSON and API errors allow retry without losing token',async()=>{
 let attempt=0;
 const p=page('?token=retry-token',async(_,options)=>{
  assert.equal(JSON.parse(options.body).token,'retry-token');attempt++;
  if(attempt===1)throw Error('offline');
  if(attempt===2)return {ok:false,json:async()=>{throw Error('proxy HTML');}};
  if(attempt===3)return {ok:false,json:async()=>({error:'Sıfırlama bağlantısı geçersiz veya süresi dolmuş.'})};
  return {ok:true,json:async()=>({ok:true})};
 });
 for(let i=0;i<3;i++){await p.submit();assert.equal(p.confirm.disabled,false);assert.equal(p.password.disabled,false);assert.equal(p.reset.attributes['aria-busy'],undefined);}
 assert.match(p.result.textContent,/geçersiz/);await p.submit();assert.match(p.result.textContent,/değiştirildi/);
});
