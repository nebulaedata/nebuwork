import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { KnowledgeSelect } from '../knowledge/KnowledgeControls.jsx';

export const formatTime = value => value ? new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
export function Notice({ children }) { return children ? <p className="hub-error" role="alert">{children}</p> : null; }
export function Empty({ children }) { return <div className="hub-empty" role="status">{children}</div>; }
export function Overlay({ title, close, children }) {
  const ref = useRef(null);
  useEffect(() => { const previous = document.activeElement; ref.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  return <div className="wb-overlay" onClick={event => { if (event.target === event.currentTarget) close(); }} onKeyDown={event => {
    if (event.key === 'Escape') close();
    if (event.key === 'Tab') { const controls = [...ref.current.querySelectorAll('button,a[href],input,textarea,[tabindex="0"]')].filter(el => !el.disabled);
      if (!controls.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === ref.current)) { event.preventDefault(); controls.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0].focus(); }
    }
  }}><section className="wb-overlay-card" ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}><header className="hub-panel-head"><strong>{title}</strong><button className="btn-icon" onClick={close} aria-label="关闭详情"><X size={16}/></button></header>{children}</section></div>;
}
export function HubSelect({ label, value, options, onChange, ...props }) {
  return <label className="hub-select"><span>{label}</span><KnowledgeSelect aria-label={label} showSearch optionFilterProp="label" value={value || undefined} placeholder={`选择${label}`} options={options} onChange={onChange} {...props}/></label>;
}
