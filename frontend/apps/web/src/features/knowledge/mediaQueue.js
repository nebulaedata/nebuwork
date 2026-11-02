// Keep thumbnail reads below Java's shared eight-request transport limit.
const queue=[];let active=0;
function pump(){
  while(active<4&&queue.length){const job=queue.shift();job.signal.removeEventListener('abort',job.abort);if(job.signal.aborted){job.reject(new DOMException('请求已取消','AbortError'));continue;}active++;Promise.resolve().then(job.work).then(job.resolve,job.reject).finally(()=>{active--;pump();});}
}
export function loadGalleryMedia(work,signal){
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new DOMException('请求已取消','AbortError'));return;}
    const job={work,signal,resolve,reject,abort:()=>{const at=queue.indexOf(job);if(at>=0){queue.splice(at,1);reject(new DOMException('请求已取消','AbortError'));}}};signal.addEventListener('abort',job.abort,{once:true});queue.push(job);pump();
  });
}
