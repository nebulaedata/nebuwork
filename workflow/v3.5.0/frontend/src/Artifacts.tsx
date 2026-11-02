import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Key,
} from "react";
import {
  Breadcrumb,
  Button as AntButton,
  Segmented,
  Pagination,
  Table,
  Tag,
  Tree,
  type TreeDataNode,
  type GetRef,
} from "antd";
import {
  ArrowUp,
  Download,
  FileText,
  Eye,
  Folder,
  FolderTree,
  List,
} from "lucide-react";
import { api, pretty } from "./api";
import type { Artifact } from "./types";
import {
  buildArtifactTree,
  folderEntries,
  folderKey,
  type ArtifactEntry,
  type ArtifactFolder,
} from "./artifactTree";
import { Button, Empty, ErrorNotice, Modal, useJob } from "./ui";

type View = "list" | "tree";
const viewPreference = "nebulae.artifacts.view";

function treeNodes(directory: ArtifactFolder): TreeDataNode {
  const names = new Map<string, number>();
  for (const file of directory.files)
    names.set(file.label, (names.get(file.label) ?? 0) + 1);
  return {
    key: directory.key,
    title: (
      <span title={directory.path.join("/") || "全部产物"}>
        {directory.label} <small>({directory.count})</small>
      </span>
    ),
    icon: <Folder size={15} />,
    children: folderEntries(directory).map((entry) =>
      entry.type === "folder"
        ? treeNodes(entry)
        : {
            key: entry.key,
            isLeaf: true,
            icon: <FileText size={15} />,
            title: (
              <span
                title={`${entry.artifact.name} · ${entry.artifact.step} · 第 ${entry.artifact.attempt} 次执行 · ${entry.artifact.task_id}`}
              >
                {entry.label}
                {names.get(entry.label)! > 1 && (
                  <small>
                    {" "}
                    · {entry.artifact.scope === "task" ? "任务" : "共享"} /{" "}
                    {entry.artifact.step} / {entry.artifact.attempt} ·{" "}
                    {entry.artifact.id.slice(0, 6)}
                  </small>
                )}
              </span>
            ),
          },
    ),
  };
}

