async function post(path, key, body, timeoutMs) {
  const result = await fetch('https://api.openai.com/v1/' + path,{
    method:'POST', headers:{Authorization:'Bearer ' + key,'Content-Type':'application/json'},
    body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs)
  });
  if (!result.ok) {
    const code='openai_http_' + result.status;
    throw Object.assign(new Error(code),{code,publicCode:code,status:502,
      rejectedBeforeGeneration:[400,401,403,404,422,429].includes(result.status)});
  }
  return result.json();
}
export const openai = {
  async image({key,model,prompt,size}) {
    const {data} = await post('images/generations',key,{model,prompt,size,n:1,output_format:'jpeg'},120000);
    if (!data?.[0]?.b64_json) throw new Error('image_provider_bytes_missing');
    return {bytes:Buffer.from(data[0].b64_json,'base64'),mime:'image/jpeg'};
  },
  async text({key,model,prompt}) {
    const data=await post('chat/completions',key,{
      model,messages:[{role:'user',content:prompt}],max_completion_tokens:1000
    },60000);
    return {text:data.choices?.[0]?.message?.content||'',usage:data.usage||null};
  }
};
