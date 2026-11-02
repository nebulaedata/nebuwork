import { parseSourceLocators, findTextMatches, findInText } from './sourceLocator';
import { findTextRange, highlightRanges, highlightElements, rangeForOffsets, scrollRectIntoContainer } from './sourceLocatorDom';
import { resolvePreviewKind, sniffPreview } from './filePreview';
import { renderTaskMarkdown } from '../../tasks/markdown.js';

// Every renderer owns its DOM, resources and cancellation. Source HTML is never
// inserted into the app origin; the same locator contract is used by all formats.
export async function renderSource(root, blob, { fileName = '', fileType = '', request: suppliedRequest, cancelled = () => false, onStatus = () => {}, remoteUrl = '', signal, renderMarkdown = renderTaskMarkdown }) {
  const request={locators:[],quotes:[],...suppliedRequest};
  const cleanup = [], urls = [];
  const dispose = () => { cleanup.splice(0).reverse().forEach(fn => { try { fn(); } catch {} });urls.splice(0).forEach(URL.revokeObjectURL);root.replaceChildren(); };
  if(signal?.aborted)return dispose;
  signal?.addEventListener('abort',dispose,{once:true});cleanup.push(()=>signal?.removeEventListener('abort',dispose));
  const live = () => !signal?.aborted && !cancelled() && root.isConnected;
  const url = value => { const result=URL.createObjectURL(value);urls.push(result);return result; };
  const status = value => { if(live())onStatus(value); };
  const locators = parseSourceLocators(request.locators), exact = locators.filter(l=>l.mapping==='exact'&&!l.partial);
  let kind=resolvePreviewKind((fileType||fileName.split('.').pop()||'').toLowerCase());
  if(kind==='unsupported'&&blob){const detected=sniffPreview(new Uint8Array(await blob.slice(0,8192).arrayBuffer()));kind=detected?.kind||kind;}
  root.replaceChildren();
  const reveal = target => { if(live()&&target)scrollRectIntoContainer(root,target.getBoundingClientRect()); };
  const mark = (ranges, elements=[]) => { if(ranges.length)cleanup.push(highlightRanges(ranges));if(elements.length)cleanup.push(highlightElements(elements));reveal(ranges[0]||elements[0]); };
  const quote = container => {
    let ambiguous=false;
    for(const text of request.scope?[request.scope]:request.quotes){if(!text)continue;const matches=findTextMatches(container.textContent||'',text);if(matches.length>1){ambiguous=true;continue;}const range=findTextRange(container,text);if(range){mark([range]);return true;}}
    status(ambiguous?'ambiguous':'missing');return false;
  };
  const locate = (regions=[]) => {
    if(!live())return;
    if(request.unavailable){status('unavailable');return;}
    if(!request.quotes.length&&!locators.length){status('none');return;}
    if(regions.length){const ranges=[];for(const region of regions){const range=findTextRange(region,request.scope||request.quotes[0]||'');if(range)ranges.push(range);}mark(ranges,ranges.length?[]:regions);status(locators.some(l=>l.partial)?'partial':ranges.length?'precise':'structural');return;}
    if(quote(root))status(locators.some(l=>l.partial)?'partial':'precise');
  };
  const safeHTML = async (container, html) => {
    const { default: purify }=await import('dompurify');if(!live())return;
    container.innerHTML=purify.sanitize(html,{FORBID_TAGS:['script','iframe','object','embed','form','style'],FORBID_ATTR:['srcset','formaction']});
    container.querySelectorAll('[src],[href]').forEach(el=>{for(const attr of ['src','href']){const raw=el.getAttribute(attr);if(raw&&!raw.startsWith('blob:')&&!raw.startsWith('data:image/')&&!raw.startsWith('#'))el.removeAttribute(attr);}});
  };
  try {
    if(kind==='pdf'){
      const lib=await import('pdfjs-dist'),worker=await import('pdfjs-dist/build/pdf.worker.min.mjs?url');if(!live())return dispose;
      // Invalidate responses cached before the static server's module MIME fix.
      lib.GlobalWorkerOptions.workerSrc=worker.default+'?module=1';
      const loading=lib.getDocument({...remoteUrl?{url:remoteUrl,rangeChunkSize:1048576,disableAutoFetch:true,disableStream:true}:{data:new Uint8Array(await blob.arrayBuffer())},isEvalSupported:false,enableXfa:false});cleanup.push(()=>loading.destroy());const pdf=await loading.promise;if(!live())return dispose;
      const pages=new Map(),rendered=new Map(),renderTasks=new Set();let observer;
      cleanup.push(()=>{observer?.disconnect();renderTasks.forEach(task=>task.cancel());});
      const text = async number => {const p=await pdf.getPage(number);return (await p.getTextContent()).items.map(item=>item.str||'').join(' ');};
      const render = async number => {
        if(rendered.has(number))return rendered.get(number);
        const promise=(async()=>{const page=await pdf.getPage(number);if(!pages.has(number))addPage(number);const el=pages.get(number);if(!live()||!el)return;
          const scale=Math.min(1.5,Math.max(.4,(root.clientWidth-40)/page.getViewport({scale:1}).width)),viewport=page.getViewport({scale});
          el.style.width=viewport.width+'px';el.style.height=viewport.height+'px';el.style.setProperty('--total-scale-factor',String(scale));
          const canvas=document.createElement('canvas'),ratio=Math.min(devicePixelRatio||1,2);canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';el.append(canvas);
          const task=page.render({canvas,viewport,transform:ratio===1?undefined:[ratio,0,0,ratio,0,0]});renderTasks.add(task);await task.promise;renderTasks.delete(task);if(!live())return;
          const layer=document.createElement('div');layer.className='textLayer';el.append(layer);const t=new lib.TextLayer({textContentSource:page.streamTextContent(),container:layer,viewport});cleanup.push(()=>t.cancel());await t.render();
        })();rendered.set(number,promise);return promise;
      };
      const addPage=number=>{const el=document.createElement('section');el.className='knowledge-pdf-page';el.dataset.page=String(number);el.style.height='900px';el.style.width='640px';el.setAttribute('aria-label','第 '+number+' 页');root.append(el);pages.set(number,el);};
      for(let number=1;number<=(remoteUrl?1:pdf.numPages);number++)addPage(number);
      if(remoteUrl){const nav=document.createElement('nav'),previous=document.createElement('button'),next=document.createElement('button'),input=document.createElement('input'),label=document.createElement('span');nav.className='document-preview-pages';input.type='number';input.min='1';input.max=String(pdf.numPages);input.value='1';input.setAttribute('aria-label','PDF 页码');label.textContent=` / ${pdf.numPages} 页`;previous.textContent='上一页';next.textContent='下一页';const show=async n=>{n=Math.max(1,Math.min(pdf.numPages,n));if(!live())return;input.value=String(n);for(const [old,el] of pages)if(Math.abs(old-n)>1){el.remove();pages.delete(old);rendered.delete(old);void pdf.getPage(old).then(p=>p.cleanup());}await render(n);reveal(pages.get(n));};const navigate=n=>void show(n).catch(e=>{if(live())status("页面读取失败："+e.message);});previous.onclick=()=>navigate(Number(input.value)-1);next.onclick=()=>navigate(Number(input.value)+1);input.onchange=()=>navigate(Number(input.value)||1);nav.append(previous,input,label,next);root.prepend(nav);}
      observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting)void render(Number(entry.target.dataset.page)).catch(e=>{if(live())status('页面渲染失败：'+e.message);});},{root,rootMargin:'600px'});pages.forEach(el=>observer.observe(el));
      if(request.unavailable)status('unavailable');else if(request.quotes.length||locators.length){const {resolvePdfSource}=await import('./pdfSourceLocate');const resolution=request.pdfResolution||await resolvePdfSource(request,pdf.numPages,text,()=>!live());if(!live())return dispose;
        const ranges=[],regions=[];for(const target of resolution.targets){await render(target.page);if(!live())return dispose;const el=pages.get(target.page);
          if(target.bbox){const box=document.createElement('div');box.className='knowledge-source-box';const[x0,y0,x1,y1]=target.bbox;Object.assign(box.style,{left:x0*100+'%',top:y0*100+'%',width:(x1-x0)*100+'%',height:(y1-y0)*100+'%'});el.append(box);regions.push(box);}
          else {const range=target.quote?findTextRange(el.querySelector('.textLayer'),target.quote):null;if(range)ranges.push(range);else regions.push(el);}}
        if(remoteUrl&&resolution.targets[0]){const pageInput=root.querySelector('.document-preview-pages input');if(pageInput)pageInput.value=String(resolution.targets[0].page);}
        mark(ranges,regions);status(resolution.reason|| (ranges.length?'precise':regions.length?'structural':'missing'));
      }else status('none');
      await render(1);
    } else if(kind==='docx'){
      const {renderAsync}=await import('docx-preview');if(!live())return dispose;
      await renderAsync(blob,root,undefined,{className:'knowledge-docx',inWrapper:true,breakPages:true,useBase64URL:true});if(!live())return dispose;
      const {indexEmbeddedSourceImages}=await import('./sourceImage');await indexEmbeddedSourceImages(root);if(!live())return dispose;
      const blocks=[...root.querySelectorAll('section > article')].flatMap(article=>[...article.children].filter(el=>['P','TABLE'].includes(el.tagName)));
      const images=request.imageDigest?[...root.querySelectorAll('img')].filter(image=>image.dataset.sourceImageDigest===request.imageDigest):[];
      if(request.imageDigest&&images.length===1&&!request.unavailable){mark([],images);status('structural');}else locate(exact.filter(l=>l.type==='docx'&&l.block).map(l=>blocks[l.block-1]).filter(Boolean));
    } else if(kind==='pptx'){
      const [{init},{preparePptxPreview}]=await Promise.all([import('pptx-preview'),import('./pptxPreview')]);
      const prepared=await preparePptxPreview(await blob.arrayBuffer());if(!live())return dispose;
      const host=document.createElement('div');root.append(host);const viewer=init(host,{width:960,height:540,mode:'list'});cleanup.push(()=>viewer.destroy());
      const resize=()=>{if(live())host.style.zoom=String(Math.min(1,Math.max(.15,(root.clientWidth-24)/960)));};resize();if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(resize);observer.observe(root);cleanup.push(()=>observer.disconnect());}
      await viewer.preview(prepared.data);if(!live())return dispose;
      const slides=[...host.querySelectorAll('.pptx-preview-slide-wrapper')];if(viewer.slideCount!==prepared.slideCount||slides.length!==prepared.slideCount)throw new Error('幻灯片预览不完整，请尝试后台预览或下载');
      locate(exact.filter(l=>l.type==='slide').map(l=>slides[l.slide-1]).filter(Boolean));
    } else if(kind==='excel'){
      const XLSX=await import('xlsx'),bytes=await blob.arrayBuffer();if(!live())return dispose;
      const csv=/^(csv|tsv|tab)$/i.test(fileType||fileName.split('.').pop());let input=bytes;
      if(csv){try{input=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{input=new TextDecoder('gbk').decode(bytes);}}
      const book=XLSX.read(input,{type:csv?'string':'array',sheetRows:1001,...(/\.(tsv|tab)$/i.test(fileName)?{FS:'\t'}:{})});
      for(const name of book.SheetNames){const sheet=book.Sheets[name],ref=sheet['!fullref']||sheet['!ref'];if(ref){const range=XLSX.utils.decode_range(ref);if(range.e.r>999||(range.e.r-range.s.r+1)*(range.e.c-range.s.c+1)>100000)throw new Error('表格数据较多，请使用后台分页预览');}}
      const targets=[];
      for(let index=0;index<book.SheetNames.length;index++){if(!live())return dispose;const name=book.SheetNames[index],section=document.createElement('section'),heading=document.createElement('h4');section.dataset.sheet=name;heading.textContent=name;section.append(heading);root.append(section);const table=document.createElement('div');section.append(table);await safeHTML(table,XLSX.utils.sheet_to_html(book.Sheets[name],{id:'knowledge-sheet-'+index}));
        for(const loc of exact.filter(l=>l.type==='sheet'&&l.sheet===name)){for(const cell of table.querySelectorAll('td[id]')){const row=/-[A-Z]+(\d+)$/.exec(cell.id);if(row&&Number(row[1])>=loc.row_start&&Number(row[1])<=Math.min(loc.row_end||loc.row_start,loc.row_start+200)){const tr=cell.closest('tr');if(tr&&!targets.includes(tr))targets.push(tr);}}}}
      locate(targets);
    } else if(kind==='epub'){
      const {renderEpubPreview}=await import('./epubPreview');const epub=await renderEpubPreview(await blob.arrayBuffer());urls.push(...epub.objectUrls);if(!live())return dispose;await safeHTML(root,epub.html);locate(exact.filter(l=>l.type==='section').map(l=>root.querySelector(`[data-epub-section="${l.section}"]`)).filter(Boolean));
    } else if(kind==='image'){
      const image=document.createElement('img');image.alt=fileName||'来源图片';image.className='knowledge-source-image';image.src=url(blob);root.append(image);status(request.unavailable?'unavailable':'structural');
    } else if(kind==='audio'||kind==='video'){
      const media=document.createElement(kind);media.controls=true;media.src=url(blob);root.append(media);const time=exact.find(l=>l.type==='time');if(time&&!request.unavailable){const seek=()=>{if(live()){media.currentTime=(time.start_ms||0)/1000;status(`已定位到 ${((time.start_ms||0)/1000).toFixed(1)}–${((time.end_ms||0)/1000).toFixed(1)} 秒`);}};media.addEventListener('loadedmetadata',seek,{once:true});cleanup.push(()=>media.pause());}else status(request.unavailable?'unavailable':'none');
    } else if(kind==='html'){
      const text=await blob.text();if(!live())return dispose;
      const tabs=document.createElement('div'),button=document.createElement('button'),frame=document.createElement('iframe'),code=document.createElement('pre');button.textContent='显示源码与定位';code.textContent=text;code.hidden=true;frame.setAttribute('sandbox','');frame.title='原始 HTML 预览';frame.srcdoc=`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'">`+text;tabs.append(button);root.append(tabs,frame,code);button.onclick=()=>{code.hidden=!code.hidden;frame.hidden=!frame.hidden;if(!code.hidden)locate();};status('HTML 已在隔离预览中打开，可切换源码定位');
    } else if(['text','markdown','mermaid'].includes(kind)){
      const text=await blob.text();if(!live())return dispose;
      if(kind==='markdown')await safeHTML(root,renderMarkdown(text));else{const code=document.createElement('pre');code.textContent=text;root.append(code);}
      const offsets=!request.unavailable&&kind==='text'?locators.filter(l=>l.type==='text'&&!l.partial).map(l=>{const range=rangeForOffsets(root,l.start||0,l.end||0);return range&&l.quote&&findInText(range.toString(),l.quote)?range:null;}):[];
      if(offsets.length&&offsets.every(Boolean)){mark(offsets);status('precise');}else locate();
    } else {root.textContent='此格式暂不支持浏览器预览，请下载原文件；解析正文仍可阅读。';status('none');}
    return dispose;
  }catch(error){dispose();throw error;}
}
