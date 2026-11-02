import React from 'react';
import { Checkbox } from 'antd';
import { SlidersHorizontal, RotateCcw } from 'lucide-react';
import { KnowledgeSelect } from './KnowledgeControls.jsx';

const names={'caption':'图片描述','ocr_text':'OCR 文字','created_at':'创建时间','updated_at':'更新时间','is_enabled':'参与检索','contain.text':'图中文字','contain.data_visual':'数据图表'};
const labelOf=attr=>names[attr.name]||names[attr.id?.replace(/^(builtin|system):/,'')]||attr.label||attr.id;
function valueOf(attr,item) {
  const name=attr.name||attr.id;
  if(name.includes('is_enabled'))return item.value==='true'?'参与检索':'未参与检索';
  if(name.includes('contain.text'))return {none:'无',sparse:'少量',block:'成段'}[item.value]||item.label||item.value;
  return item.value==='true'?'是':item.value==='false'?'否':item.label||item.value;
}
export function GalleryFilters({supportsSorting=true,attributes,documents,sourceHasMore,onMoreSources,onSourceSearch,documentIds,filters,sort,order,searchIn,onChange,onReset}) {
  const filterCount=documentIds.length+Object.values(filters).filter(v=>v?.length).length+(sort?1:0)+(order!=='desc'?1:0)+searchIn.length;
  const searchFields=attributes.filter(a=>a.usage?.in_searchfield);
  return <section className="knowledge-gallery-filters" aria-label="图片筛选">
    <header className="knowledge-filter-heading"><span><SlidersHorizontal size={15}/>筛选条件{filterCount>0&&<small>{filterCount}</small>}</span><button className="knowledge-filter-reset" type="button" disabled={!filterCount} onClick={onReset}><RotateCcw size={13}/>重置筛选</button></header>
    <div className="knowledge-filter-grid">
      <div className="knowledge-filter-field knowledge-filter-source"><label htmlFor="knowledge-image-source">来源文档</label><KnowledgeSelect id="knowledge-image-source" aria-label="来源文档" mode="multiple" value={documentIds} options={documents.map(d=>({value:d.id,label:d.title||d.name||'未命名文档'}))} showSearch={{filterOption:false,onSearch:onSourceSearch}} onChange={documentIds=>onChange({documentIds})} placeholder="全部来源文档" allowClear maxTagCount="responsive"/>{sourceHasMore&&<button className="knowledge-filter-more" onClick={onMoreSources}>加载更多来源</button>}</div>
      {supportsSorting&&<><div className="knowledge-filter-field"><label htmlFor="knowledge-image-sort">排序方式</label><KnowledgeSelect id="knowledge-image-sort" aria-label="排序方式" value={sort} options={[{value:'',label:'默认排序'},...attributes.filter(a=>a.usage?.in_sortfield).map(a=>({value:a.id,label:labelOf(a)}))]} onChange={sort=>onChange({sort})}/></div>
      <div className="knowledge-filter-field"><label htmlFor="knowledge-image-order">排列顺序</label><KnowledgeSelect id="knowledge-image-order" aria-label="排列顺序" value={order} options={[{value:'desc',label:'降序'},{value:'asc',label:'升序'}]} onChange={order=>onChange({order})}/></div></>}
      {attributes.filter(a=>a.usage?.in_filter&&a.values?.length).map(attr=><div className="knowledge-filter-field" key={attr.id}><label htmlFor={'knowledge-filter-'+attr.id}>{labelOf(attr)}</label><KnowledgeSelect id={'knowledge-filter-'+attr.id} aria-label={labelOf(attr)} value={filters[attr.id]?.[0]||''} options={[{value:'',label:'全部'},...attr.values.map(item=>({value:item.value,label:valueOf(attr,item)}))]} onChange={value=>onChange({filters:{...filters,[attr.id]:value?[value]:undefined}})}/></div>)}
      {searchFields.length>0&&<fieldset className="knowledge-filter-field knowledge-filter-search-fields"><legend>搜索内容</legend><div className="knowledge-filter-checkboxes"><Checkbox.Group aria-label="搜索内容" value={searchIn} options={searchFields.map(a=>({value:a.id,label:labelOf(a)}))} onChange={searchIn=>onChange({searchIn})}/></div><small>未选择时搜索全部内容</small></fieldset>}
    </div>
  </section>;
}
