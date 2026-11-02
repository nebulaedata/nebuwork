// Handle both live engine events and replayed text tool payloads.
export function evidenceLinks(tool) {
  const found=new Map();let visited=0;
  const walk=value=>{
    if(++visited>10000)return;
    if(typeof value==='string'&&value.length<1024*1024){try{walk(JSON.parse(value));}catch{}return;}
    if(!value||typeof value!=='object')return;
    if(typeof value.evidenceId==='string'&&/^ke_[a-zA-Z0-9_-]+$/.test(value.evidenceId))found.set(value.evidenceId,value);
    Object.values(value).forEach(walk);
  };
  walk(tool.result);walk(tool.output);return [...found.values()];
}
