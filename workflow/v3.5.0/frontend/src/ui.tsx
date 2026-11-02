import { useState, type ReactNode } from "react";
import {
  Alert,
  Button as AntButton,
  Empty as AntEmpty,
  Modal as AntModal,
  Tag,
  type ButtonProps,
} from "antd";
import { LoaderCircle } from "lucide-react";
import { states } from "./types";

// Share action styling without changing native form submission semantics.
export function Button({
  className = "",
  type,
  ...props
}: Omit<ButtonProps, "type"> & { type?: "button" | "submit" | "reset" }) {
  return (
    <AntButton
      {...props}
      className={className}
      htmlType={type ?? "button"}
      type={
        className.split(" ").includes("primary")
          ? "primary"
          : className.includes("icon-button")
            ? "text"
            : "default"
      }
      danger={className.includes("danger-text")}
    />
  );
}
export function Badge({ state }: { state: string }) {
  return (
    <Tag className={"badge " + state}>
      <i />
      {states[state] ?? state}
    </Tag>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return (
    <AntEmpty
      className="empty"
      image={AntEmpty.PRESENTED_IMAGE_SIMPLE}
      description={children}
    />
  );
}
export function ErrorNotice({
  message,
  clear,
}: {
  message: string;
  clear: () => void;
}) {
  return message ? (
    <Alert
      className="error-notice"
      role="alert"
      title={message}
      type="error"
      showIcon
      closable={{ onClose: clear, "aria-label": "关闭错误" }}
    />
  ) : null;
}
export function Modal({
  title,
  close,
  children,
  wide = false,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <AntModal
      open
      title={title}
      onCancel={close}
      closable={{ "aria-label": "关闭窗口" }}
      footer={null}
      width={wide ? 980 : 520}
      centered
      className="workbench-modal"
      destroyOnHidden
    >
      {children}
    </AntModal>
  );
}
export function useJob() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const run = async (job: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await job();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, run };
}
export function Busy() {
  return <LoaderCircle size={15} className="spin" />;
}
