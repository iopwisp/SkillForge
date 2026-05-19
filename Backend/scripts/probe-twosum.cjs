const API = 'https://skillforge-47py.onrender.com';
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
async function api(path, init={}){
  const res = await fetch(API+path,{...init, headers:{'Content-Type':'application/json',...(init.headers||{})}, body: init.body?JSON.stringify(init.body):undefined});
  let body; try{body=await res.json()}catch{body=null}
  return {status:res.status, body};
}
(async()=>{
  const u = `probe2_${Date.now()}`;
  const reg = await api('/api/auth/register',{method:'POST',body:{username:u,email:`${u}@probe.local`,password:'probe-password-123'}});
  console.log('reg status', reg.status, 'body keys:', Object.keys(reg.body||{}).join(','));
  if (!reg.body?.accessToken) {
    console.log('reg failed:', JSON.stringify(reg.body));
    return;
  }
  const token = reg.body.accessToken;

  // EXACT code from screenshot — function declared but body empty
  const code = `var twoSum = function(nums, target) {\n};\n`;
  console.log('Submitting:', code);
  const submit = await api('/api/submissions/two-sum',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:{code,language:'JAVASCRIPT'}});
  console.log('submit status', submit.status);
  console.log('submit body', JSON.stringify(submit.body, null, 2));
  if (!submit.body?.id) return;
  for (let i=0;i<60;i++){
    await sleep(1000);
    const r = await api(`/api/submissions/${submit.body.id}`,{headers:{Authorization:`Bearer ${token}`}});
    if (r.body?.status && r.body.status!=='PENDING'){
      console.log('FINAL:',JSON.stringify(r.body,null,2));
      console.log(r.body.status==='ACCEPTED'?'❌ EMPTY-FUNCTION-BODY BUG':'✅ correct');
      return;
    }
    process.stdout.write('.');
  }
})();
