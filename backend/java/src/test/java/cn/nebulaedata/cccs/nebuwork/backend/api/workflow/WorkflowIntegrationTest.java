package cn.nebulaedata.cccs.nebuwork.backend.api.workflow;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.BackgroundJobScheduling;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Isolated H2 and mocked upstream calls. Never connects to the deployed workflow service. */
class WorkflowIntegrationTest {
    ObjectMapper json=new ObjectMapper();JdbcTemplate jdbc;WorkflowStore db;WorkflowSettings settings;WorkflowService service;WorkflowClient client;WorkflowWorker worker;
    TransactionTemplate tx;MockEnvironment env;
    @BeforeEach void setup() {
        DriverManagerDataSource ds=new DriverManagerDataSource("jdbc:h2:mem:workflow"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","sa","");
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V14__workflow_integration.sql")).execute(ds);
        jdbc=new JdbcTemplate(ds);db=new WorkflowStore(jdbc);DataSourceTransactionManager manager=new DataSourceTransactionManager(ds);tx=new TransactionTemplate(manager);
        env=new MockEnvironment().withProperty("nebu.workflow.admin-ids"," admin ").withProperty("nebu.models.encryption-key",Base64.getEncoder().encodeToString(new byte[32]));
        client=mock(WorkflowClient.class);settings=new WorkflowSettings(db,new ModelSecretCipher(env),env,json,client);service=new WorkflowService(db,settings,client,json);worker=new WorkflowWorker(db,settings,client,manager);
    }
    @AfterEach void close() { worker.close();jdbc.execute("DROP ALL OBJECTS"); }
    ObjectNode body(long revision) {return json.valueToTree(map("revision",revision,"enabled",true,"baseUrl","http://127.0.0.1:8765","requestTimeoutMs",15000));}
    JsonNode save(ObjectNode body,String key) {return json.valueToTree(tx.execute(s->settings.save("admin",body,key)));}
    void enable() {save(body(0),"enable-workflow");}
    JsonNode create(String owner,String key) {return json.valueToTree(tx.execute(s->service.create(owner,json.valueToTree(map("name","真实流程","description","说明")),key)));}
    @Test void administratorOnlySettingsAreEncryptedIdempotentAndLockTheDestination() {
        assertFalse(json.valueToTree(settings.read("alice")).has("baseUrl"));
        assertEquals(403,assertThrows(ApiException.class,()->settings.save("alice",body(0),"deny-settings")).status);
        ObjectNode b=body(0).put("apiKey","secret-never-returned");JsonNode saved=save(b,"save-credential");assertFalse(saved.toString().contains("secret-never-returned"));
        assertFalse(db.settings(false).get("api_key_cipher").toString().contains("secret-never-returned"));
        assertEquals(saved,save(b,"save-credential"));assertEquals(1,db.rows("SELECT * FROM nw_workflow_settings_audit").size());
        assertEquals(409,assertThrows(ApiException.class,()->save(body(0),"stale-settings")).status);
        create("alice","create-lock-origin");
        assertEquals(409,assertThrows(ApiException.class,()->save(body(1).put("baseUrl","http://other:8765").put("clearApiKey",true),"move-origin-denied")).status);
        assertTrue(json.valueToTree(settings.read("admin")).path("originLocked").asBoolean());
    }
    @Test void connectionTestChecksIdentityCompatibilityAndSchedulerWithoutCreatingTasks() {
        when(client.request(any(),eq("GET"),eq("/api/v1/health"),isNull())).thenReturn(json.valueToTree(map("service","nebulae-workflow","integration_version",1,"status","ok","scheduler",true)));
        assertTrue(json.valueToTree(settings.test("admin",body(0))).path("reachable").asBoolean());
        assertFalse(json.valueToTree(settings.read("admin")).path("configured").asBoolean());
        verify(client).request(any(),eq("GET"),eq("/api/v1/health"),isNull());verifyNoMoreInteractions(client);
    }
    @Test void scheduledWorkerConsumesPendingCreationWithoutManualDispatch() throws Exception {
        enable();String id=create("alice","scheduled-workflow-create").path("id").asText();
        String remote=WorkflowStore.str(db.owned("nw_workflow",id,"alice"),"remote_id");
        when(client.request(any(),eq("GET"),eq("/api/v1/workflows/"+remote),isNull())).thenThrow(new WorkflowClient.Failure(404,"不存在"));
        when(client.request(any(),eq("POST"),eq("/api/v1/workflows"),any())).thenReturn(json.valueToTree(map("id",remote,"error",null)));
        try(AnnotationConfigApplicationContext context=new AnnotationConfigApplicationContext()) {
            context.register(BackgroundJobScheduling.class);
            context.registerBean("workflowWorker",WorkflowWorker.class,()->worker);
            context.refresh();
            long deadline=System.nanoTime()+java.util.concurrent.TimeUnit.SECONDS.toNanos(5);
            while(!"ready".equals(db.owned("nw_workflow",id,"alice").get("state"))&&System.nanoTime()<deadline)Thread.sleep(20);
            assertEquals("ready",db.owned("nw_workflow",id,"alice").get("state"));
            verify(client,times(1)).request(any(),eq("POST"),eq("/api/v1/workflows"),eq(map("id",remote,"name","真实流程")));
        }
    }
    @Test void creationAndSopLinksAreAccountScopedAndRetriesKeepTheOriginalRemoteId() {
        enable();JsonNode first=create("alice","create-once-key"),duplicate=create("alice","create-once-key");assertEquals(first,duplicate);
        String id=first.path("id").asText(),remote=WorkflowStore.str(db.owned("nw_workflow",id,"alice"),"remote_id");
        tx.execute(s->{service.link("alice","shared-sop",id);return null;});
        assertNull(service.forSop("bob","shared-sop"));assertEquals(id,service.forSop("alice","shared-sop").get("id"));
        assertEquals(404,assertThrows(ApiException.class,()->service.get("bob",id)).status);verifyNoInteractions(client);
        db.update("UPDATE nw_workflow SET state='failed',error='response lost' WHERE id=?",id);
        service.retry("alice",id,false);assertEquals(remote,db.owned("nw_workflow",id,"alice").get("remote_id"));
        when(client.request(any(),eq("GET"),eq("/api/v1/workflows/"+remote),isNull())).thenReturn(json.valueToTree(map("id",remote,"name","真实流程","error",null)));
        worker.process("nw_workflow",id);assertEquals("ready",db.owned("nw_workflow",id,"alice").get("state"));
        verify(client,never()).request(any(),eq("POST"),eq("/api/v1/workflows"),any());
        service.unlinkSop("shared-sop");assertNull(service.forSop("alice","shared-sop"));assertNotNull(db.owned("nw_workflow",id,"alice"));
    }
    @Test void taskSubmissionUsesDurableCreateAndStartCommandsAndAllowsManualResumeAfterRestart() {
        enable();String workflow=create("alice","workflow-for-task").path("id").asText();db.update("UPDATE nw_workflow SET state='ready' WHERE id=?",workflow);
        JsonNode input=json.valueToTree(map("input",map("text","hello")));
        JsonNode task=json.valueToTree(tx.execute(s->service.createTask("alice",workflow,input,"task-create-once")));
        assertEquals(task,json.valueToTree(tx.execute(s->service.createTask("alice",workflow,input,"task-create-once"))));
        String id=task.path("id").asText();
        when(client.request(any(),eq("POST"),eq("/api/v1/tasks"),any())).thenReturn(json.valueToTree(map("id","remote-task","version",0)));
        when(client.request(any(),eq("POST"),eq("/api/v1/tasks/remote-task/actions/start"),any())).thenThrow(new WorkflowClient.Failure(409,"请手动恢复"));
        worker.process("nw_workflow_task",id);assertEquals("failed",db.owned("nw_workflow_task",id,"alice").get("state"));
        when(client.request(any(),eq("GET"),eq("/api/v1/tasks/remote-task"),isNull())).thenReturn(json.valueToTree(map("id","remote-task","state","waiting_manual")));
        assertEquals("waiting_manual",json.valueToTree(service.task("alice",id)).path("task").path("state").asText());
        assertEquals(404,assertThrows(ApiException.class,()->service.events("bob",id,0)).status);
        when(client.request(any(),eq("POST"),eq("/api/v1/tasks/remote-task/actions/resume"),any())).thenReturn(json.valueToTree(map("state","queued")));
        service.control("alice",id,"resume",json.valueToTree(map("expected_version",1)),"manual-resume-key");assertEquals("ready",db.owned("nw_workflow_task",id,"alice").get("state"));
        verify(client).request(any(),eq("POST"),eq("/api/v1/tasks"),eq(map("workflow_id",db.owned("nw_workflow",workflow,"alice").get("remote_id"),"input",input.get("input"),"command_id",id+"-create")));
    }
    @Test void lostWorkflowCreateResponseRecoversWithoutCreatingAgain() {
        enable();String id=create("alice","workflow-response-lost").path("id").asText();
        String remote=WorkflowStore.str(db.owned("nw_workflow",id,"alice"),"remote_id");
        when(client.request(any(),eq("GET"),eq("/api/v1/workflows/"+remote),isNull()))
            .thenThrow(new WorkflowClient.Failure(404,"不存在")).thenReturn(json.valueToTree(map("id",remote,"error",null)));
        when(client.request(any(),eq("POST"),eq("/api/v1/workflows"),any())).thenThrow(new WorkflowClient.Failure(0,"创建响应丢失"));
        worker.process("nw_workflow",id);assertEquals("failed",db.owned("nw_workflow",id,"alice").get("state"));
        service.retry("alice",id,false);worker.process("nw_workflow",id);assertEquals("ready",db.owned("nw_workflow",id,"alice").get("state"));
        verify(client,times(1)).request(any(),eq("POST"),eq("/api/v1/workflows"),eq(map("id",remote,"name","真实流程")));
    }
    @Test void artifactIdsCannotEscapeTheOwnedWorkflowAndWritesKeepUpstreamRevision() {
        enable();String id=create("alice","workflow-artifacts").path("id").asText();db.update("UPDATE nw_workflow SET state='ready' WHERE id=?",id);
        String remote=WorkflowStore.str(db.owned("nw_workflow",id,"alice"),"remote_id");
        when(client.request(any(),eq("GET"),eq("/api/v1/workflows/"+remote+"/artifacts"),isNull())).thenReturn(json.valueToTree(Arrays.asList(map("id","owned-artifact"))));
        assertEquals(404,assertThrows(ApiException.class,()->service.content("alice",id,"another-owner-artifact")).status);
        verify(client,never()).request(any(),eq("GET"),eq("/api/v1/artifacts/another-owner-artifact/content"),isNull());
        when(client.request(any(),eq("PUT"),eq("/api/v1/workflows/"+remote+"/source?path=main.py"),any())).thenThrow(new WorkflowClient.Failure(409,"源码已变化"));
        assertEquals(409,assertThrows(ApiException.class,()->service.source("alice",id,"main.py",json.valueToTree(map("content","def run(ctx): pass","expected_revision","old")))).status);
    }
    @Test void migrationReplayKeepsSavedConfigurationAndExistingRecords() {
        enable();create("alice","migration-existing-workflow");
        DriverManagerDataSource source=(DriverManagerDataSource)jdbc.getDataSource();new ResourceDatabasePopulator(new ClassPathResource("db/migration/V14__workflow_integration.sql")).execute(source);
        assertEquals(1,WorkflowStore.number(db.settings(false),"revision"));assertEquals(1,db.rows("SELECT id FROM nw_workflow").size());
    }
    @Test void inputPresetsPassThroughWithRevisionAndEditedInputsStayAccountScoped() {
        enable();String id=create("alice","workflow-input-presets").path("id").asText();db.update("UPDATE nw_workflow SET state='ready' WHERE id=?",id);
        String remote=WorkflowStore.str(db.owned("nw_workflow",id,"alice"),"remote_id");
        JsonNode presets=json.valueToTree(Arrays.asList(map("id","normal","name","处理文本","description","按输入执行",
            "input",map("text","预设文本","options",map("enabled",false)),"fields",map("/text","待处理内容","/options/enabled","是否启用附加处理"))));
        JsonNode definition=json.valueToTree(map("name","真实流程","steps",map("main",map("code","main.py:run")),"input_presets",presets));
        JsonNode body=json.valueToTree(map("definition",definition,"expected_revision","revision-1"));
        when(client.request(any(),eq("POST"),eq("/api/v1/workflows/"+remote+"/validate"),any())).thenReturn(definition);
        assertEquals(definition,service.validate("alice",id,json.valueToTree(map("definition",definition))));
        when(client.request(any(),eq("PUT"),eq("/api/v1/workflows/"+remote+"/definition"),any())).thenReturn(json.valueToTree(map("name","真实流程","definition",definition,"revision","revision-2")));
        assertEquals(presets,json.valueToTree(service.definition("alice",id,body)).path("definition").path("input_presets"));
        verify(client).request(any(),eq("PUT"),eq("/api/v1/workflows/"+remote+"/definition"),eq(body));
        assertEquals(404,assertThrows(ApiException.class,()->service.definition("bob",id,body)).status);
        JsonNode edited=json.valueToTree(map("input",map("text","用户修改","options",map("enabled",true))));
        JsonNode task=json.valueToTree(tx.execute(s->service.createTask("alice",id,edited,"edited-preset-input")));
        assertEquals(edited.path("input"),settings.decode(WorkflowStore.str(db.owned("nw_workflow_task",task.path("id").asText(),"alice"),"input_json")));
        assertEquals(task,json.valueToTree(tx.execute(s->service.createTask("alice",id,edited,"edited-preset-input"))));
        assertEquals(404,assertThrows(ApiException.class,()->service.createTask("bob",id,edited,"another-owner-input")).status);
        when(client.request(any(),eq("PUT"),eq("/api/v1/workflows/"+remote+"/definition"),any())).thenThrow(new WorkflowClient.Failure(409,"版本冲突"));
        assertEquals(409,assertThrows(ApiException.class,()->service.definition("alice",id,body)).status);
    }
}
