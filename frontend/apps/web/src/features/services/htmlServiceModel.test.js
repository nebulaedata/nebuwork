import { expect, it } from 'vitest';
import { initialHtmlResources, isHtmlArtifact, mergeHtmlPage, suggestHtmlResources, validateHtmlResources } from './htmlServiceModel.js';
const entry = { id:'entry',version:2,name:'index.html',size:100,sessionId:'task',source:{path:'report/index.html'} };
it('matches persisted relative resources recursively and does not select ambiguous or other-task files',async()=>{
  const items=[entry,{id:'css',name:'style.css',version:3,size:50,sessionId:'task',source:{path:'report/assets/style.css'}},{id:'img',name:'a.svg',version:4,size:20,sessionId:'task',source:{path:'report/img/a.svg'}},{id:'other',name:'other.js',version:1,size:10,sessionId:'elsewhere',source:{path:'report/other.js'}}];
  const initial=initialHtmlResources(entry,items);
  const texts={entry:'<link href="assets/style.css"><script src="other.js"></script>',css:'body{background:url(../img/a.svg)}',img:''};
  const rows=await suggestHtmlResources(entry,initial.entryPath,initial.resources,async f=>texts[f.id],()=>true);
  expect(rows.filter(r=>r.selected).map(r=>r.id)).toEqual(['css','img']);
  expect(validateHtmlResources(initial.entryPath,rows,entry)).toEqual([{path:'assets/style.css',artifactId:'css',version:3},{path:'img/a.svg',artifactId:'img',version:4}]);
});
it('rejects duplicate and escaping paths and preserves unrelated service definitions',()=>{
  expect(()=>validateHtmlResources('index.html',[{id:'bad',version:1,size:1,path:'../bad.js',selected:true}],entry)).toThrow('相对路径');
  expect(()=>validateHtmlResources('index.html',[{id:'bad',version:1,size:1,path:'index.html',selected:true}],entry)).toThrow('重复');
  const original={name:'existing',capabilities:[{key:'api'}],pages:[{key:'old',assetId:'asset'}]},page={key:'report',assetId:'new'};
  expect(mergeHtmlPage(original,page,false)).toEqual({...original,pages:[...original.pages,page]});expect(original.pages).toHaveLength(1);
  expect(()=>mergeHtmlPage(original,{key:'old'},false)).toThrow('已存在');expect(mergeHtmlPage(original,{key:'old',assetId:'new'},true).pages).toEqual([{key:'old',assetId:'new'}]);
  expect(isHtmlArtifact({name:'REPORT.HTM'})).toBe(true);expect(isHtmlArtifact({name:'report.json'})).toBe(false);
  expect(isHtmlArtifact({name:'报告',source:{path:'report/index.html'}})).toBe(true);
  expect(initialHtmlResources(entry,[{id:'js',name:'页面脚本',source:{path:'report/main.js'}}]).resources[0].path).toBe('main.js');
});
