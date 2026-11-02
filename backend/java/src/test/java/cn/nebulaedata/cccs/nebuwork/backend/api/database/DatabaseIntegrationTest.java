package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:databaseintegration;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false","nebu.models.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.knowledge.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.databases.enabled=true","nebu.databases.worker-enabled=false","nebu.databases.allowed-targets=127.0.0.1:43316,127.0.0.1:45436,127.0.0.1:43317"})
@ActiveProfiles("expert-local") @AutoConfigureMockMvc
class DatabaseIntegrationTest {
    @Autowired DatabaseService service;@Autowired DatabaseRuntime runtime;@Autowired ObjectMapper json;@Autowired JdbcTemplate jdbc;@Autowired MockMvc mvc;@Autowired AgentBridge bridge;
    @MockBean AccountSessionStore sessions;@MockBean DatabaseObjects objects;@MockBean AgentClient engine;
    @Autowired cn.nebulaedata.cccs.nebuwork.backend.api.expert.ExpertMapper experts;
    final Map<String,byte[]> stored=new ConcurrentHashMap<>();
    final Map<String,JsonNode> artifacts=new ConcurrentHashMap<>();final Map<String,byte[]> artifactBytes=new ConcurrentHashMap<>();
    @BeforeEach void setup(){
        for(String table:Arrays.asList("nw_database_run_grant","nw_database_operation","nw_database_snapshot","nw_database_version","nw_database","nw_agent_request"))jdbc.update("DELETE FROM "+table);stored.clear();artifacts.clear();artifactBytes.clear();
        when(sessions.findActor("alice-token")).thenReturn("alice");when(sessions.findActor("bob-token")).thenReturn("bob");
        when(objects.storage(anyString())).thenReturn("test-database-storage");
        when(objects.put(anyString(),any(byte[].class))).thenAnswer(call->{String owner=call.getArgument(0);byte[] bytes=call.getArgument(1);String digest=DatabaseObjects.digest(bytes);stored.put(owner+":"+digest,bytes.clone());return json.valueToTree(map("sha256",digest,"size",bytes.length));});
        when(objects.get(anyString(),anyString(),anyString())).thenAnswer(call->{byte[] bytes=stored.get(call.getArgument(0)+":"+call.getArgument(1));if(bytes==null)throw new IllegalStateException("Missing account snapshot");return bytes.clone();});
        when(engine.post(anyString(),nullable(String.class),anyString(),any(),anyString())).thenAnswer(call->{String owner=call.getArgument(0),project=call.getArgument(1),key=call.getArgument(4);JsonNode body=json.valueToTree(call.getArgument(3));String id="file-"+hash(owner+":"+key).substring(0,32);byte[] bytes=Base64.getDecoder().decode(body.path("contentBase64").asText());JsonNode artifact=json.valueToTree(map("id",id,"projectId",project,"name",body.path("name"),"version",1,"size",bytes.length));artifacts.put(owner+":"+id,artifact);artifactBytes.put(owner+":"+id,bytes);return artifact;});
        when(engine.get(anyString(),nullable(String.class),startsWith("/v1/artifacts/"))).thenAnswer(call->{String path=call.getArgument(2),id=path.substring("/v1/artifacts/".length()).split("\\?")[0];return artifacts.get(call.getArgument(0)+":"+id);});
        when(engine.contentBytes(anyString(),anyString(),anyString(),anyInt())).thenAnswer(call->artifactBytes.get(call.getArgument(0)+":"+call.getArgument(2)));
        if(jdbc.queryForObject("SELECT COUNT(*) FROM nw_workbench WHERE id='db-wb'",Integer.class)==0){
            jdbc.update("INSERT INTO nw_workbench(id,owner_id,name,description,icon,color,create_request_key,create_request_hash) VALUES('db-wb','alice','数据工作台','','database','#6655ee','database-test-wb','hash')");
            jdbc.update("INSERT INTO nw_ontology_version(id,workbench_id,version_number,source_revision,snapshot_json,content_hash,published_by) VALUES('db-version','db-wb',1,1,'{}','hash','alice')");
            for(String id:Arrays.asList("db-project","db-project2"))jdbc.update("INSERT INTO nw_project(id,owner_id,workbench_id,ontology_version_id,name,description,create_request_key,create_request_hash) VALUES(?,'alice','db-wb','db-version',?,'',?,'hash')",id,id,id);
            for(String id:Arrays.asList("db-expert","db-expert2"))jdbc.update("INSERT INTO nw_expert(id,name,role_label,tagline,model_name,initials,color) VALUES(?,?,'专家','','','D','#6655ee')",id,id);
        }
    }
    MockHttpServletRequestBuilder postJson(String path,Object body,String key)throws Exception{return post(path).contentType(MediaType.APPLICATION_JSON).header("Idempotency-Key",key).header("token","alice-token").content(json.writeValueAsString(body));}
    JsonNode data(MockHttpServletRequestBuilder request)throws Exception{return json.readTree(mvc.perform(request).andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8)).path("data");}
    JsonNode create(String kind,String target,String name)throws Exception{return data(postJson("/api/database-scopes/"+kind+"/"+target+"/databases",map("type","sqlite","name",name),UUID.randomUUID().toString()));}
    JsonNode operation(String database,String type,Object args)throws Exception{
        JsonNode submitted=data(postJson("/api/databases/"+database+"/operations",map("operation",type,"arguments",args),UUID.randomUUID().toString()));
        Map<String,Object> op=service.claim();assertNotNull(op);assertEquals(submitted.path("id").asText(),op.get("id"));service.process(op,()->{});return json.valueToTree(service.operation("alice",database,submitted.path("id").asText()));
    }
    JsonNode completed(String database,String type,Object args)throws Exception{JsonNode op=operation(database,type,args);assertEquals("completed",op.path("state").asText(),op.toPrettyString());return op.path("result");}
    void table(String id)throws Exception{completed(id,"create_table",map("table","records","columns",Arrays.asList(map("name","id","type","INTEGER","primaryKey",true,"autoIncrement",true),map("name","code","type","TEXT"),map("name","value","type","TEXT"))));}
    @Test void sqliteCreateWriteReadDownloadAndRequestRecovery()throws Exception{
        String key=UUID.randomUUID().toString(),path="/api/database-scopes/project/db-project/databases";Object body=map("type","sqlite","name","任务数据");JsonNode first=data(postJson(path,body,key));assertEquals(first.path("id"),data(postJson(path,body,key)).path("id"));String id=first.path("id").asText();
        mvc.perform(postJson(path,map("type","sqlite","name","不同内容"),key)).andExpect(status().isConflict());table(id);
        completed(id,"insert_rows",map("table","records","rows",Arrays.asList(map("code","0012","value","中文"),map("code","9007199254740993","value",null))));
        JsonNode rows=completed(id,"query",map("sql","SELECT code,value FROM records ORDER BY id","params",Collections.emptyList())).path("rows");assertEquals("0012",rows.get(0).get(0).asText());assertEquals("中文",rows.get(0).get(1).asText());assertTrue(rows.get(1).get(1).isNull());
        byte[] bytes=mvc.perform(get("/api/databases/"+id+"/download").header("token","alice-token")).andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();assertTrue(bytes.length>100);assertEquals("SQLite format 3\0",new String(bytes,0,16,StandardCharsets.ISO_8859_1));
        assertEquals(3,json.valueToTree(service.view("alice",id)).path("dataVersion").asInt());assertEquals(3,jdbc.queryForObject("SELECT COUNT(*) FROM nw_database_snapshot WHERE database_id=?",Integer.class,id));
        assertTrue(completed(id,"schema",map("table","records")).path("editable").asBoolean());
    }
    @Test void scopeInheritanceAndSharedExpertDefinitionRemainAccountPrivate()throws Exception{
        String common=create("workbench","db-wb","公共").path("id").asText(),project=create("project","db-project","私有").path("id").asText(),expert=create("expert","db-expert","专家").path("id").asText();
        JsonNode own=data(get("/api/database-scopes/project/db-project/databases").header("token","alice-token"));assertEquals(2,own.path("databases").size());assertTrue(own.path("databases").get(1).path("inherited").asBoolean());
        JsonNode other=data(get("/api/database-scopes/project/db-project2/databases").header("token","alice-token"));assertEquals(common,other.path("databases").get(0).path("id").asText());assertEquals(1,other.path("databases").size());
        assertEquals(0,data(get("/api/database-scopes/expert/db-expert/databases").header("token","bob-token")).path("databases").size());
        for(String id:Arrays.asList(common,project,expert))mvc.perform(get("/api/databases/"+id).header("token","bob-token")).andExpect(status().isNotFound());
        ObjectNode manifest=json.createObjectNode();manifest.putArray("businessTools");manifest.putArray("experts").add(json.valueToTree(map("id","db-expert","runtime",map("businessTools",Collections.emptyList())))).add(json.valueToTree(map("id","db-expert2","runtime",map("businessTools",Collections.emptyList()))));
        runtime.capture("alice","db-project","db-expert",manifest);assertEquals(3,manifest.path("databaseReferences").size());assertEquals(3,manifest.path("experts").get(0).path("runtime").path("databaseReferences").size());assertEquals(2,manifest.path("experts").get(1).path("runtime").path("databaseReferences").size());assertFalse(manifest.toString().contains("secretCiphertext"));
    }
    @Test void rowConflictsAndTablesWithoutUniqueKeysCannotOverwriteData()throws Exception{
        String id=create("project","db-project","行编辑").path("id").asText();table(id);completed(id,"insert_rows",map("table","records","rows",Arrays.asList(map("code","001","value","原值"))));JsonNode page=completed(id,"browse",map("table","records","page",1));String rowHash=page.path("rowHashes").get(0).asText();
        completed(id,"mutate_row",map("table","records","key",map("id",1),"rowHash",rowHash,"values",map("value","新值"),"action","update"));
        JsonNode stale=operation(id,"mutate_row",map("table","records","key",map("id",1),"rowHash",rowHash,"values",map("value","旧页面写入"),"action","update"));assertEquals(409,stale.path("errorStatus").asInt());
        completed(id,"execute",map("sql","CREATE TABLE no_key(value TEXT)"));assertFalse(completed(id,"schema",map("table","no_key")).path("editable").asBoolean());
    }
    @Test void failedSnapshotUploadAndFailedBatchKeepPreviousVersion()throws Exception{
        String id=create("project","db-project","回滚").path("id").asText();table(id);long before=json.valueToTree(service.view("alice",id)).path("dataVersion").asLong();
        JsonNode failed=operation(id,"insert_rows",map("table","records","rows",Arrays.asList(map("id",1,"value","a"),map("id",1,"value","b"))));assertEquals("failed",failed.path("state").asText());assertEquals(0,completed(id,"query",map("sql","SELECT * FROM records")).path("rowCount").asInt());
        when(objects.put(anyString(),any(byte[].class))).thenThrow(new cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException(502,"对象存储暂不可用"));assertEquals("failed",operation(id,"insert_rows",map("table","records","rows",Arrays.asList(map("value","未提交")))).path("state").asText());
        assertEquals(before,json.valueToTree(service.view("alice",id)).path("dataVersion").asLong());assertEquals(0,completed(id,"query",map("sql","SELECT * FROM records")).path("rowCount").asInt());
    }
    @Test void newRunGrantIsAdditiveAndRevocationStillApplies()throws Exception{
        ObjectNode run=json.valueToTree(map("id","root-run","ownerId","alice","projectId","db-project","manifest",map("databaseReferences",Collections.emptyList())));String original=run.toString();
        JsonNode created=json.valueToTree(runtime.tool("alice",map("id","root-task","project_id","db-project"),run,"create",json.valueToTree(map("name","智能体创建")),"agent-create-stable"));String id=created.path("id").asText();assertEquals(original,run.toString());assertNotNull(runtime.reference(run,id));
        ObjectNode child=json.valueToTree(map("id","child-run","parentRunId","root-run","ownerId","alice","projectId","db-project","manifest",map("primaryExpertId","db-expert","databaseReferences",Collections.emptyList())));assertNotNull(runtime.reference(child,id));
        ObjectNode unrelated=run.deepCopy();unrelated.put("id","unrelated-run");assertThrows(cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException.class,()->runtime.reference(unrelated,id));
        JsonNode expert=json.valueToTree(runtime.tool("alice",map("id","root-task","project_id","db-project"),child,"create",json.valueToTree(map("name","专家创建")),"expert-create-stable"));assertEquals("expert",expert.path("scopeKind").asText());assertThrows(cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException.class,()->runtime.reference(run,expert.path("id").asText()));
        service.change("alice",id,"disable",json.valueToTree(map("revision",1)));assertThrows(cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException.class,()->runtime.reference(child,id));
    }
    @Test void draftPublicationAndWritePermissionIntersectWithFrozenVersion()throws Exception{
        String id=create("project","db-project","版本").path("id").asText();table(id);JsonNode config=json.valueToTree(map("type","sqlite","name","新名称","permissions",map("write",false,"schema",false)));
        service.save("alice",id,json.valueToTree(map("revision",1,"config",config,"publish",false)));assertTrue(service.active("alice",id,1).path("permissions").path("write").asBoolean());
        service.save("alice",id,json.valueToTree(map("revision",2,"config",config,"publish",true)));assertFalse(service.active("alice",id,1).path("permissions").path("write").asBoolean());
        mvc.perform(postJson("/api/databases/"+id+"/operations",map("operation","execute","arguments",map("sql","DELETE FROM records")),UUID.randomUUID().toString())).andExpect(status().isForbidden());
        assertEquals("completed",operation(id,"query",map("sql","SELECT * FROM records")).path("state").asText());
    }
    @Test void frozenCsvImportAndExportsPreserveTextNullAndFormulaSafety()throws Exception{
        String id=create("project","db-project","导入导出").path("id").asText();String csv="code,amount,note\r\n0012,9007199254740993,\r\n=1+1,2,中文\r\n";
        MockMultipartFile file=new MockMultipartFile("file","数据.csv","text/csv",csv.getBytes(StandardCharsets.UTF_8));JsonNode source=data(multipart("/api/databases/"+id+"/imports/upload").file(file).header("Idempotency-Key","import-source-stable").header("token","alice-token"));
        JsonNode preview=data(postJson("/api/databases/"+id+"/imports/preview",map("source",source),UUID.randomUUID().toString()));assertEquals(2,preview.path("rowCount").asInt());assertEquals("0012",preview.path("rows").get(0).get(0).asText());
        Object definition=map("table","imported","columns",Arrays.asList(map("name","id","type","INTEGER","primaryKey",true,"autoIncrement",true),map("name","code","type","TEXT"),map("name","amount","type","TEXT"),map("name","note","type","TEXT")));
        completed(id,"import",map("table","imported","source",source,"createTable",definition,"mapping",Arrays.asList(map("source","code","target","code","type","text"),map("source","amount","target","amount","type","text"),map("source","note","target","note","type","text","emptyAsNull",true))));
        JsonNode rows=completed(id,"query",map("sql","SELECT code,amount,note FROM imported ORDER BY id")).path("rows");assertEquals("9007199254740993",rows.get(0).get(1).asText());assertTrue(rows.get(0).get(2).isNull());
        JsonNode exported=completed(id,"export",map("table","imported","format","csv"));String output=new String(artifactBytes.get("alice:"+exported.path("artifact").path("id").asText()),StandardCharsets.UTF_8);assertTrue(output.contains("'=1+1"));assertTrue(output.contains("0012"));
        JsonNode excel=completed(id,"export",map("table","imported","format","xlsx"));try(org.apache.poi.ss.usermodel.Workbook book=org.apache.poi.ss.usermodel.WorkbookFactory.create(new java.io.ByteArrayInputStream(artifactBytes.get("alice:"+excel.path("artifact").path("id").asText())))){
            assertEquals(org.apache.poi.ss.usermodel.CellType.STRING,book.getSheetAt(0).getRow(2).getCell(1).getCellType());assertEquals("=1+1",book.getSheetAt(0).getRow(2).getCell(1).getStringCellValue());}
        String cipher=jdbc.queryForObject("SELECT arguments_ciphertext FROM nw_database_operation WHERE database_id=? AND operation='import'",String.class,id);assertTrue(cipher.startsWith("v1:"));assertFalse(cipher.contains("9007199254740993"));
    }
    @Test void cancellationDuringExecutionRollsBackTheUnpublishedSqliteVersion()throws Exception{
        String id=create("project","db-project","取消").path("id").asText();table(id);JsonNode submitted=json.valueToTree(service.submit("alice",id,json.valueToTree(map("operation","insert_rows","arguments",map("table","records","rows",Arrays.asList(map("value","取消的数据"))))),"cancel-operation-stable",null));Map<String,Object> op=service.claim();CountDownLatch ready=new CountDownLatch(1),release=new CountDownLatch(1);AtomicInteger checks=new AtomicInteger();ExecutorService executor=Executors.newSingleThreadExecutor();
        try{Future<?> running=executor.submit(()->service.process(op,()->{if(checks.incrementAndGet()==2){ready.countDown();try{if(!release.await(10,TimeUnit.SECONDS))throw new IllegalStateException("timed out");}catch(InterruptedException e){Thread.currentThread().interrupt();}}}));assertTrue(ready.await(10,TimeUnit.SECONDS));service.cancel("alice",id,submitted.path("id").asText());release.countDown();running.get(15,TimeUnit.SECONDS);}finally{release.countDown();executor.shutdownNow();}
        assertEquals("cancelled",json.valueToTree(service.operation("alice",id,submitted.path("id").asText())).path("state").asText());assertEquals(0,completed(id,"query",map("sql","SELECT * FROM records")).path("rowCount").asInt());
    }
    @Test void queuedWritersSerializeAndUncertainExternalWritesNeverReplay()throws Exception{
        String id=create("project","db-project","串行").path("id").asText();table(id);
        for(String value:Arrays.asList("a","b"))service.submit("alice",id,json.valueToTree(map("operation","insert_rows","arguments",map("table","records","rows",Arrays.asList(map("value",value))))),"queue-writer-"+value,null);
        Map<String,Object> first=service.claim();assertNotNull(first);assertNull(service.claim());service.process(first,()->{});Map<String,Object> second=service.claim();assertNotNull(second);service.process(second,()->{});assertEquals(2,completed(id,"query",map("sql","SELECT * FROM records")).path("rowCount").asInt());
        String external=json.valueToTree(service.create("alice","project","db-project",json.valueToTree(map("type","mysql","name","外部","host","127.0.0.1","port",43316,"database","database_test","username","database_test","password","database-test-password","tls","disabled","permissions",map("read",true,"write",true))),"external-recovery-stable",null)).path("id").asText();
        JsonNode body=json.valueToTree(map("operation","execute","arguments",map("sql","INSERT INTO records(value) VALUES (?)","params",Arrays.asList("x"))));JsonNode submitted=json.valueToTree(service.submit("alice",external,body,"external-write-stable",null));Map<String,Object> claim=service.claim();assertNotNull(claim);jdbc.update("UPDATE nw_database_operation SET lease_until=? WHERE id=?",java.sql.Timestamp.from(java.time.Instant.now().minusSeconds(600)),claim.get("id"));service.recover();assertNull(service.claim());
        JsonNode recovered=json.valueToTree(service.submit("alice",external,body,"external-write-stable",null));assertEquals(submitted.path("id"),recovered.path("id"));assertEquals("unknown",recovered.path("state").asText());
    }
    @Test void existingPageHelperPaginationUsesTheCompatibleParser(){
        try{com.github.pagehelper.PageHelper.startPage(1,1);List<Map<String,Object>> page=experts.visibleExperts("alice");assertEquals(1,page.size());assertTrue(((com.github.pagehelper.Page<?>)page).getTotal()>=2);}finally{com.github.pagehelper.PageHelper.clearPage();}
    }
    @Test void uncertainExportUsesTheOriginalArtifactReceiptAndNeverRequeriesOrPublishesAgain()throws Exception{
        String id=create("project","db-project","导出恢复").path("id").asText();table(id);completed(id,"insert_rows",map("table","records","rows",Arrays.asList(map("code","0012"))));JsonNode exported=completed(id,"export",map("table","records","format","csv"));
        Map<String,Object> op=service.db.one("SELECT * FROM nw_database_operation WHERE database_id=? AND operation='export'",id);String operation=op.get("id").toString();jdbc.update("UPDATE nw_database_operation SET state='unknown',result_json=NULL WHERE id=?",operation);
        when(engine.get(eq("alice"),anyString(),startsWith("/v1/requests/artifact/"))).thenReturn(json.valueToTree(map("found",true,"result",exported.path("artifact"))));clearInvocations(engine);
        JsonNode recovered=json.valueToTree(service.reconcileExport("alice",id,operation));assertEquals("completed",recovered.path("state").asText());assertTrue(recovered.path("result").path("recovered").asBoolean());assertTrue(recovered.path("result").path("rowCount").isNull());assertEquals(exported.path("artifact").path("id"),recovered.path("result").path("artifact").path("id"));verify(engine,never()).post(anyString(),nullable(String.class),anyString(),any(),anyString());
    }
    @Test void actualAgentBridgeAndBackgroundCallbackKeepTenantIdentityAndNewDatabaseGrant()throws Exception{
        String task="runtime-task-"+UUID.randomUUID().toString().substring(0,8),session="runtime-session-"+UUID.randomUUID(),runId="runtime-run-"+UUID.randomUUID();
        jdbc.update("UPDATE nw_agent_engine_settings SET namespace='database-tests' WHERE id=1");
        jdbc.update("INSERT INTO nw_agent_task(id,owner_id,project_id,session_id,title,context_json,request_key,request_hash) VALUES(?,'alice','db-project',?,'数据库工具测试','{}',?,'hash')",task,session,task);
        ObjectNode manifest=json.valueToTree(map("databaseReferences",Collections.emptyList(),"businessTools",runtime.tools(),"instructions",Collections.emptyList()));
        ObjectNode run=json.valueToTree(map("id",runId,"tenantId","database-tests","ownerId","alice","projectId","db-project","sessionId",session,"status","running","manifestHash","database-frozen-hash","manifest",manifest));
        when(engine.get(eq("alice"),eq("db-project"),eq("/v1/runs/"+runId))).thenReturn(run);
        ObjectNode identity=json.valueToTree(map("tenantId","database-tests","ownerId","alice","projectId","db-project","sessionId",session,"runId",runId,"manifestHash","database-frozen-hash","capability","database","operation","create","callId","create-call","arguments",map("name","同轮新建库")));
        JsonNode created=json.valueToTree(bridge.execute(identity));String id=created.path("id").asText();assertTrue(id.startsWith("db-"));assertEquals(0,manifest.path("databaseReferences").size());
        identity.put("operation","query").put("callId","query-call").set("arguments",json.valueToTree(map("databaseId",id,"sql","SELECT 1 AS confirmed")));
        JsonNode submitted=json.valueToTree(bridge.execute(identity));Map<String,Object> op=service.claim();assertNotNull(op);JsonNode storedIdentity=decode(json,op.get("identity_json"));assertEquals("database-tests",storedIdentity.path("tenantId").asText());
        service.process(op,()->runtime.authorizeOperation(op));JsonNode result=json.valueToTree(service.operation("alice",id,submitted.path("id").asText()));assertEquals("completed",result.path("state").asText(),result.toString());assertEquals(1,result.path("result").path("rows").get(0).get(0).asInt());
    }
    @Test @EnabledIfEnvironmentVariable(named="NEBU_DATABASE_INTEGRATION",matches="true") void realMysqlMariaDbAndPostgresConnectionsHaveReadOnlyDefaultsAndAuthorizedWrites()throws Exception{
        for(int port:Arrays.asList(43316,43317,45436)){
            String type=port==45436?"postgresql":"mysql";JsonNode c=json.valueToTree(map("type",type,"name",type+port,"host","127.0.0.1","port",port,"database","database_test","schema","public","username","database_test","password","database-test-password","tls","disabled"));
            JsonNode created=data(postJson("/api/database-scopes/project/db-project/databases",c,UUID.randomUUID().toString()));String id=created.path("id").asText();assertFalse(created.path("permissions").path("write").asBoolean());assertFalse(created.toString().contains("database-test-password"));assertEquals("ready",json.valueToTree(service.test("alice",id)).path("status").asText());
            mvc.perform(postJson("/api/databases/"+id+"/operations",map("operation","execute","arguments",map("sql","CREATE TABLE forbidden(id INTEGER)")),UUID.randomUUID().toString())).andExpect(status().isForbidden());
            ObjectNode updated=c.deepCopy();updated.set("permissions",json.valueToTree(map("read",true,"write",true,"schema",true)));service.save("alice",id,json.valueToTree(map("revision",1,"config",updated,"publish",true)));
            completed(id,"execute",map("sql","DROP TABLE IF EXISTS records"));table(id);completed(id,"insert_rows",map("table","records","rows",Arrays.asList(map("code","0012","value","中文"))));
            JsonNode page=completed(id,"browse",map("table","records","page",1));assertEquals("0012",page.path("rows").get(0).get(1).asText());assertTrue(page.path("structure").path("editable").asBoolean());
            completed(id,"mutate_row",map("table","records","action","update","key",map("id",page.path("rows").get(0).get(0)),"rowHash",page.path("rowHashes").get(0),"values",map("value","已修改")));
            assertEquals("已修改",completed(id,"query",map("sql","SELECT value FROM records")).path("rows").get(0).get(0).asText());
            completed(id,"execute",map("sql","DROP TABLE IF EXISTS large_keys"));completed(id,"execute",map("sql","CREATE TABLE large_keys(id BIGINT PRIMARY KEY, value TEXT)"));completed(id,"insert_rows",map("table","large_keys","rows",Arrays.asList(map("id","9007199254740993","value","before"))));JsonNode large=completed(id,"browse",map("table","large_keys","filters",Arrays.asList(map("column","id","operator","contains","value","9007"))));assertEquals("9007199254740993",large.path("rows").get(0).get(0).asText());
            completed(id,"mutate_row",map("table","large_keys","action","update","key",map("id",large.path("rows").get(0).get(0)),"rowHash",large.path("rowHashes").get(0),"values",map("value","after")));
        }
    }
}
