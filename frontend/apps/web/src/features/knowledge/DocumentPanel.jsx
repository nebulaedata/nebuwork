import React from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { SourceReader } from './SourceReader.jsx';

export function DocumentPanel({source,transport,parentSignal,onNavigate,onClose,expanded,onExpand}) {
  return <aside className="kw-document-panel" aria-label="文档原文详情"><header className="kw-document-panel-heading"><h2 title={source.title||source.documentId}>{source.title||source.documentId}</h2>{onExpand&&<button className="kw-icon-button" aria-label={expanded?'还原预览大小':'展开原文预览'} onClick={onExpand}>{expanded?<Minimize2 size={17}/>:<Maximize2 size={17}/>}</button>}<button className="kw-icon-button" aria-label="关闭原文详情" onClick={onClose}><X size={18}/></button></header><SourceReader key={source.documentId+':'+(source.chunkId||'')} source={source} transport={transport} parentSignal={parentSignal} onNavigate={onNavigate} presentation="document"/></aside>;
}
