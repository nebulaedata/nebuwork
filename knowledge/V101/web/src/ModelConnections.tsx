import { useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  Input,
  MessagePlugin,
  Table,
} from "tdesign-react";
import { api, Row, send } from "./api";
import { action, confirmDelete, ErrorNotice } from "./ui";

export const emptyConnection = { name: "", base_url: "", api_key: "" };

export function ModelConnections({
  connections,
  error,
  visible,
  onClose,
  edit,
  onEdit,
  onReload,
  onSaved,
}: {
  connections: Row[];
  error: string;
  visible: boolean;
  onClose: () => void;
  edit: Row | null;
  onEdit: (v: Row | null) => void;
  onReload: () => void;
  onSaved: (v: Row, selectForModel: boolean) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState<string | null>(null);
  async function save() {
    if (!edit) return;
    setSaving(true);
    try {
      const saved = await send(
        "/model-connections" + (edit.id ? "/" + edit.id : ""),
        {
          name: edit.name,
          base_url: edit.base_url,
          api_key: edit.api_key,
          clear_api_key: !!edit.clear_api_key,
        },
        edit.id ? "PUT" : "POST",
      );
      onSaved(saved, !!edit.selectForModel);
      onEdit(null);
      onReload();
      MessagePlugin.success("服务连接已保存");
    } catch (e) {
      MessagePlugin.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <Dialog
        header="服务连接管理"
        closeOnOverlayClick={false}
        visible={visible}
        onClose={onClose}
        footer={false}
        width={900}
        top="6vh"
        className="processing-dialog"
      >
        <div className="toolbar">
          <p className="help">
            集中保存 URL 和 API
            Key，可供多个模型复用。修改连接会应用于引用它的模型。
          </p>
          <Button onClick={() => onEdit({ ...emptyConnection })}>
            新增连接
          </Button>
        </div>
        <ErrorNotice message={error} />
        <Table
          rowKey="id"
          data={connections}
          empty="尚未创建服务连接"
          tableContentWidth="max(100%, 700px)"
          columns={[
            { colKey: "name", title: "连接名称", width: 200, ellipsis: true },
            { colKey: "base_url", title: "基础地址", ellipsis: true },
            {
              colKey: "has_api_key",
              title: "Key",
              width: 80,
              cell: ({ row }) => (row.has_api_key ? "已保存" : "未设置"),
            },
            { colKey: "model_count", title: "模型数", width: 90 },
            {
              colKey: "actions",
              title: "操作",
              width: 190,
              cell: ({ row }) => (
                <>
                  <Button
                    size="small"
                    variant="text"
                    loading={checking === row.id}
                    onClick={async () => {
                      setChecking(row.id);
                      await action(async () => {
                        const result = await send("/models/discover", {
                          connection_id: row.id,
                        });
                        MessagePlugin.success(
                          `连接正常，查询到 ${result.models.length} 个模型`,
                        );
                      });
                      setChecking(null);
                    }}
                  >
                    查询
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => onEdit({ ...row, api_key: "" })}
                  >
                    编辑
                  </Button>
                  <Button
                    size="small"
                    variant="text"
                    theme="danger"
                    onClick={() =>
                      confirmDelete(
                        row.name,
                        () =>
                          api("/model-connections/" + row.id, {
                            method: "DELETE",
                          }),
                        onReload,
                      )
                    }
                  >
                    删除
                  </Button>
                </>
              ),
            },
          ]}
        />
      </Dialog>
      <Dialog
        header={edit?.id ? "编辑服务连接" : "新增服务连接"}
        closeOnOverlayClick={false}
        zIndex={2500}
        visible={!!edit}
        onClose={() => onEdit(null)}
        width={600}
        top="8vh"
        className="processing-dialog"
        confirmBtn={{ content: "保存连接", loading: saving }}
        onConfirm={save}
      >
        {edit && (
          <div className="field-stack">
            <label className="field">
              <span className="field-label">连接名称</span>
              <Input
                aria-label="连接名称"
                value={edit.name}
                onChange={(name) => onEdit({ ...edit, name })}
                placeholder="例如：公司模型服务"
              />
            </label>
            <label className="field">
              <span className="field-label">服务基础地址</span>
              <Input
                aria-label="服务基础地址"
                value={edit.base_url}
                onChange={(base_url) => onEdit({ ...edit, base_url })}
                placeholder="https://模型服务地址/v1"
              />
            </label>
            <p className="help">
              只填写域名时自动追加 /v1，也可填写完整 API 前缀。
            </p>
            <label className="field">
              <span className="field-label">API Key</span>
              <Input
                aria-label="连接 API Key"
                type="password"
                value={edit.api_key}
                disabled={!!edit.clear_api_key}
                onChange={(api_key) => onEdit({ ...edit, api_key })}
                placeholder={
                  edit.has_api_key
                    ? "已保存，留空保留已有 Key"
                    : "无凭证服务可留空"
                }
              />
            </label>
            {edit.has_api_key && (
              <Checkbox
                checked={!!edit.clear_api_key}
                onChange={(clear_api_key) =>
                  onEdit({ ...edit, clear_api_key, api_key: "" })
                }
              >
                清除已保存 Key
              </Checkbox>
            )}
            <p className="help">
              Key 加密保存，选择该连接的模型会自动使用。
              {edit.id ? "变更地址时，请重新填写 Key 或明确清除旧 Key。" : ""}
            </p>
          </div>
        )}
      </Dialog>
    </>
  );
}
