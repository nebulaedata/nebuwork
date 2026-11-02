package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.NebulaeV1HttpDriver;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.mock.mockito.SpyBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:agentintegration;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false","nebu.models.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.knowledge.admin-ids=admin","nebu.knowledge.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.agent.base-url=http://engine.invalid","nebu.agent.signing-key=12345678901234567890123456789012","nebu.agent.callback-key=callback-key-1234567890123456789012","nebu.agent.namespace=nebuwork-v2"})
@ActiveProfiles("expert-local") @AutoConfigureMockMvc
class AgentIntegrationTest {
    @Autowired MockMvc mvc; @Autowired ObjectMapper json; @Autowired JdbcTemplate jdbc;
    @Autowired AgentBridge bridge; @Autowired RuntimeResources resources;
    @Autowired cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher cipher;
    @MockBean AccountSessionStore sessions; @MockBean AgentClient engine;
    @SpyBean NebulaeV1HttpDriver knowledgeDriver;
    @SpyBean KnowledgeEvidence evidence;
    final Map<String,JsonNode> remoteSessions=new HashMap<>(),remoteRuns=new HashMap<>();
    final Map<String,JsonNode> requests=new HashMap<>();
    String provider;
    @BeforeEach void setup() throws Exception {
        AgentTestSettings.seed(jdbc,cipher,"http://engine.invalid","nebuwork-v2","12345678901234567890123456789012","callback-key-1234567890123456789012");
        for(String table:Arrays.asList("nw_knowledge_evidence","nw_agent_call","nw_agent_task","nw_agent_resource_version","nw_agent_resource","nw_agent_credential","nw_knowledge_reference","nw_knowledge_scope","nw_knowledge_publication","nw_knowledge_library_access","nw_knowledge_library","nw_knowledge_connection","nw_project","nw_workbench_agent","nw_workbench_case","nw_workbench_draft","nw_ontology_version","nw_workbench","nw_user_model_settings","nw_model_provider"))jdbc.update("DELETE FROM "+table);
        remoteSessions.clear();remoteRuns.clear();requests.clear();
        when(sessions.findActor("alice-token")).thenReturn("alice");when(sessions.findActor("bob-token")).thenReturn("bob");
        when(sessions.findActor("admin-token")).thenReturn("admin");
        when(engine.post(anyString(),nullable(String.class),anyString(),any(),anyString())).thenAnswer(call->{
            String owner=call.getArgument(0),project=call.getArgument(1),path=call.getArgument(2),key=call.getArgument(4);JsonNode body=json.valueToTree(call.getArgument(3));
            if(requests.containsKey(key))return requests.get(key);
            JsonNode result;
            if(path.equals("/v1/runtime-bundles"))result=json.valueToTree(map("id",body.path("id"),"version",body.path("version"),"hash","hash-"+key));
            else if(path.equals("/v1/sessions")){String id="s-"+UUID.randomUUID();result=json.valueToTree(map("id",id,"ownerId",owner,"projectId",project,"taskId",body.path("taskId"),"title",body.path("title"),"cursor",0));remoteSessions.put(id,result);}
            else if(path.endsWith("/runs")){String session=path.split("/")[3],id="r-"+UUID.randomUUID();result=json.valueToTree(map("id",id,"sessionId",session,"tenantId","nebuwork-v2","ownerId",owner,"projectId",project,"taskId",remoteSessions.get(session).path("taskId"),"status","preparing","input",body));remoteRuns.put(id,result);}
            else result=json.createObjectNode();requests.put(key,result);return result;
        });
        when(engine.get(anyString(),nullable(String.class),anyString())).thenAnswer(call->{String path=call.getArgument(2);if(path.startsWith("/v1/runs/"))return remoteRuns.get(path.substring(9));if(path.matches("/v1/sessions/[^/]+")){String id=path.substring(13);List<JsonNode> runs=new ArrayList<>();for(JsonNode run:remoteRuns.values())if(id.equals(run.path("sessionId").asText()))runs.add(run);return json.valueToTree(map("session",remoteSessions.get(id),"events",Collections.emptyList(),"cursor",0,"runs",runs));}return json.valueToTree(map("items",path.endsWith("/sessions")?remoteSessions.values():Collections.emptyList()));});
        provider=data(postJson("/api/model-providers",map("type","custom","baseUrl","https://models.example/v1","apiKey","private-model-key","model","configured-model")),"alice").path("id").asText();
    }
    MockHttpServletRequestBuilder postJson(String path,Object body)throws Exception{MockHttpServletRequestBuilder request=post(path).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));if(path.startsWith("/api/runtime-"))request.header("Idempotency-Key",UUID.randomUUID().toString());return request;}
    JsonNode data(MockHttpServletRequestBuilder request,String owner)throws Exception{return json.readTree(mvc.perform(request.header("token",owner+"-token").header("userId","forged")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8)).path("data");}
    String workbench(String... expertIds)throws Exception{
        String id=data(postJson("/api/workbenches",map("name","新工作台")).header("Idempotency-Key",UUID.randomUUID().toString()),"alice").path("id").asText();
        data(postJson("/api/workbenches/"+id+"/config",map("revision",1,"bizName","研究","domain","分析","bizDef","完成有来源的分析")),"alice");
        ObjectNode doc=RuntimeResources.empty(json);doc.put("modelProviderId",provider);doc.withArray("instructions").add(json.valueToTree(map("source","workbench","path","AGENTS.md","scope","","content","引用证据","revision","1")));
        data(postJson("/api/runtime-resources/workbench/"+id,map("revision",0,"document",doc)),"alice");
        long revision=2;for(String expert:expertIds)data(postJson("/api/workbenches/"+id+"/bindings/agents/"+expert,map("enabled",true,"revision",revision++)),"alice");
        data(postJson("/api/workbenches/"+id+"/publish",map("revision",revision)),"alice");return id;
    }
    String project(String workbench)throws Exception{return data(postJson("/api/projects",map("name","新项目","workbenchId",workbench)).header("Idempotency-Key",UUID.randomUUID().toString()),"alice").path("id").asText();}
    @Test void publicationProjectAndIdempotentTaskUseOnlyNewEngine()throws Exception{
        String wb=workbench(),project=project(wb);String key=UUID.randomUUID().toString();Map<String,Object> body=map("title","任务","content","分析资料");
        JsonNode first=data(postJson("/api/projects/"+project+"/tasks",body).header("Idempotency-Key",key),"alice"),second=data(postJson("/api/projects/"+project+"/tasks",body).header("Idempotency-Key",key),"alice");
        assertEquals(first.path("task").path("id"),second.path("task").path("id"));assertEquals(1,remoteSessions.size());assertEquals(1,remoteRuns.size());
        assertEquals(1,data(get("/api/projects/"+project),"alice").path("sessions").size());
        mvc.perform(postJson("/api/projects/"+project+"/tasks",map("title","不同任务")).header("Idempotency-Key",key).header("token","alice-token")).andExpect(status().isConflict());
        mvc.perform(get("/api/tasks/"+first.path("task").path("id").asText()).header("token","bob-token")).andExpect(status().isNotFound());
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM nw_core_sync_job",Integer.class));
        assertFalse(first.toString().contains("private-model-key"));
    }
    @Test void latestPublishedResourcesAndScopedOverridesProduceCredentialFreeManifest()throws Exception{
        String wb=workbench(),project=project(wb);JsonNode detail=data(postJson("/api/projects/"+project+"/tasks",map("title","范围测试","content","分析")).header("Idempotency-Key",UUID.randomUUID().toString()),"alice");
        JsonNode run=detail.path("runs").get(0);ObjectNode request=run.deepCopy();request.put("runId",run.path("id").asText());
        JsonNode first=json.valueToTree(bridge.context(request));assertEquals("configured-model",first.path("model").path("model").asText());assertTrue(first.path("instructions").toString().contains("引用证据"));assertFalse(first.toString().contains("private-model-key"));
        ObjectNode doc=RuntimeResources.empty(json);doc.put("modelProviderId",provider);doc.withArray("instructions").add(json.valueToTree(map("source","workbench","path","AGENTS.md","scope","","content","新指令","revision","2")));
        resources.save("alice","workbench",wb,json.valueToTree(map("revision",1,"document",doc)));
        assertEquals(first.path("instructions"),json.valueToTree(bridge.context(request)).path("instructions"));
        resources.publish("alice","workbench",wb,2);JsonNode next=json.valueToTree(bridge.context(request));assertTrue(next.path("instructions").toString().contains("新指令"));assertFalse(first.path("instructions").toString().contains("新指令"));
        ((ObjectNode)remoteRuns.get(run.path("id").asText())).set("manifest",first);
        request.put("kind","model").put("credentialRef","model:"+provider);assertEquals("private-model-key",json.valueToTree(bridge.credentials(request)).path("apiKey").asText());
        request.put("ownerId","bob");assertThrows(RuntimeException.class,()->bridge.credentials(request));
    }
    @Test void serviceIdentityRequiredAndResourceFailuresPrecedePublication()throws Exception{
        mvc.perform(postJson("/internal/agent/context",map("ownerId","alice"))).andExpect(status().isUnauthorized());
        String wb=workbench();ObjectNode bad=RuntimeResources.empty(json);bad.put("modelProviderId",provider);bad.withArray("skills").add(json.valueToTree(map("id","s","directory","skills/missing")));
        mvc.perform(postJson("/api/runtime-resources/workbench/"+wb,map("revision",1,"document",bad)).header("token","alice-token")).andExpect(status().isUnprocessableEntity());
        assertThrows(RuntimeException.class,()->resources.path("../secret"));assertEquals("x/AGENTS.md",resources.path("x/agent.md"));
        JsonNode view=json.valueToTree(resources.view("alice","workbench",wb));assertEquals(1,view.path("revision").asInt());
    }
    @Test void expertProjectAndWorkbenchUseOneTokenLedgerAndFreezePrimaryIdentity()throws Exception{
        String expert=publishedExpert("计量主专家"),unused=publishedExpert("未调用专家"),wb=workbench(expert,unused),project=project(wb);
        JsonNode detail=data(postJson("/api/projects/"+project+"/tasks",map("title","计量任务","content","分析","context",map("expertId",expert))).header("Idempotency-Key",UUID.randomUUID().toString()),"alice");
        String task=detail.path("task").path("id").asText();ObjectNode request=detail.path("runs").get(0).deepCopy();request.put("runId",request.path("id").asText());
        assertEquals(expert,json.valueToTree(bridge.context(request)).path("primaryExpertId").asText());
        Map<String,Object> sum=map("totalTokens",200,"inputTokens",100,"outputTokens",100,"cacheReadTokens",0,"cacheWriteTokens",0,"callCount",3,"unknownCalls",0,"pendingCalls",0,"usageKnown",true,"tasks",1,"activeRuns",0,"successRate",100);
        Map<String,Object> measuredTask=new LinkedHashMap<>(sum);measuredTask.putAll(map("taskId",task,"projectId",project,"status","completed","updatedAt","2026-10-16T01:00:00Z"));
        Map<String,Object> measuredProject=new LinkedHashMap<>(sum);measuredProject.put("id",project);
        Map<String,Object> measuredExpert=new LinkedHashMap<>(sum);measuredExpert.putAll(map("id",expert,"totalTokens",100));
        JsonNode activity=json.valueToTree(map("summary",sum,"tasks",Collections.singletonList(measuredTask),"projects",Collections.singletonList(measuredProject),"experts",Collections.singletonList(measuredExpert),"projectDaily",Collections.singletonList(map("projectId",project,"date","2026-10-16","totalTokens",200,"usageKnown",true))));
        doReturn(activity).when(engine).get("alice",null,"/v1/usage");doReturn(activity).when(engine).get("alice",project,"/v1/usage?projectId="+project);
        JsonNode projects=data(get("/api/projects"),"alice");assertEquals(200,projects.get(0).path("stats").path("tokens").asInt());assertEquals(1,projects.get(0).path("stats").path("tasks").asInt());
        assertEquals(200,data(get("/api/workbenches"),"alice").get(0).path("taskStats").path("tokens").asInt());
        assertEquals(200,data(get("/api/projects/"+project),"alice").path("usage").path("totalTokens").asInt());
        JsonNode experts=data(get("/api/agents"),"alice");for(JsonNode item:experts){if(expert.equals(item.path("id").asText()))assertEquals(100,item.path("stats").path("tokens").asInt());if(unused.equals(item.path("id").asText()))assertEquals(0,item.path("stats").path("tasks").asInt());}
        measuredTask.putAll(map("totalTokens",100,"role","primary","participatedAt","2026-10-16T01:00:00Z"));
        doReturn(json.valueToTree(map("summary",measuredExpert,"taskTotal",1,"tasks",Collections.singletonList(measuredTask),"daily",Collections.emptyList(),"taskStates",Collections.singletonList(map("status","completed"))))).when(engine).get("alice",null,"/v1/experts/"+expert+"/tasks?offset=0&limit=50");
        JsonNode expertDetail=data(get("/api/agents/"+expert),"alice");assertEquals(task,expertDetail.path("tasks").get(0).path("id").asText());assertEquals(100,expertDetail.path("agent").path("stats").path("tokens").asInt());assertTrue(expertDetail.path("agent").path("stats").path("cost").isNull());
        assertEquals(0,data(get("/api/projects"),"bob").size());
        doThrow(new ApiException(502,"offline")).when(engine).get("alice",null,"/v1/usage");
        JsonNode offline=data(get("/api/workbenches"),"alice").get(0).path("taskStats");assertTrue(offline.path("unavailable").asBoolean());assertTrue(offline.path("tokens").isNull());
    }
    @Test void publishedExpertIncludesSopAndPinnedSharedMaterial()throws Exception {
        String expert=data(postJson("/api/agents",map("name","素材专家","role","分析","modelProviderId",provider,"tagline","分析")),"alice").path("id").asText(),sop="sop-"+UUID.randomUUID(),material="mat-"+UUID.randomUUID();
        jdbc.update("INSERT INTO nw_sop(id,expert_id,name,kind,description,definition_json,sort_order) VALUES(?,?,?,?,?,?,?)",sop,expert,"核验资料","process","先阅读参考资料","{\"steps\":[\"核验来源\"]}",0);
        jdbc.update("INSERT INTO nw_sop_material(id,sop_id,display_name,artifact_id,artifact_version,artifact_owner_id,byte_size,sha256) VALUES(?,?,?,?,?,?,?,?)",material,sop,"evidence.txt","artifact-evidence",2,"alice",8,"hash");
        when(engine.get(eq("alice"),eq("expert-"+expert),eq("/v1/artifacts/artifact-evidence?version=2"))).thenReturn(json.valueToTree(map("objectKey","alice/hash","sha256","hash","size",8,"mediaType","text/plain")));
        ObjectNode document=RuntimeResources.empty(json);document.put("modelProviderId",provider);resources.save("alice","expert",expert,json.valueToTree(map("revision",0,"document",document)));resources.publish("alice","expert",expert,1);
        org.mockito.ArgumentCaptor<Object> capture=org.mockito.ArgumentCaptor.forClass(Object.class);verify(engine).post(eq("alice"),isNull(),eq("/v1/runtime-bundles"),capture.capture(),anyString());
        JsonNode published=json.valueToTree(capture.getValue());assertTrue(published.path("instructions").toString().contains("核验来源"));assertTrue(published.path("instructions").toString().contains("v2"));assertEquals("alice/hash",published.path("files").get(0).path("objectKey").asText());assertTrue(published.path("files").get(0).path("path").asText().endsWith("/evidence.txt"));
    }

    String publishedExpert(String name)throws Exception{
        String expert=data(postJson("/api/agents",map("name",name,"role","分析","modelProviderId",provider,"tagline","分析")),"alice").path("id").asText();
        ObjectNode document=RuntimeResources.empty(json);document.put("modelProviderId",provider);resources.save("alice","expert",expert,json.valueToTree(map("revision",0,"document",document)));resources.publish("alice","expert",expert,1);return expert;
    }
    String knowledgeConnection()throws Exception{
        doAnswer(call->{String operation=call.getArgument(2);if("collections".equals(operation))return json.valueToTree(map("collections",Arrays.asList(map("id","law","name","法律法规库"),map("id","finance","name","财务库"),map("id","shared","name","项目公共库"))));return json.valueToTree(map("results",Collections.singletonList(map("documentId","law-doc","content","已检索原文"))));}).when(knowledgeDriver).execute(anyString(),anyMap(),anyString(),nullable(String.class),any(JsonNode.class));
        String connection=data(postJson("/api/knowledge-mcp/connections",map("name","知识连接","driver","nebulae-v1-http","endpoint","http://knowledge.invalid/mcp/common-knowledge","authType","none","authHeader","","enabled",true)),"admin").path("id").asText();
        for(String collection:Arrays.asList("law","finance","shared"))data(postJson("/api/knowledge-mcp/connections/"+connection+"/assign",map("ownerId","alice","collectionId",collection)),"admin");return connection;
    }
    String bindKnowledge(String kind,String target,String connection,String collection)throws Exception{return data(postJson("/api/knowledge-scopes/"+kind+"/"+target+"/references",map("revision",1,"connectionId",connection,"collectionId",collection)),"alice").path("knowledgeBases").get(0).path("id").asText();}
    ObjectNode contextRequest(String project)throws Exception{
        JsonNode detail=data(postJson("/api/projects/"+project+"/tasks",map("title","知识范围","content","列出法律资源")).header("Idempotency-Key",UUID.randomUUID().toString()),"alice"),run=detail.path("runs").get(0);ObjectNode request=run.deepCopy();request.put("runId",run.path("id").asText());return request;
    }
    @Test void discoversExpertKnowledgeWithoutProjectBindingAndChecksLiveAccess()throws Exception{
        String expert=publishedExpert("法律法规专家"),connection=knowledgeConnection(),ref=bindKnowledge("expert",expert,connection,"law");
        String unrelated=publishedExpert("未引用专家"),otherRef=bindKnowledge("expert",unrelated,connection,"finance");
        String project=project(workbench(expert));ObjectNode request=contextRequest(project);JsonNode manifest=json.valueToTree(bridge.context(request));
        assertEquals(json.valueToTree(Collections.singletonList(ref)),manifest.path("knowledgeRefs"));assertFalse(manifest.toString().contains(otherRef));
        assertEquals("法律法规库",manifest.path("knowledgeReferences").get(0).path("name").asText());assertEquals("expert",manifest.path("knowledgeReferences").get(0).path("scopeKind").asText());
        assertTrue(manifest.path("businessTools").toString().contains("knowledge_search"));assertTrue(manifest.path("businessTools").toString().contains("knowledge_document"));assertFalse(manifest.toString().contains("knowledge.invalid"));
        ((ObjectNode)remoteRuns.get(request.path("runId").asText())).set("manifest",manifest);
        ObjectNode search=request.deepCopy();search.put("capability","knowledge").put("operation","search").put("callId","search-law");search.set("arguments",json.valueToTree(map("referenceId",ref,"query","法律")));
        assertTrue(json.valueToTree(bridge.execute(search)).toString().contains("law-doc"));verify(knowledgeDriver).execute(anyString(),anyMap(),eq("search"),eq("law"),any(JsonNode.class));
        search.put("callId","read-law").put("operation","document");search.set("arguments",json.valueToTree(map("referenceId",ref,"documentId","law-doc")));bridge.execute(search);verify(knowledgeDriver).execute(anyString(),anyMap(),eq("document"),eq("law"),any(JsonNode.class));
        search.put("callId","outside").put("operation","search");search.set("arguments",json.valueToTree(map("referenceId",otherRef,"query","财务")));assertEquals(403,assertThrows(ApiException.class,()->bridge.execute(search)).status);
        jdbc.update("UPDATE nw_knowledge_connection SET enabled=FALSE WHERE id=?",connection);assertTrue(json.valueToTree(bridge.context(request)).path("knowledgeRefs").isEmpty());
        search.put("callId","disabled");search.set("arguments",json.valueToTree(map("referenceId",ref,"query","法律")));assertEquals(409,assertThrows(ApiException.class,()->bridge.execute(search)).status);
        jdbc.update("UPDATE nw_knowledge_connection SET enabled=TRUE WHERE id=?",connection);jdbc.update("DELETE FROM nw_knowledge_reference WHERE id=?",ref);search.put("callId","unbound");assertEquals(404,assertThrows(ApiException.class,()->bridge.execute(search)).status);
    }
    @Test void delegatedKnowledgeContainsProjectAndOwnExpertOnly()throws Exception{
        String law=publishedExpert("法律专家"),finance=publishedExpert("财务专家"),connection=knowledgeConnection(),lawRef=bindKnowledge("expert",law,connection,"law"),financeRef=bindKnowledge("expert",finance,connection,"finance");
        String wb=workbench(law,finance),project=project(wb),commonRef=bindKnowledge("project",project,connection,"shared");
        ObjectNode request=contextRequest(project);JsonNode manifest=json.valueToTree(bridge.context(request));assertEquals(3,manifest.path("knowledgeRefs").size());
        for(JsonNode expert:manifest.path("experts")){
            JsonNode child=expert.path("runtime");assertEquals(2,child.path("knowledgeRefs").size());assertTrue(child.path("knowledgeRefs").toString().contains(commonRef));assertTrue(child.path("knowledgeRefs").toString().contains(expert.path("id").asText().equals(law)?lawRef:financeRef));assertFalse(child.path("knowledgeRefs").toString().contains(expert.path("id").asText().equals(law)?financeRef:lawRef));
            if(expert.path("id").asText().equals(law)){
                ObjectNode childRun=remoteRuns.get(request.path("runId").asText()).deepCopy();childRun.put("id","law-child-run").put("sessionId","law-child-session").put("parentRunId",request.path("runId").asText());childRun.set("manifest",child);remoteRuns.put("law-child-run",childRun);
                ObjectNode search=request.deepCopy();search.put("runId","law-child-run").put("sessionId","law-child-session").put("capability","knowledge").put("operation","search").put("callId","child-search");search.set("arguments",json.valueToTree(map("referenceId",lawRef,"query","法律")));assertTrue(json.valueToTree(bridge.execute(search)).toString().contains("law-doc"));
                search.put("callId","child-outside");search.set("arguments",json.valueToTree(map("referenceId",financeRef,"query","财务")));assertEquals(403,assertThrows(ApiException.class,()->bridge.execute(search)).status);
            }
        }
    }

    @Test void evidenceAndCallResultCommitAtomicallyAndReplayTheSameSource()throws Exception{
        String expert=publishedExpert("证据专家"),connection=knowledgeConnection(),ref=bindKnowledge("expert",expert,connection,"law");
        String project=project(workbench(expert));ObjectNode request=contextRequest(project);JsonNode manifest=json.valueToTree(bridge.context(request));((ObjectNode)remoteRuns.get(request.path("runId").asText())).set("manifest",manifest);
        doReturn(json.valueToTree(map("results",Collections.singletonList(map("text","原始证据","citation",map("documentId","law-doc","collectionId","law","chunkId","chunk","title","法规")))))).when(knowledgeDriver).execute(anyString(),anyMap(),eq("search"),eq("law"),any(JsonNode.class));
        request.put("capability","knowledge").put("operation","search").put("callId","atomic-source");request.set("arguments",json.valueToTree(map("referenceId",ref,"query","法规")));
        java.util.concurrent.atomic.AtomicBoolean fail=new java.util.concurrent.atomic.AtomicBoolean(true);
        doAnswer(call->{Object result=call.callRealMethod();if(fail.getAndSet(false))throw new ApiException(500,"模拟证据提交中断");return result;}).when(evidence).record(anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),any(JsonNode.class));
        assertThrows(ApiException.class,()->bridge.execute(request));assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM nw_knowledge_evidence",Integer.class));
        JsonNode first=json.valueToTree(bridge.execute(request));assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM nw_knowledge_evidence",Integer.class));JsonNode replay=json.valueToTree(bridge.execute(request));assertEquals(first,replay);
        verify(knowledgeDriver,times(2)).execute(anyString(),anyMap(),eq("search"),eq("law"),any(JsonNode.class));
    }

}
