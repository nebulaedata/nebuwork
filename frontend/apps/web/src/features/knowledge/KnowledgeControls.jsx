import React, { useEffect, useState } from 'react';
import { ConfigProvider, Select, theme as antTheme } from 'antd';
import { selectTheme } from '../../shared/workbenchSelect.jsx';

const defined = values => Object.fromEntries(Object.entries(values).filter(([,value])=>value!==''&&value!=null));
function knowledgeTheme() {
  const theme=selectTheme();
  const tokens=getComputedStyle(document.documentElement),border=tokens.getPropertyValue('--border-strong').trim(),muted=tokens.getPropertyValue('--text-dim').trim();
  return { ...theme, algorithm:document.documentElement.dataset.theme==='dark'?antTheme.darkAlgorithm:antTheme.defaultAlgorithm,
    token:{...defined(theme.token),...defined({colorBorder:border}),controlHeight:40,controlHeightLG:40,borderRadius:8},
    components:{...theme.components,Select:defined(theme.components.Select),Checkbox:{...defined({colorBorder:muted}),borderRadiusSM:4}} };
}
export function KnowledgeControls({children}) {
  const [theme,setTheme]=useState(knowledgeTheme);
  useEffect(()=>{const observer=new MutationObserver(()=>setTheme(knowledgeTheme()));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme','style']});return()=>observer.disconnect();},[]);
  return <ConfigProvider theme={theme} componentSize="large">{children}</ConfigProvider>;
}
export function KnowledgeSelect(props) {
  return <Select className="knowledge-select" classNames={{popup:{root:'knowledge-select-popup'}}} size="large" listHeight={256} notFoundContent="暂无可选项" {...props}/>;
}