export function ArtifactList({ artifacts }: { artifacts: Artifact[] }) {
  const [view, setView] = useState<View>(() => {
    try {
      return localStorage.getItem(viewPreference) === "tree" ? "tree" : "list";
    } catch {
      return "list";
    }
  });
  const [path, setPath] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Key[]>([folderKey([])]);
  const [page, setPage] = useState(1);
  const [paneHeight, setPaneHeight] = useState(480);
  const [treeHeight, setTreeHeight] = useState(400);
  const [tableHeight, setTableHeight] = useState(340);
  const workspace = useRef<HTMLDivElement>(null);
  const tableHost = useRef<HTMLDivElement>(null);
  const treeHost = useRef<HTMLDivElement>(null);
  const treeRef = useRef<GetRef<typeof Tree>>(null);
  const [preview, setPreview] = useState<{
    name: string;
    data: unknown;
    download_only: boolean;
    id: string;
  } | null>(null);
  const { error, setError, busy, run } = useJob();
  const model = useMemo(() => buildArtifactTree(artifacts), [artifacts]);
  const tree = useMemo(() => [treeNodes(model.root)], [model]);
  // A refresh may remove a folder; fall back to its nearest existing parent.
  let current = model.entries.get(folderKey(path));
  for (let length = path.length - 1; !current && length >= 0; length--)
    current = model.entries.get(folderKey(path.slice(0, length)));
  const directory = (current ?? model.root) as ArtifactFolder;
  useLayoutEffect(() => {
    const measure = () => {
      if (!workspace.current) return;
      // Use document coordinates so scrolling the page does not resize the panes.
      const top =
        workspace.current.getBoundingClientRect().top + window.scrollY;
      const minimum = window.innerWidth <= 700 ? 520 : 340;
      setPaneHeight(
        Math.max(
          minimum,
          Math.floor(
            Math.min(window.innerHeight - 160, window.innerHeight - top - 28),
          ),
        ),
      );
    };
    const observer = new ResizeObserver(measure);
    if (workspace.current?.parentElement)
      observer.observe(workspace.current.parentElement);
    window.addEventListener("resize", measure);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [view]);
  useLayoutEffect(() => {
    const measure = () => {
      if (treeHost.current)
        setTreeHeight(Math.max(80, treeHost.current.clientHeight));
      if (tableHost.current) {
        const header =
          tableHost.current
            .querySelector(".ant-table-header")
            ?.getBoundingClientRect().height ?? 40;
        setTableHeight(
          Math.max(80, Math.floor(tableHost.current.clientHeight - header)),
        );
      }
    };
    const observer = new ResizeObserver(measure);
    if (tableHost.current) observer.observe(tableHost.current);
    if (treeHost.current) observer.observe(treeHost.current);
    measure();
    return () => observer.disconnect();
  }, [view]);
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      treeRef.current?.scrollTo({ key: directory.key }),
    );
    return () => cancelAnimationFrame(frame);
  }, [directory.key, view, treeHeight]);
  useEffect(() => {
    const body = tableHost.current?.querySelector(".ant-table-body");
    if (body) body.scrollTop = 0;
  }, [page, directory.key, view]);
  const openFolder = (next: string[]) => {
    setPath(next);
    setPage(1);
    setExpanded((keys) => [
      ...new Set([
        ...keys,
        ...next.map((_, index) => folderKey(next.slice(0, index + 1))),
        folderKey([]),
      ]),
    ]);
  };
  const openPreview = (artifact: Artifact) =>
    run(async () => {
      const result = await api<{ data: unknown; download_only: boolean }>(
        "/artifacts/" + artifact.id + "/content",
      );
      setPreview({ ...result, name: artifact.name, id: artifact.id });
    });
  const rows: ArtifactEntry[] =
    view === "tree"
      ? folderEntries(directory)
      : artifacts.map((artifact) => ({
          key: "artifact:" + artifact.id,
          type: "file",
          label: artifact.name,
          path: [],
          artifact,
        }));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / 12)));
  return (
    <div className="artifact-browser">
      <ErrorNotice message={error} clear={() => setError("")} />
      <div className="artifact-toolbar">
        <Segmented<View>
          aria-label="产物展示方式"
          value={view}
          options={[
            { label: "列表", value: "list", icon: <List size={15} /> },
            { label: "目录树", value: "tree", icon: <FolderTree size={15} /> },
          ]}
          onChange={(next) => {
            setView(next);
            setPage(1);
            try {
              localStorage.setItem(viewPreference, next);
            } catch {
              /* storage may be disabled */
            }
          }}
        />
        <span className="muted">共 {artifacts.length} 项产物，含历史版本</span>
      </div>
      {view === "tree" && (
        <div className="artifact-navigation">
          <Button
            aria-label="返回上一级"
            disabled={!directory.path.length}
            onClick={() => openFolder(directory.path.slice(0, -1))}
          >
            <ArrowUp size={15} />
            上一级
          </Button>
          <Breadcrumb
            aria-label="产物目录路径"
            items={[
              {
                title: (
                  <AntButton
                    type="link"
                    size="small"
                    onClick={() => openFolder([])}
                  >
                    全部产物
                  </AntButton>
                ),
              },
              ...directory.path.map((part, index) => ({
                title:
                  index === directory.path.length - 1 ? (
                    part
                  ) : (
                    <AntButton
                      type="link"
                      size="small"
                      onClick={() =>
                        openFolder(directory.path.slice(0, index + 1))
                      }
                    >
                      {part}
                    </AntButton>
                  ),
              })),
            ]}
          />
        </div>
      )}
      <div
        ref={workspace}
        className={
          "artifact-workspace " +
          (view === "tree" ? "artifact-tree-view" : "artifact-list-view")
        }
        style={{ height: paneHeight }}
      >
        {view === "tree" && (
          <aside className="artifact-tree" aria-label="产物目录树">
            <div className="artifact-tree-heading">文件目录</div>
            <div className="artifact-tree-viewport" ref={treeHost}>
              <Tree
                ref={treeRef}
                motion={null}
                showIcon
                blockNode
                height={treeHeight}
                treeData={tree}
                selectedKeys={[directory.key]}
                expandedKeys={expanded}
                onExpand={(keys) => setExpanded(keys)}
                onSelect={(_, { node }) => {
                  const entry = model.entries.get(String(node.key));
                  if (!entry) return;
                  openFolder(entry.path);
                  if (entry.type === "file") openPreview(entry.artifact);
                }}
              />
            </div>
          </aside>
        )}
        <div className="artifact-contents">
          {view === "tree" && (
            <div className="artifact-directory-summary muted">
              {directory.folders.size} 个文件夹 · {directory.files.length}{" "}
              项产物
            </div>
          )}
          <div className="artifact-table" ref={tableHost}>
            <Table<ArtifactEntry>
              key={view + directory.key}
              rowKey="key"
              dataSource={rows.slice((currentPage - 1) * 12, currentPage * 12)}
              tableLayout="fixed"
              size="small"
              pagination={false}
              scroll={{ x: 900, y: tableHeight }}
              onRow={(entry) => ({
                onDoubleClick: () =>
                  entry.type === "folder"
                    ? openFolder(entry.path)
                    : openPreview(entry.artifact),
              })}
              locale={{
                emptyText: (
                  <Empty>
                    <p>尚无保存的产物</p>
                    <span>步骤调用存储方法后，产物会显示在这里。</span>
                  </Empty>
                ),
              }}
              columns={[
                {
                  title: "产物名称",
                  width: 340,
                  render: (_, entry) =>
                    entry.type === "folder" ? (
                      <>
                        <AntButton
                          type="text"
                          className="artifact-folder-button file-label"
                          aria-label={"进入文件夹 " + entry.label}
                          onClick={() => openFolder(entry.path)}
                        >
                          <Folder size={16} />
                          <strong>{entry.label}</strong>
                        </AntButton>
                        <small>文件夹 · {entry.count} 项产物（含子目录）</small>
                      </>
                    ) : (
                      <>
                        <span
                          className="file-label"
                          title={entry.artifact.name}
                        >
                          <FileText size={15} />
                          <strong>{entry.label}</strong>
                        </span>
                        <small>
                          {entry.artifact.kind} ·{" "}
                          {entry.artifact.id.slice(0, 8)}
                        </small>
                      </>
                    ),
                },
                {
                  title: "来源",
                  width: 170,
                  render: (_, entry) =>
                    entry.type === "folder" ? (
                      "—"
                    ) : (
                      <>
                        <code
                          className="artifact-source"
                          title={entry.artifact.step}
                        >
                          {entry.artifact.step}
                        </code>
                        <small
                          className="artifact-source"
                          title={`第 ${entry.artifact.attempt} 次执行 · 任务 ${entry.artifact.task_id}`}
                        >
                          第 {entry.artifact.attempt} 次 · 任务{" "}
                          {entry.artifact.task_id.slice(0, 8)}
                        </small>
                      </>
                    ),
                },
                {
                  title: "空间",
                  width: 96,
                  className: "artifact-meta-column",
                  render: (_, entry) =>
                    entry.type === "folder"
                      ? "—"
                      : entry.artifact.scope === "task"
                        ? "任务级"
                        : "工作流级",
                },
                {
                  title: "状态",
                  width: 104,
                  className: "artifact-meta-column",
                  render: (_, entry) =>
                    entry.type === "folder" ? (
                      "—"
                    ) : (
                      <Tag
                        className={
                          "artifact-state " +
                          (entry.artifact.effective ? "effective" : "")
                        }
                      >
                        {entry.artifact.effective
                          ? "当前有效"
                          : entry.artifact.published
                            ? "历史版本"
                            : "未发布"}
                      </Tag>
                    ),
                },
                {
                  title: "大小",
                  width: 90,
                  className: "artifact-meta-column",
                  render: (_, entry) =>
                    entry.type === "folder"
                      ? "—"
                      : entry.artifact.size < 1024
                        ? entry.artifact.size + " B"
                        : (entry.artifact.size / 1024).toFixed(1) + " KB",
                },
                {
                  title: "操作",
                  width: 100,
                  fixed: "right",
                  render: (_, entry) =>
                    entry.type === "folder" ? null : (
                      <div className="row-actions">
                        <Button
                          aria-label={"查看产物 " + entry.artifact.name}
                          disabled={busy}
                          onClick={() => openPreview(entry.artifact)}
                        >
                          <Eye size={15} />
                        </Button>
                        <Button
                          aria-label={"下载产物 " + entry.artifact.name}
                          href={
                            "/api/v1/artifacts/" +
                            entry.artifact.id +
                            "/download"
                          }
                        >
                          <Download size={15} />
                        </Button>
                      </div>
                    ),
                },
              ]}
            />
          </div>
          <div className="artifact-pagination">
            <Pagination
              size="small"
              current={currentPage}
              pageSize={12}
              total={rows.length}
              showSizeChanger={false}
              onChange={setPage}
              showTotal={(total) => `共 ${total} 项`}
            />
          </div>
        </div>
      </div>
      {preview && (
        <Modal title={preview.name} wide close={() => setPreview(null)}>
          {preview.download_only ? (
            <p>该产物为文件或超过预览大小，请下载查看。</p>
          ) : (
            <pre className="artifact-preview">
              {typeof preview.data === "string"
                ? preview.data
                : pretty(preview.data)}
            </pre>
          )}
          <footer>
            <Button
              className="primary"
              href={"/api/v1/artifacts/" + preview.id + "/download"}
            >
              <Download size={16} />
              下载产物
            </Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
