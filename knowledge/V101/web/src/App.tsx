import { lazy, Suspense } from "react";
import { Button, Menu, Tag } from "tdesign-react";
import {
  FolderIcon,
  SearchIcon,
  SettingIcon,
  TaskIcon,
  ServerIcon,
  ChatIcon,
} from "tdesign-icons-react";
import { navigate, useData, usePath } from "./ui";
const KnowledgeBases = lazy(() =>
  import("./Knowledge").then((m) => ({ default: m.KnowledgeBases })),
);
const KnowledgeDetail = lazy(() =>
  import("./Knowledge").then((m) => ({ default: m.KnowledgeDetail })),
);
const Settings = lazy(() =>
  import("./Settings").then((m) => ({ default: m.Settings })),
);
const Tasks = lazy(() =>
  import("./System").then((m) => ({ default: m.Tasks })),
);
const System = lazy(() =>
  import("./System").then((m) => ({ default: m.System })),
);
const DocumentView = lazy(() =>
  import("./Document").then((m) => ({ default: m.DocumentView })),
);
const Search = lazy(() =>
  import("./Search").then((m) => ({ default: m.Search })),
);
const QA = lazy(() => import("./QA").then((m) => ({ default: m.QA })));
const MenuItem = Menu.MenuItem;
const ExtractionHome = lazy(() =>
  import("./extraction/Extraction").then((m) => ({
    default: m.ExtractionHome,
  })),
);
const DocumentExtraction = lazy(() =>
  import("./extraction/Extraction").then((m) => ({
    default: m.DocumentExtraction,
  })),
);
import type { Row } from "./api";
import { integration } from "./integration";
export default function App() {
  const path = usePath().split("?")[0];
  const status = useData<Row>("/system/status", 10000);
  const pieces = path.split("/").filter(Boolean);
  const section = pieces[0] || "knowledge-bases";
  const selected = section === "documents" ? "knowledge-bases" : section;
  const names: Record<string, string> = {
    "knowledge-bases": "知识库",
    settings: "设置",
    tasks: "任务中心",
    system: "系统状态",
    search: "检索测试",
    qa: "知识库问答",
    documents: "文档预览",
    extractions: "条款参数提取",
  };
  let view: React.ReactNode;
  if (section === "knowledge-bases")
    view = pieces[1] ? (
      <KnowledgeDetail key={pieces[1]} id={pieces[1]} />
    ) : (
      <KnowledgeBases />
    );
  else if (section === "settings") view = !integration || integration.admin ? <Settings /> : <div role="alert">模型及全局设置由管理员维护。</div>;
  else if (section === "tasks") view = <Tasks />;
  else if (section === "system") view = !integration || integration.admin ? <System /> : <div role="alert">系统状态由管理员维护。</div>;
  else if (section === "documents" && pieces[1])
    view = <DocumentView key={pieces[1]} id={pieces[1]} />;
  else if (section === "search") view = <Search />;
  else if (section === "qa") view = <QA key={pieces[1] || "new"} id={pieces[1]} />;
  else if (section === "extractions")
    view = pieces[1] ? (
      <DocumentExtraction key={pieces[1]} id={pieces[1]} standalone />
    ) : (
      <ExtractionHome />
    );
  else view = <KnowledgeBases />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">
            <span className="brand-mark">N</span>{integration ? "Nebulae V101" : "NebulaeKno"}
          </div>
          <p className="brand-note">知识整理 · 检索 · 来源追溯</p>
        </div>
        <Menu
          value={selected}
          onChange={(value) => navigate("/" + value)}
          style={{ width: "100%", background: "transparent" }}
        >
          <MenuItem value="knowledge-bases" icon={<FolderIcon />}>
            知识库
          </MenuItem>
          <MenuItem value="qa" icon={<ChatIcon />}>
            知识库问答
          </MenuItem>
          <MenuItem value="search" icon={<SearchIcon />}>
            检索测试
          </MenuItem>
          <MenuItem value="extractions" icon={<TaskIcon />}>
            条款参数提取
          </MenuItem>
          <MenuItem value="tasks" icon={<TaskIcon />}>
            任务中心
          </MenuItem>
          {(!integration || integration.admin) && <MenuItem value="settings" icon={<SettingIcon />}>
            设置
          </MenuItem>}
          {(!integration || integration.admin) && <MenuItem value="system" icon={<ServerIcon />}>
            系统状态
          </MenuItem>}
        </Menu>
        <div className="sidebar-foot">
          <span>{integration ? "当前账号已授权知识库" : "公共工作空间"}</span>
          <span>{integration ? "归属、引用与权限由 NebuWork 管理" : "所有项目共享同一套知识库接口"}</span>
          {!integration && <a href="/api/docs" target="_blank" rel="noreferrer">
            接口文档 ↗
          </a>}
        </div>
      </aside>
      <main className="main">
        <div className="page-content">
          <div className="topline">
            <span className="breadcrumb">
              工作空间 / {names[section] || "知识库"}
            </span>
            <div className="responsive-stack">
              <Tag
                theme={status.data?.ready ? "success" : "warning"}
                variant="light"
              >
                {status.data?.ready ? "服务就绪" : "正在检查服务"}
              </Tag>
              {(!integration || integration.admin) && <Button
                variant="text"
                size="small"
                onClick={() => navigate("/settings")}
              >
                模型设置
              </Button>}
            </div>
          </div>
          <Suspense fallback={<div className="section">正在加载…</div>}>
            {view}
          </Suspense>
        </div>
      </main>
    </div>
  );
}
