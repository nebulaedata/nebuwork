import { uploadSessions } from "./integration";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { api, send, Row } from "./api";

export function isTemporaryFile(name: string) {
  return name.replaceAll("\\", "/").split("/").pop()!.startsWith("~$");
}

async function checksum(data: Blob) {
  // Pure JavaScript keeps part verification working on intranet HTTP origins.
  return bytesToHex(sha256(new Uint8Array(await data.arrayBuffer())));
}
export async function uploadResumable(
  kb: string,
  file: File,
  progress: (percentage: number) => void,
) {
  if (isTemporaryFile(file.name)) {
    progress(100);
    return { state: "skipped", skip_reason: "office_temporary_file" };
  }
  const key =
    "nebulaekno:upload:" +
    kb +
    ":" +
    (file.webkitRelativePath || file.name) +
    ":" +
    file.size +
    ":" +
    file.lastModified;
  let id = uploadSessions.getItem(key);
  let status: Row | undefined;
  if (id) {
    try {
      status = await api("/uploads/" + id);
    } catch {
      id = null;
    }
    if (status?.state === "completed") {
      progress(100);
      return status.result;
    }
    if (status?.state !== "uploading") id = null;
  }
  if (!id) {
    const session = await send("/knowledge-bases/" + kb + "/uploads", {
      file_name: file.name,
      relative_path: file.webkitRelativePath || file.name,
      file_size: file.size,
    });
    if (session.state === "skipped") {
      progress(100);
      return session;
    }
    id = session.upload_id;
    uploadSessions.setItem(key, id!);
    status = { part_size: session.part_size, parts: [] };
  }
  const size = Number(status!.part_size);
  for (let start = 0, part = 1; start < file.size; start += size, part++) {
    const blob = file.slice(start, Math.min(start + size, file.size));
    const sha = await checksum(blob);
    const saved = status!.parts?.find((p: Row) => p.part_number === part);
    if (saved && saved.sha256 !== sha)
      throw new Error("所选文件与之前上传的内容不一致，请选择原文件继续上传。");
    if (!saved)
      await api("/uploads/" + id + "/parts/" + part, {
        method: "PUT",
        body: blob,
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Content-SHA256": sha,
        },
      });
    progress(Math.min(99, Math.floor(((start + blob.size) / file.size) * 100)));
  }
  const result = await send("/uploads/" + id + "/complete", {});
  uploadSessions.removeItem(key);
  progress(100);
  return result;
}
