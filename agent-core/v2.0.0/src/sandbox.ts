import { createUuid } from './uuid.js';
import Docker from "dockerode";
import { PassThrough, type Duplex, type Readable } from "node:stream";
import { CheckedFileStream } from './file-transfers.js';
import { EngineError, safePath, type ResourceFile } from "./contracts.js";
import type { Objects } from "./objects.js";
import type { Config } from "./config.js";

export interface Sandbox {
  read(path: string): Promise<Buffer>;
  write(path: string, data: Buffer): Promise<void>;
  materialize?(file: ResourceFile, objects: Objects): Promise<void>;
  exec(
    command: string,
    signal?: AbortSignal,
    onOutput?: (text: string, stream: string) => void,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  snapshot(
    objects: Objects,
    tenant: string,
    owner: string,
  ): Promise<ResourceFile[]>;
  stdio(
    command: string,
    args: string[],
    env?: Record<string, string>,
  ): Promise<{ input: Duplex; output: PassThrough; error: PassThrough }>;
  close(): Promise<void>;
  heartbeat?(): Promise<void>;
  isolatedMcp?(): Promise<Sandbox>;
}
const FILE_HELPER = `const fs=require('fs'),p=require('path'); const root='/workspace'; const name=process.argv[2];const target=p.resolve(root,name); if(!target.startsWith(root+'/'))throw Error('path');let parent=p.dirname(target);while(!fs.existsSync(parent))parent=p.dirname(parent);if(fs.realpathSync(parent)!==root&&!fs.realpathSync(parent).startsWith(root+'/'))throw Error('symlink');const op=process.argv[1];if(op==='read'){if(!fs.realpathSync(target).startsWith(root+'/'))throw Error('symlink');if(fs.statSync(target).size>32*1024*1024)throw Error('file too large; use bash to read a bounded portion');process.stdout.write(fs.readFileSync(target));}else{fs.mkdirSync(p.dirname(target),{recursive:true});if(fs.existsSync(target)&&fs.lstatSync(target).isSymbolicLink())throw Error('symlink');const output=fs.createWriteStream(target,{flags:fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW});output.on('error',e=>{process.stderr.write('file write failed');process.exitCode=1;process.stdin.destroy(e);});process.stdin.pipe(output);}`;
export class DockerSandbox implements Sandbox {
  private pinnedInputs = new Map<string, ResourceFile>();
  private children = new Set<DockerSandbox>();
  private closed = false;
  private onClosed?: () => void;
  private constructor(
    private docker: Docker,
    private container: Docker.Container,
    private config: Config,
    private runId: string,
    private fence: number,
    private expectedDigest?: string,
  ) {}
  static async imageDigest(config: Config) {
    const docker = new Docker(
      config.DOCKER_HOST ? { host: config.DOCKER_HOST } : undefined,
    );
    return (await docker.getImage(config.SANDBOX_IMAGE).inspect()).Id;
  }
  static async create(
    config: Config,
    runId: string,
    fence: number,
    expectedDigest?: string,
    role: 'task' | 'mcp' = 'task',
    instance: string = '',
  ): Promise<DockerSandbox> {
    const docker = new Docker(
      config.DOCKER_HOST ? { host: config.DOCKER_HOST } : undefined,
    );
    if (
      expectedDigest &&
      (await docker.getImage(config.SANDBOX_IMAGE).inspect()).Id !==
        expectedDigest
    )
      throw new EngineError(
        409,
        "image_changed",
        "当前节点的执行镜像与运行快照不一致",
      );
    const previous=await docker.listContainers({all:true,filters:{label:["nebu.engine=1",`nebu.run=${runId}`]}});
    for(const old of previous)if(Number(old.Labels['nebu.fence'])<fence)await docker.getContainer(old.Id).remove({force:true}).catch(error=>{if(error.statusCode!==404)throw error;});
    const container = await docker.createContainer({
      Image: config.SANDBOX_IMAGE,
      name: `nebu-${role}-${runId}-${fence}${instance ? '-' + instance : ''}`,
      // PID 1 owns a root-only heartbeat; tool processes keep the unprivileged node identity.
      User: "0:0",
      Cmd: ["node", "-e", `const fs=require('fs');fs.mkdirSync('/workspace',{recursive:true,mode:1023});fs.mkdirSync('/tmp/nebu-lease',{mode:448});const p='/tmp/nebu-lease/heartbeat';fs.writeFileSync(p,'',{mode:384});setInterval(()=>{if(Date.now()-fs.statSync(p).mtimeMs>${config.LEASE_MS})process.exit(0)},100);`],
      WorkingDir: "/workspace",
      Env: [
        "HOME=/workspace/.home",
        "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      ],
      Labels: {
        "nebu.engine": "1",
        "nebu.run": runId,
        "nebu.fence": String(fence),
        "nebu.role": role,
      },
      HostConfig: {
        Memory: 2 * 1024 ** 3,
        NanoCpus: 2 * 1e9,
        PidsLimit: 256,
        // Large immutable inputs live on the container's disposable disk layer.
        Tmpfs: process.env.FILE_TRANSFERS_ENABLED==='true' ? undefined : {'/workspace':'rw,size=536870912,mode=1777'},
        CapDrop: ["ALL"],
        SecurityOpt: ["no-new-privileges:true"],
        AutoRemove: true,
      },
    });
    try { await container.start(); }
    catch (error) { await container.remove({ force: true }).catch(() => {}); throw error; }
    return new DockerSandbox(docker, container, config, runId, fence, expectedDigest);
  }
  async isolatedMcp(): Promise<Sandbox> {
    if (this.closed) throw new EngineError(409, 'sandbox_closed', '执行容器已关闭');
    const child = await DockerSandbox.create(this.config, this.runId, this.fence, this.expectedDigest, 'mcp', createUuid().slice(0, 8));
    if (this.closed) { await child.close(); throw new EngineError(409, 'sandbox_closed', '执行容器已关闭'); }
    this.children.add(child); child.onClosed = () => this.children.delete(child);
    return child;
  }
  async stdio(
    command: string,
    args: string[],
    env: Record<string, string> = {},
  ) {
    const proc = await this.container.exec({
      User: "1000:1000",
      Cmd: [command, ...args],
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: "/workspace",
      Env: Object.entries(env).map(([k, v]) => `${k}=${v}`),
    });
    const input = await proc.start({ hijack: true, stdin: true });
    const output = new PassThrough(),
      error = new PassThrough();
    this.docker.modem.demuxStream(input, output, error);
    input.on("end", () => {
      output.end();
      error.end();
    });
    return { input, output, error };
  }
  private async command(
    args: string[],
    input?: Buffer | Readable,
    signal?: AbortSignal,
    onOutput?: (text: string, stream: string) => void,
  ) {
    signal?.throwIfAborted();
    const proc = await this.container.exec({
      User: "1000:1000",
      Cmd: args,
      AttachStdin: !!input,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: "/workspace",
    });
    const socket = await proc.start({ hijack: true, stdin: !!input });
    const out = new PassThrough(),
      err = new PassThrough(),
      stdout: Buffer[] = [],
      stderr: Buffer[] = [];
    this.docker.modem.demuxStream(socket, out, err);
    let outSize = 0,
      errSize = 0;
    out.on("data", (b: Buffer) => {
      outSize += b.length;
      if (outSize <= 32 * 1024 ** 2) stdout.push(b);
      onOutput?.(b.toString(), "stdout");
    });
    err.on("data", (b: Buffer) => {
      errSize += b.length;
      if (errSize <= 1024 ** 2) stderr.push(b);
      onOutput?.(b.toString(), "stderr");
    });
    const abort = () => {
      void this.close();
      socket.destroy(new Error("aborted"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.on("end", resolve);
        socket.on("error", reject);
        if (Buffer.isBuffer(input)) socket.end(input);
        else if(input){input.once('error',error=>socket.destroy(error));input.pipe(socket);}
      });
      let state = await proc.inspect();
      while (state.Running) {
        signal?.throwIfAborted();
        await new Promise((resolve) => setTimeout(resolve, 20));
        state = await proc.inspect();
      }
      if (outSize > 32 * 1024 ** 2)
        throw new EngineError(413, "output_limit", "工具输出超过大小限制");
      return {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr),
        exitCode: state.ExitCode ?? 1,
      };
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  async read(path: string) {
    const result = await this.command([
      "node",
      "-e",
      FILE_HELPER,
      "read",
      safePath(path),
    ]);
    if (result.exitCode)
      throw new EngineError(422, "file_read", "文件读取失败");
    return result.stdout;
  }
  async write(path: string, data: Buffer) {
    const result = await this.command(
      ["node", "-e", FILE_HELPER, "write", safePath(path)],
      data,
    );
    if (result.exitCode)
      throw new EngineError(422, "file_write", "文件写入失败", {
        path,
        exitCode: result.exitCode,
        diagnostic: result.stderr.toString().slice(0, 1500),
      });
  }
  async materialize(file: ResourceFile, objects: Objects) {
    const object=await objects.get(file.objectKey),source=object.Body as Readable,checked=new CheckedFileStream(file.size);
    source.once('error',error=>checked.destroy(error));source.pipe(checked);
    try{const result=await this.command(['node','-e',FILE_HELPER,'write',safePath(file.path)],checked);if(result.exitCode||checked.bytes!==file.size||checked.digest.digest('hex')!==file.sha256)throw new EngineError(422,'input_integrity','输入文件写入或校验失败');this.pinnedInputs.set(file.path,file);}
    finally{source.unpipe(checked);source.destroy();checked.destroy();}
  }
  async exec(
    command: string,
    signal?: AbortSignal,
    onOutput?: (text: string, stream: string) => void,
  ) {
    const result = await this.command(
      ["bash", "-lc", command],
      undefined,
      signal,
      onOutput,
    );
    return {
      ...result,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  }
  async snapshot(objects: Objects, tenant: string, owner: string) {
    const script = `const fs=require('fs'),p=require('path'),crypto=require('crypto');const out=[];async function scan(dir){for(const f of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','.cache','.home'].includes(f.name))continue;const file=p.join(dir,f.name);if(f.isSymbolicLink())throw Error('workspace symlinks cannot be checkpointed');if(f.isDirectory())await scan(file);else if(f.isFile()){const s=fs.statSync(file);let sha256;if(s.size>32*1024*1024){const hash=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);sha256=hash.digest('hex');}out.push({path:file.slice(11),sha256,size:s.size});if(out.length>10000)throw Error('too many files');}}}scan('/workspace').then(()=>process.stdout.write(JSON.stringify(out))).catch(e=>{process.stderr.write(e.message);process.exitCode=1;});`;
    const result = await this.command(["node", "-e", script]);
    if (result.exitCode)
      throw new EngineError(422, "workspace_snapshot", "工作区无法创建检查点");
    const files: ResourceFile[] = [];
    for (const entry of JSON.parse(result.stdout.toString()) as {path:string;sha256?:string;size:number}[]) { const path=entry.path;if(entry.sha256){const pinned=this.pinnedInputs.get(path);if(!pinned||pinned.sha256!==entry.sha256||pinned.size!==entry.size)throw new EngineError(413,"large_input_modified","大输入文件已修改，无法复用其固定版本检查点");files.push(pinned);continue;}
      const data = await this.read(path);
      files.push({ path, ...(await objects.put(tenant, owner, data)) });
    }
    return files;
  }
  async heartbeat() {
    const proc=await this.container.exec({User:'0:0',Cmd:['node','-e',"require('fs').utimesSync('/tmp/nebu-lease/heartbeat',new Date(),new Date())"],AttachStdout:true,AttachStderr:true});
    const stream=await proc.start({});
    await new Promise<void>((resolve,reject)=>{stream.on('end',resolve);stream.on('error',reject);stream.resume();});
    if((await proc.inspect()).ExitCode!==0)throw new Error('Sandbox lease heartbeat failed');
    await Promise.allSettled([...this.children].map(child => child.heartbeat()));
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    await Promise.allSettled([...this.children].map(child => child.close()));
    try {
      await this.container.remove({ force: true });
    } catch (e) {
      if (![404, 409].includes((e as { statusCode: number }).statusCode))
        throw e;
    } finally { this.onClosed?.(); }
  }
}
