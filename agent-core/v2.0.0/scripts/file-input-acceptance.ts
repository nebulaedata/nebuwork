import { createUuid } from '../src/uuid.js';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Objects} from '../src/objects.js';
import {DockerSandbox} from '../src/sandbox.js';
import {testConfig} from '../tests/fixture.js';
import type {Principal} from '../src/contracts.js';

// Opt-in against the isolated file-preview fixture ONLY; no shared credentials.
const artifactId=process.argv[2];if(!artifactId)throw Error('Supply an isolated acceptance artifact ID');
process.env.FILE_TRANSFERS_ENABLED='true';
const store=new Store(testConfig.DATABASE_URL),objects=new Objects(testConfig);
const principal:Principal={service:'file-preview-test',tenantId:'file-preview-browser',ownerId:'alice',projects:['project'],scopes:['engine:*']};
let sandbox: DockerSandbox|undefined,heartbeat:ReturnType<typeof setInterval>|undefined,peak=process.memoryUsage().rss;
const monitor=setInterval(()=>peak=Math.max(peak,process.memoryUsage().rss),100);
try{
  const artifact=await store.artifact(principal,artifactId,1);assert.equal(artifact.size,2147483648);
  sandbox=await DockerSandbox.create({...testConfig,LEASE_MS:120000},createUuid(),1);
  heartbeat=setInterval(()=>{void sandbox?.heartbeat();},10000);
  const file={path:'inputs/large.csv',objectKey:artifact.objectKey,sha256:artifact.sha256,size:artifact.size};
  await sandbox.materialize(file,objects);
  const sample=await sandbox.exec("tail -c 1048576 inputs/large.csv | head -c 10");assert.equal(sample.exitCode,0);assert.equal(sample.stdout,'row002047,');
  const checkpoint=await sandbox.snapshot(objects,principal.tenantId,principal.ownerId);assert.deepEqual(checkpoint,[file]);
  console.log(JSON.stringify({size:artifact.size,tail:sample.stdout,checkpointReusesImmutableObject:true,peakRssMiB:peak/1048576}));
}finally{clearInterval(monitor);if(heartbeat)clearInterval(heartbeat);await sandbox?.close();await store.close();objects.client.destroy();}
