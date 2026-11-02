import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { mkdtemp, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const dir = await mkdtemp(new URL("../.http-upload-test-", import.meta.url));
const names = ["api", "id", "upload"];
const descriptors = new Map(
  ["crypto", "fetch", "localStorage"].map((key) => [
    key,
    Object.getOwnPropertyDescriptor(globalThis, key),
  ]),
);
const storage = new Map();
const requests = [];
let session;
let failPart;
let partSize = 64;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const file = (bytes) => {
  const value = new File([bytes], "资料.bin", { lastModified: 123 });
  Object.defineProperty(value, "webkitRelativePath", {
    value: "文件夹/资料.bin",
  });
  return value;
};
function reset() {
  storage.clear();
  requests.length = 0;
  session = undefined;
  failPart = undefined;
}

try {
  // Match an intranet HTTP origin: random bytes work, secure-context APIs do not.
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  });
  globalThis.fetch = async (path, options = {}) => {
    const method = options.method || "GET";
    requests.push({ path, method });
    let result;
    if (path === "/api/v1/knowledge-bases/kb/uploads" && method === "POST") {
      const metadata = JSON.parse(options.body);
      assert.equal(metadata.relative_path, "文件夹/资料.bin");
      session = {
        upload_id: "upload-1",
        state: "uploading",
        part_size: partSize,
        parts: [],
        file_size: metadata.file_size,
      };
      result = session;
    } else if (path === "/api/v1/uploads/upload-1" && method === "GET") {
      result = session;
    } else if (
      path.startsWith("/api/v1/uploads/upload-1/parts/") &&
      method === "PUT"
    ) {
      const number = Number(path.split("/").pop());
      if (number === failPart) {
        failPart = undefined;
        throw new Error("connection interrupted");
      }
      const bytes = new Uint8Array(await options.body.arrayBuffer());
      const expected = hash(bytes);
      assert.equal(options.headers["X-Content-SHA256"], expected);
      assert.equal(options.headers["Content-Type"], "application/octet-stream");
      result = { part_number: number, size: bytes.length, sha256: expected };
      session.parts.push(result);
    } else if (
      path === "/api/v1/uploads/upload-1/complete" &&
      method === "POST"
    ) {
      assert.equal(
        session.parts.reduce((size, part) => size + part.size, 0),
        session.file_size,
      );
      session.state = "completed";
      session.result = { document_id: "document-1" };
      result = session.result;
    } else {
      assert.fail(`Unexpected request: ${method} ${path}`);
    }
    return new Response(JSON.stringify({ success: true, data: result }));
  };

  // Run the real TypeScript modules, using the same compiler as the application.
  for (const name of names) {
    const source = await readFile(
      new URL(`../src/${name}.ts`, import.meta.url),
      "utf8",
    );
    const compiled = ts
      .transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      })
      .outputText.replace(/from "\.\/(\w+)"/g, 'from "./$1.mjs"');
    await writeFile(`${dir}/${name}.mjs`, compiled);
  }
  const { createId } = await import(pathToFileURL(`${dir}/id.mjs`));
  const { uploadResumable } = await import(pathToFileURL(`${dir}/upload.mjs`));
  const ids = Array.from({ length: 1000 }, () => createId());
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids)
    assert.match(
      id,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );

  // Exercise SHA-256 block/padding boundaries, Unicode and arbitrary binary data.
  for (const bytes of [
    ...[0, 1, 55, 56, 63, 64, 65, 129].map((size) =>
      Uint8Array.from({ length: size }, (_, index) => index % 256),
    ),
    new TextEncoder().encode("内网 HTTP 上传校验 😀"),
  ]) {
    reset();
    const progress = [];
    assert.deepEqual(
      await uploadResumable("kb", file(bytes), (value) => progress.push(value)),
      {
        document_id: "document-1",
      },
    );
    assert.equal(progress.at(-1), 100);
    assert.equal(storage.size, 0);
  }

  // Use the server's real 8 MiB part size and resume after a network interruption.
  reset();
  partSize = 8 * 1024 * 1024;
  const bytes = Uint8Array.from(
    { length: partSize + 137 },
    (_, index) => index % 256,
  );
  failPart = 2;
  await assert.rejects(
    uploadResumable("kb", file(bytes), () => {}),
    /connection interrupted/,
  );
  assert.equal(storage.size, 1);
  assert.equal(session.parts.length, 1);
  requests.length = 0;
  await uploadResumable("kb", file(bytes), () => {});
  assert.deepEqual(requests, [
    { path: "/api/v1/uploads/upload-1", method: "GET" },
    { path: "/api/v1/uploads/upload-1/parts/2", method: "PUT" },
    { path: "/api/v1/uploads/upload-1/complete", method: "POST" },
  ]);
  assert.equal(storage.size, 0);

  // A changed file must still be rejected when its metadata matches a saved upload.
  reset();
  failPart = 2;
  await assert.rejects(
    uploadResumable("kb", file(bytes), () => {}),
    /connection interrupted/,
  );
  bytes[0] ^= 0xff;
  requests.length = 0;
  await assert.rejects(
    uploadResumable("kb", file(bytes), () => {}),
    /所选文件与之前上传的内容不一致/,
  );
  assert.deepEqual(requests, [
    { path: "/api/v1/uploads/upload-1", method: "GET" },
  ]);
  console.log(
    "PASS: HTTP-compatible IDs, SHA-256 checksums, 8 MiB parts, resumable upload and changed-file rejection",
  );
} finally {
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  for (const name of names) await unlink(`${dir}/${name}.mjs`).catch(() => {});
  await rmdir(dir);
}
