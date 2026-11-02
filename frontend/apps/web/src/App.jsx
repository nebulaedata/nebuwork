import { useEffect } from "react";
import { UploadTasksButton } from './features/knowledge/UploadTasksButton.jsx';

export function App() {
  useEffect(() => {
    import("./app/runtime.js");
  }, []);

  return (
    <>
      <aside className="app-nav">
        <div className="nav-logo"><span className="logo-mark" id="logo-icon" /></div>
        <nav className="nav-links" id="nav-links">
          <a className="nav-item" data-nav="workbench" href="#/workbench" title="工作台"><span className="ni-ic" data-ic="layout-dashboard" /></a>
          <a className="nav-item" data-nav="projects" href="#/projects" title="项目"><span className="ni-ic" data-ic="folder-kanban" /></a>
          <a className="nav-item" data-nav="agents" href="#/agents" title="专家智能体"><span className="ni-ic" data-ic="bot" /></a>
          <a className="nav-item" data-nav="workflows" href="#/workflows" title="Workflow"><span className="ni-ic" data-ic="workflow" /></a>
          <a className="nav-item" data-nav="plaza" href="#/plaza" title="广场"><span className="ni-ic" data-ic="store" /></a>
        </nav>
        <div className="nav-foot">
          <div className="user-card" id="user-card">
            <span className="avatar avatar-photo" aria-label="用户头像">?</span>
            <div className="user-pop" id="user-pop">
              <a className="up-btn" href="#/settings" data-up-ic="settings" title="设置" />
              <button className="up-btn" id="up-theme" title="切换主题" />
              <button className="up-btn" id="up-help" data-up-ic="help-circle" title="帮助与反馈" />
              <div className="up-quota" id="up-quota" />
            </div>
          </div>
        </div>
      </aside>

      <header className="app-topbar">
        <span className="topbar-title" id="topbar-title" />
        <span className="topbar-crumb" id="topbar-crumb" />
        <div className="topbar-tabs" id="topbar-tabs" />
        <span className="topbar-spacer" />
        <span id="topbar-actions" />
        <UploadTasksButton />
        <button className="btn-icon" id="btn-search" title="全局搜索" />
        <button className="btn-icon" id="btn-notify" title="通知" />
      </header>

      <div className="notif-mask" id="notif-mask">
        <div className="notif-panel">
          <div className="ntf-head"><span className="ntf-title">消息</span><button className="btn-icon" id="ntf-close" /></div>
          <div className="ntf-list" id="ntf-list" />
        </div>
      </div>

      <main id="app-content" />

      <div className="search-mask" id="search-mask">
        <div className="search-panel">
          <div className="sp-input"><span id="sp-icon" /><input id="sp-input" placeholder="搜索任务标题或消息内容…" /></div>
          <div className="sp-list" id="sp-list" />
        </div>
      </div>

      <div className="modal-mask" id="modal-mask"><div className="modal" id="modal-box" /></div>
      <div id="toast-wrap" />
    </>
  );
}
