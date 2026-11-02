import { useEffect, useState } from "react";
import { Table } from "antd";
import { api, date } from "./api";
import { Button, Badge, Empty, ErrorNotice } from "./ui";
import type { TaskSummary } from "./types";

export function WorkflowTasks({ id }: { id: string }) {
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const load = () =>
      api<TaskSummary[]>("/tasks?workflow_id=" + encodeURIComponent(id))
        .then((value) => {
          if (active) setTasks(value);
        })
        .catch((error) => {
          if (active) setError(error.message);
        });
    load();
    const timer = setInterval(load, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [id]);
  return (
    <>
      <ErrorNotice message={error} clear={() => setError("")} />
      <Table<TaskSummary>
        rowKey="id"
        dataSource={tasks}
        pagination={{
          pageSize: 12,
          hideOnSinglePage: true,
          showSizeChanger: false,
        }}
        scroll={{ x: 540 }}
        locale={{ emptyText: <Empty>此工作流尚无任务</Empty> }}
        columns={[
          {
            title: "任务",
            render: (_, task) => <code>{task.id.slice(0, 12)}</code>,
          },
          { title: "状态", render: (_, task) => <Badge state={task.state} /> },
          { title: "创建时间", render: (_, task) => date(task.created_at) },
          {
            title: "",
            width: 110,
            render: (_, task) => (
              <Button href={"#task/" + task.id}>查看任务</Button>
            ),
          },
        ]}
      />
      <div className="panel-footnote">
        显示当前工作流最近的 100 个任务，完整历史保留在运行目录中。
      </div>
    </>
  );
}
