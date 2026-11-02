package cn.nebulaedata.cccs.nebuwork.backend.api.agent;
import cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.workflow.WorkflowService;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.TestPropertySource;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@TestPropertySource(properties={"nebu.workbench-services.enabled=true","nebu.workbench-services.polling-enabled=false","nebu.workbench-services.public-base-url=http://localhost:42020/nwaa","nebu.workbench-services.frontend-url=http://localhost:5173","nebu.platform-mcp.url=http://platform.invalid/mcp","nebu.platform-mcp.service-key=platform-service-key-12345678901234567890"})
class WorkbenchServiceIntegrationTest extends AgentIntegrationTest {
    @Autowired ServiceOperations operations; @Autowired ServiceAccess access;
    @MockBean WorkflowService workflow;
    String wb,project;
    @BeforeEach void services(TestInfo info)throws Exception {
        for(String t:Arrays.asList("nw_service_event","nw_service_operation","nw_service_page_instance","nw_service_token","nw_service_oauth_request","nw_service_app","nw_service_asset","nw_service_release","nw_service"))jdbc.update("DELETE FROM "+t);
        if(info.getTestMethod().get().getDeclaringClass()==WorkbenchServiceIntegrationTest.class){wb=workbench();project=project(wb);when(engine.get(anyString(),nullable(String.class),eq("/v1/capabilities"))).thenReturn(json.valueToTree(map("workbenchServiceResults",true)));}
    }
    ObjectNode platform(String key,String operation){return json.valueToTree(map("key",key,"name",key,"inputSchema",map("type","object"),"outputSchema",map("type","object"),"projectIds",Collections.singletonList(project),"channels",map("api",true,"mcp",true,"page",true),"binding",map("type","platform","operation",operation)));}
    ObjectNode definition(JsonNode... capabilities){return json.valueToTree(map("name","业务服务","description","真实调用","capabilities",Arrays.asList(capabilities),"pages",Collections.emptyList()));}
    JsonNode save(long revision,JsonNode definition)throws Exception{return data(postJson("/api/workbenches/"+wb+"/service",map("revision",revision,"definition",definition)),"alice");}
    JsonNode publish(long revision)throws Exception{return data(postJson("/api/workbenches/"+wb+"/service/publish",map("revision",revision)),"alice");}
    JsonNode invoke(String cap,Object input,String key)throws Exception{return json.readTree(mvc.perform(postJson("/api/workbench-services/"+wb+"/capabilities/"+cap+"/invoke",map("projectId",project,"input",input)).header("token","alice-token").header("Idempotency-Key",key)).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8)).path("data");}
    JsonNode application(List<String> capabilities,List<String> pages)throws Exception{return data(postJson("/api/workbenches/"+wb+"/service/apps",map("name","接入系统","scope",map("capabilities",capabilities,"pages",pages,"projects",Collections.singletonList(project),"redirectUris",Collections.singletonList("http://localhost:8760/callback"),"origins",Collections.singletonList("http://localhost:8760")))).header("Idempotency-Key",UUID.randomUUID().toString()),"alice");}
    String token(JsonNode app){return json.valueToTree(access.exchange("client_credentials",app.path("id").asText(),app.path("clientSecret").asText(),null,null,null,null)).path("access_token").asText();}
    @Test void immutableContractsAndStableRetriesSurviveActivationChanges()throws Exception{
        save(0,definition(platform("overview","project.get")));JsonNode first=publish(1),result=invoke("overview",map(),"stable");
        assertEquals("succeeded",result.path("status").asText());assertEquals(project,result.path("result").path("id").asText());
        save(1,definition(platform("overview","project.get")));JsonNode second=publish(2);assertNotEquals(first.path("id"),second.path("id"));
        JsonNode retry=invoke("overview",map(),"stable");assertEquals(result.path("id"),retry.path("id"));assertEquals(first.path("id"),retry.path("releaseId"));
        mvc.perform(postJson("/api/workbench-services/"+wb+"/capabilities/overview/invoke",map("projectId",project,"input",map("changed",true))).header("token","alice-token").header("Idempotency-Key","stable")).andExpect(status().isConflict());
        assertEquals(2,data(get("/api/workbenches/"+wb+"/service/releases"),"alice").size());
    }
    @Test void platformWritesAreExecutedOnceAndConflictsArePreserved()throws Exception{
        save(0,definition(platform("rename","project.update")));publish(1);
        JsonNode result=invoke("rename",map("revision",1,"name","重命名"),"rename-once");assertEquals("succeeded",result.path("status").asText());
        assertEquals(result,invoke("rename",map("revision",1,"name","重命名"),"rename-once"));
        assertEquals(2,data(get("/api/projects/"+project),"alice").path("project").path("revision").asInt());
        assertEquals("failed",invoke("rename",map("revision",1,"name","过期写入"),"stale-write").path("status").asText());
    }
    @Test void previewCannotBeActivatedOrReadByApplications()throws Exception{
        save(0,definition(platform("overview","project.get")));
        JsonNode preview=data(postJson("/api/workbenches/"+wb+"/service/preview",map("revision",1)),"alice");assertTrue(preview.path("preview").asBoolean());
        assertEquals(0,data(get("/api/workbenches/"+wb+"/service/releases"),"alice").size());
        mvc.perform(postJson("/api/workbenches/"+wb+"/service/activate",map("revision",1,"releaseId",preview.path("id"))).header("token","alice-token")).andExpect(status().isForbidden());
        JsonNode app=application(Collections.singletonList("overview"),Collections.emptyList());String token=token(app);
        mvc.perform(get("/api/workbench-services/"+wb+"/manifest").param("releaseId",preview.path("id").asText()).header("Authorization","Bearer "+token)).andExpect(status().isForbidden());
        assertEquals(1,publish(1).path("version").asInt());
    }
    @Test void bearerScopesRotationAndCurrentPermissionsAreEnforced()throws Exception{
        save(0,definition(platform("overview","project.get"),platform("other","project.get")));publish(1);
        JsonNode app=application(Collections.singletonList("overview"),Collections.emptyList());String token=token(app);
        String manifest=mvc.perform(get("/api/workbench-services/"+wb+"/manifest").header("Authorization","Bearer "+token)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertFalse(manifest.contains("\"binding\""));assertFalse(manifest.contains("\"other\""));assertFalse(manifest.contains("secret_hash"));
        mvc.perform(postJson("/api/workbench-services/"+wb+"/capabilities/other/invoke",map("projectId",project,"input",map())).header("Authorization","Bearer "+token).header("Idempotency-Key","denied")).andExpect(status().isForbidden());
        mvc.perform(get("/api/workbenches/"+wb+"/service").header("Authorization","Bearer "+token)).andExpect(status().isUnauthorized());
        data(postJson("/api/workbenches/"+wb+"/service/apps/"+app.path("id").asText()+"/rotate",map("revision",1)),"alice");
        mvc.perform(get("/api/workbench-services/"+wb+"/manifest").header("Authorization","Bearer "+token)).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/workbenches/"+wb+"/service").header("token","bob-token")).andExpect(status().isNotFound());
    }
    @Test void pkceConsentIsAccountBoundAndCodeIsSingleUse()throws Exception{
        JsonNode app=application(Collections.singletonList("overview"),Collections.emptyList());String verifier=String.join("",Collections.nCopies(43,"v")),challenge=Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));
        String request=access.authorize(app.path("id").asText(),"http://localhost:8760/callback","state-value-1234567890",challenge,"S256","code",null);
        assertThrows(RuntimeException.class,()->access.decide("bob",request,true));
        JsonNode decision=json.valueToTree(access.decide("alice",request,true));String redirect=decision.path("redirectUri").asText();String code=URLDecoder.decode(redirect.substring(redirect.indexOf("code=")+5,redirect.indexOf("&state=")),"UTF-8");
        assertThrows(RuntimeException.class,()->access.exchange("authorization_code",app.path("id").asText(),null,code,"http://localhost:8760/callback",String.join("",Collections.nCopies(43,"x")),null));
        assertTrue(json.valueToTree(access.exchange("authorization_code",app.path("id").asText(),null,code,"http://localhost:8760/callback",verifier,null)).has("access_token"));
        assertThrows(RuntimeException.class,()->access.exchange("authorization_code",app.path("id").asText(),null,code,"http://localhost:8760/callback",verifier,null));
    }
    @Test void pageAssetsInstancesAndStateArePersistentAndVersioned()throws Exception{
        String html="<!doctype html><html><body><button>真实页面</button></body></html>";
        JsonNode asset=data(postJson("/api/workbenches/"+wb+"/service/assets",map("html",html)),"alice");ObjectNode d=definition(platform("overview","project.get"));d.withArray("pages").add(json.valueToTree(map("key","board","name","项目看板","assetId",asset.path("id"),"capabilities",Collections.singletonList("overview"),"refreshSeconds",5)));save(0,d);JsonNode release=publish(1);
        String path="/api/workbench-services/"+wb+"/pages/board/instances";
        JsonNode page=data(postJson(path,map("projectId",project)).header("Idempotency-Key","page-instance"),"alice");assertEquals(html,page.path("html").asText());assertEquals(release.path("id"),page.path("releaseId"));
        assertEquals(page.path("id"),data(postJson(path,map("projectId",project)).header("Idempotency-Key","page-instance"),"alice").path("id"));
        String state="/api/workbench-services/"+wb+"/page-instances/"+page.path("id").asText()+"/state";
        JsonNode saved=data(postJson(state,map("revision",0,"state",map("filter","active"))),"alice");assertEquals(1,saved.path("revision").asInt());
        mvc.perform(postJson(state,map("revision",0,"state",map())).header("token","alice-token")).andExpect(status().isConflict());
        mvc.perform(get(state.replace("/state","")).header("token","bob-token")).andExpect(status().isNotFound());
        String shell=mvc.perform(get("/api/workbench-services/"+wb+"/pages/board")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertTrue(shell.contains("sandbox='allow-scripts'"));assertFalse(shell.contains(html));assertFalse(shell.contains("allow-same-origin"));
        mvc.perform(get("/api/workbench-services/"+wb+"/host.js")).andExpect(status().isOk());
    }
    @Test void pageCreationFromTheConfiguredBrowserOriginStillRequiresLoginAndProjectOwnership()throws Exception{
        JsonNode asset=data(postJson("/api/workbenches/"+wb+"/service/assets",map("html","<!doctype html><p>页面</p>")),"alice");
        ObjectNode d=definition();d.withArray("pages").add(json.valueToTree(map("key","board","name","项目页面","assetId",asset.path("id"),"projectIds",Collections.singletonList(project),"capabilities",Collections.emptyList())));
        save(0,d);publish(1);String path="/api/workbench-services/"+wb+"/pages/board/instances";
        JsonNode page=data(postJson(path,map("projectId",project)).header("Origin","http://localhost:42020").header("Idempotency-Key","origin-page"),"alice");
        assertEquals(project,page.path("projectId").asText());
        mvc.perform(postJson(path,map("projectId",project)).header("Origin","http://localhost:42020").header("Idempotency-Key","no-session")).andExpect(status().isUnauthorized());
        mvc.perform(postJson(path,map("projectId",project)).header("Origin","http://localhost:42020").header("token","bob-token").header("Idempotency-Key","foreign-project")).andExpect(status().isNotFound());
        org.springframework.mock.web.MockHttpServletResponse rejected=mvc.perform(postJson(path,map("projectId",project)).header("Origin","http://localhost:5173").header("token","alice-token").header("Idempotency-Key","wrong-origin")).andExpect(status().isForbidden()).andReturn().getResponse();
        assertEquals("UTF-8",rejected.getCharacterEncoding());assertEquals("来源未登记",json.readTree(rejected.getContentAsByteArray()).path("msg").asText());
    }
    @Test void workflowUsesCurrentImplementationAndOnlyCurrentTaskSuccess()throws Exception{
        ObjectNode cap=platform("evaluate","project.get");cap.set("binding",json.valueToTree(map("type","workflow","workflowId","wf-current","resultStep","finish","resultName","result")));
        cap.set("outputSchema",json.valueToTree(map("type","object","properties",map("value",map("type","integer")),"required",Collections.singletonList("value"))));
        when(workflow.get("alice","wf-current")).thenReturn(map("enabled",true,"status","ready","archived",false,"workflow",map("definition",map("steps",map("finish",map())))));
        when(workflow.createTask(eq("alice"),eq("wf-current"),any(),anyString())).thenReturn(map("id","wft-current"));
        when(workflow.task("alice","wft-current")).thenReturn(map("status","ready","task",map("id","remote-task","state","succeeded")));
        when(workflow.artifacts("alice","wf-current")).thenReturn(Arrays.asList(map("id","old","task_id","old-task","step","finish","name","result","scope","task","published",true,"effective",true),map("id","fresh","task_id","remote-task","step","finish","name","result","scope","task","published",true,"effective",true)));
        AtomicReference<JsonNode> current=new AtomicReference<>(json.valueToTree(map("value",1)));
        when(workflow.content("alice","wf-current","fresh")).thenAnswer(call->map("kind","json","data",current.get(),"download_only",false));
        save(0,definition(cap));publish(1);JsonNode first=invoke("evaluate",map(),"workflow-first");operations.process();operations.process();
        assertEquals(1,data(get("/api/workbench-services/"+wb+"/operations/"+first.path("id").asText()),"alice").path("result").path("value").asInt());
        current.set(json.valueToTree(map("value",2)));JsonNode second=invoke("evaluate",map(),"workflow-changed");operations.process();operations.process();
        assertEquals(2,data(get("/api/workbench-services/"+wb+"/operations/"+second.path("id").asText()),"alice").path("result").path("value").asInt());
        current.set(json.valueToTree(map("value","invalid")));JsonNode invalid=invoke("evaluate",map(),"workflow-invalid");operations.process();operations.process();
        assertEquals("failed",data(get("/api/workbench-services/"+wb+"/operations/"+invalid.path("id").asText()),"alice").path("status").asText());
        verify(workflow,never()).source(anyString(),anyString(),anyString(),any());
    }
    @Test void remoteSchemasAndForeignResourcesAreRejected()throws Exception{
        ObjectNode cap=platform("bad","project.get");cap.set("inputSchema",json.valueToTree(map("$ref","http://127.0.0.1/private")));
        mvc.perform(postJson("/api/workbenches/"+wb+"/service",map("revision",0,"definition",definition(cap))).header("token","alice-token")).andExpect(status().isUnprocessableEntity());
        cap=platform("bad","project.get");cap.putArray("projectIds").add("foreign");
        mvc.perform(postJson("/api/workbenches/"+wb+"/service",map("revision",0,"definition",definition(cap))).header("token","alice-token")).andExpect(status().isNotFound());
    }
    @Test void agentServiceKeepsPublishedResourcesAndRequiresSubmittedOutput()throws Exception{
        ObjectNode c=platform("analyze","project.get");c.set("binding",json.valueToTree(map("type","agent","projectId",project,"instructions","发布时的业务指令")));c.set("outputSchema",json.valueToTree(map("type","object","required",Collections.singletonList("answer"),"properties",map("answer",map("type","string")))));save(0,definition(c));publish(1);
        JsonNode operation=invoke("analyze",map(),"agent-service");operations.process();String op=operation.path("id").asText();JsonNode current=data(get("/api/workbench-services/"+wb+"/operations/"+op),"alice");String target=current.path("targetId").asText();assertFalse(target.isEmpty());
        ObjectNode run=(ObjectNode)remoteRuns.values().iterator().next();ObjectNode identity=run.deepCopy();identity.put("runId",run.path("id").asText());JsonNode manifest=json.valueToTree(bridge.context(identity));assertTrue(manifest.path("instructions").toString().contains("发布时的业务指令"));assertEquals(op,manifest.path("service").path("operationId").asText());assertTrue(manifest.path("primaryExpertId").isNull());
        run.set("manifest",manifest);run.put("manifestHash","service-test");identity.put("manifestHash","service-test");identity.put("capability","service");identity.put("operation","result.submit");identity.put("callId","result-1");identity.set("arguments",json.valueToTree(map("result",map("answer","完成"))));bridge.execute(identity);
        when(engine.get(eq("alice"),eq(project),eq("/v1/sessions/"+run.path("sessionId").asText()+"/runs"))).thenAnswer(call->json.valueToTree(map("items",Collections.singletonList(run))));
        run.put("status","completed");operations.process();JsonNode result=data(get("/api/workbench-services/"+wb+"/operations/"+op),"alice");assertEquals("succeeded",result.path("status").asText());assertEquals("完成",result.path("result").path("answer").asText());
    }
    @Test void mcpDiscoveryChallengesAndUnsupportedStreamingDoNotBecomeServerErrors()throws Exception{
        save(0,definition(platform("overview","project.get")));publish(1);
        mvc.perform(get("/api/workbench-services/"+wb+"/mcp")).andExpect(status().isUnauthorized()).andExpect(header().string("WWW-Authenticate",access.challenge(wb)));
        mvc.perform(get("/api/workbench-services/"+wb+"/mcp").header("token","alice-token").accept("text/event-stream")).andExpect(status().isMethodNotAllowed()).andExpect(header().string("Allow","POST"));
        mvc.perform(get("/api/workbench-services/"+wb+"/oauth-protected-resource")).andExpect(status().isOk()).andExpect(jsonPath("resource").value("http://localhost:42020/nwaa/api/workbench-services/"+wb+"/mcp"));
        JsonNode doc=json.readTree(mvc.perform(get("/api/workbench-services/"+wb+"/openapi.json").header("token","alice-token")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());assertEquals("3.1.0",doc.path("openapi").asText());assertEquals("http://localhost:42020/nwaa",doc.path("servers").get(0).path("url").asText());assertTrue(doc.path("paths").path("/api/workbench-services/"+wb+"/capabilities/overview/invoke").path("post").path("responses").path("200").has("content"));
    }
    @Test void lostApplicationCreationResponseRecoversOriginalApplicationWithoutStoringPlaintextSecret()throws Exception{
        ObjectNode body=json.valueToTree(map("name","原应用","scope",map("capabilities",Collections.singletonList("overview"),"pages",Collections.emptyList(),"projects",Collections.singletonList(project),"redirectUris",Collections.emptyList(),"origins",Collections.emptyList())));
        JsonNode first=data(postJson("/api/workbenches/"+wb+"/service/apps",body).header("Idempotency-Key","app-once"),"alice");
        JsonNode recovered=data(postJson("/api/workbenches/"+wb+"/service/apps",body).header("Idempotency-Key","app-once"),"alice");
        assertEquals(first.path("id"),recovered.path("id"));assertTrue(recovered.path("credentialRecoveryRequired").asBoolean());assertFalse(recovered.has("clientSecret"));
        body.put("name","不同应用");mvc.perform(postJson("/api/workbenches/"+wb+"/service/apps",body).header("Idempotency-Key","app-once").header("token","alice-token")).andExpect(status().isConflict());
        assertEquals(1,data(get("/api/workbenches/"+wb+"/service/apps"),"alice").size());
    }
    void agentDefinition()throws Exception{ObjectNode c=platform("analyze","project.get");c.set("binding",json.valueToTree(map("type","agent","projectId",project)));save(0,definition(c));publish(1);}
    ObjectNode serviceIdentity(ObjectNode run){ObjectNode identity=run.deepCopy();identity.put("runId",run.path("id").asText());JsonNode manifest=json.valueToTree(bridge.context(identity));run.set("manifest",manifest);return identity;}
    @Test void revokedApplicationStopsAnExistingAgentBeforeItsNextCredentialOrToolCallback()throws Exception{
        agentDefinition();JsonNode app=application(Collections.singletonList("analyze"),Collections.emptyList());String bearer=token(app);
        mvc.perform(postJson("/api/workbench-services/"+wb+"/capabilities/analyze/invoke",map("projectId",project,"input",map())).header("Authorization","Bearer "+bearer).header("Idempotency-Key","revoke-run")).andExpect(status().isAccepted());operations.process();
        ObjectNode run=(ObjectNode)remoteRuns.values().iterator().next(),identity=serviceIdentity(run);identity.put("kind","model").put("credentialRef","model:"+provider);assertNotNull(bridge.credentials(identity));
        ObjectNode changed=app.deepCopy();changed.remove("clientSecret");changed.put("enabled",false);access.saveApp("alice",wb,changed,"revoke");
        assertThrows(RuntimeException.class,()->bridge.credentials(identity));identity.put("capability","service").put("operation","result.submit").put("callId","after-revoke");identity.set("arguments",json.valueToTree(map("result",map())));assertThrows(RuntimeException.class,()->bridge.execute(identity));
    }
    @Test void aChangedModelEndpointCannotReceiveTheCurrentCredentialThroughAnOldServiceVersion()throws Exception{
        agentDefinition();invoke("analyze",map(),"endpoint-check");operations.process();ObjectNode run=(ObjectNode)remoteRuns.values().iterator().next(),identity=serviceIdentity(run);identity.put("kind","model").put("credentialRef","model:"+provider);
        jdbc.update("UPDATE nw_model_provider SET base_url=? WHERE id=?","https://replacement.example/v1",provider);
        assertThrows(RuntimeException.class,()->bridge.credentials(identity));
    }
    @Test void completionWithoutSubmittedResultFailsButRetainsMeasuredTokenUsage()throws Exception{
        agentDefinition();JsonNode operation=invoke("analyze",map(),"missing-result");operations.process();ObjectNode run=(ObjectNode)remoteRuns.values().iterator().next();serviceIdentity(run);run.put("status","completed");
        when(engine.get(eq("alice"),eq(project),eq("/v1/sessions/"+run.path("sessionId").asText()+"/runs"))).thenReturn(json.valueToTree(map("items",Collections.singletonList(run))));
        when(engine.get(eq("alice"),eq(project),eq("/v1/sessions/"+run.path("sessionId").asText()))).thenReturn(json.valueToTree(map("session",remoteSessions.get(run.path("sessionId").asText()),"usage",map("totalTokens",123,"inputTokens",100,"outputTokens",23,"usageKnown",true,"cost",9))));
        operations.process();JsonNode result=data(get("/api/workbench-services/"+wb+"/operations/"+operation.path("id").asText()),"alice");assertEquals("failed",result.path("status").asText());assertEquals(123,result.path("usage").path("totalTokens").asInt());assertFalse(result.path("usage").has("cost"));assertEquals("api",result.path("source").asText());
    }
}
