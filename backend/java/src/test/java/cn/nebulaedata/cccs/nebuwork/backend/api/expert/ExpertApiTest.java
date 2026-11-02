package cn.nebulaedata.cccs.nebuwork.backend.api.expert;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.workflow.WorkflowWorker;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelTextClient;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import static org.mockito.Mockito.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentClient;
import javax.servlet.http.HttpServletResponse;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.*;
import org.springframework.mock.web.*;
import org.springframework.http.MediaType;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

@SpringBootTest(properties={
    "spring.datasource.url=jdbc:h2:mem:experts;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
    "nebu.auth.allowed-origins=http://localhost:5173","nebu.storage-dir=target/test-materials",
    "nebu.workflow.enabled=true",
    "spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false"
})
@ActiveProfiles("expert-local")
@AutoConfigureMockMvc
class ExpertApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired ExpertMapper db;
    @Autowired ExpertSeed seed;
    @MockBean AccountSessionStore sessions;
    @MockBean WorkflowWorker workflowWorker;
    @MockBean ModelTextClient modelText;
    @MockBean AgentClient engine;
    final Map<String,byte[]> blobs=new HashMap<>();
    @Autowired JdbcTemplate jdbc;
    String expert,provider;
    @BeforeEach void setup() throws Exception {
        when(sessions.findActor("test-token")).thenReturn("real-user-id");
        when(engine.post(anyString(),anyString(),anyString(),any(),anyString())).thenAnswer(call->{JsonNode body=json.valueToTree(call.getArgument(3));String id=UUID.randomUUID().toString();byte[] bytes=Base64.getDecoder().decode(body.path("contentBase64").asText());blobs.put(id,bytes);return json.valueToTree(map("id",id,"version",1,"size",bytes.length,"sha256","test-hash"));});
        doAnswer(call->{String artifact=call.getArgument(2);HttpServletResponse response=call.getArgument(6);response.setStatus(200);response.getOutputStream().write(blobs.get(artifact));return null;}).when(engine).content(anyString(),anyString(),anyString(),anyInt(),nullable(String.class),nullable(String.class),any(HttpServletResponse.class));
        provider=UUID.randomUUID().toString();
        jdbc.update("INSERT INTO nw_model_provider(id,owner_id,provider_type,base_url,model_name,config_fingerprint,api_key_ciphertext) VALUES(?,?,?,?,?,?,?)",
            provider,"real-user-id","openai","https://example.test","test-model",provider,"unused-test-ciphertext");
        expert=data(post("/api/agents").header("token","test-token").contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(map("name","测试专家","role","验收","modelProviderId",provider,"tagline","test")))).path("id").asText();
    }
    JsonNode data(org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder request) throws Exception {
        return json.readTree(mvc.perform(request).andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.msg").value("成功")).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8)).path("data");
    }
    String base() { return "/api/agents/"+expert; }
    String hireMarketFixture() throws Exception {
        String market="market-test-"+UUID.randomUUID();
        db.insertMarketExpert(map("id",market,"name","可移除专家","role","测试","tagline","配置","color","#6C63F0","model","test-model"));
        expert=data(post("/api/plaza/agents/"+market+"/hire").header("token","test-token")).path("id").asText();
        return market;
    }
    String removeUrl(JsonNode profile) {
        return base()+"?revision="+profile.path("revision").asLong()+"&membershipRevision="+profile.path("membershipRevision").asLong();
    }
    JsonNode rowById(JsonNode rows,String id) {
        for(JsonNode row:rows)if(id.equals(row.path("id").asText()))return row;
        return json.getNodeFactory().nullNode();
    }
    @Test void removalIsAccountScopedIdempotentAndRestoresTheSameConfiguration() throws Exception {
        String market=hireMarketFixture();
        when(sessions.findActor("other-token")).thenReturn("other-user");
        JsonNode sop=createSop("process");String sopId=sop.path("id").asText();
        byte[] bytes="保留的素材".getBytes(StandardCharsets.UTF_8);
        JsonNode uploaded=data(multipart(base()+"/sop-sets/"+sopId+"/materials")
            .file(new MockMultipartFile("file","保留.txt","text/plain",bytes)).param("revision","1").header("token","test-token"));
        String material=uploaded.path("materialRefs").get(0).path("id").asText();
        String download=base()+"/sop-sets/"+sopId+"/materials/"+material+"/content";
        data(post(base()+"/rules").header("token","test-token").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"保留规则\",\"scene\":\"测试\",\"content\":\"核验\"}"));
        JsonNode before=data(get(base()).header("token","test-token"));
        String remove=removeUrl(before.path("agent"));
        JsonNode removed=data(delete(remove).header("token","test-token").header("userId","other-user"));
        assertTrue(removed.path("removed").asBoolean());assertEquals(1,removed.path("membershipRevision").asLong());
        assertEquals(removed,data(delete(remove).header("token","test-token")));
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM nw_config_audit WHERE object_id=? AND action_name='remove'",Integer.class,expert));
        assertTrue(rowById(data(get("/api/agents").header("token","test-token")),expert).isNull());
        assertFalse(rowById(data(get("/api/agents").header("token","other-token")),expert).isNull());
        assertTrue(rowById(data(get("/api/plaza/agents").header("token","test-token")),market).path("hiredAgentId").isNull());
        assertEquals(expert,rowById(data(get("/api/plaza/agents").header("token","other-token")),market).path("hiredAgentId").asText());
        for(String path:Arrays.asList(base(),base()+"/sop-sets",base()+"/rule-sets",base()+"/rules",download))
            mvc.perform(get(path).header("token","test-token")).andExpect(status().isNotFound());
        mvc.perform(post(base()+"/sop-sets").header("token","test-token").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"不可写\",\"kind\":\"process\"}")).andExpect(status().isNotFound());
        mvc.perform(get(download).header("token","other-token")).andExpect(status().isOk()).andExpect(content().bytes(bytes));
        JsonNode restored=data(post("/api/plaza/agents/"+market+"/hire").header("token","test-token"));
        assertEquals(expert,restored.path("id").asText());assertEquals(2,restored.path("membershipRevision").asLong());
        assertEquals(restored,data(post("/api/plaza/agents/"+market+"/hire").header("token","test-token")));
        mvc.perform(delete(remove).header("token","test-token")).andExpect(status().isConflict());
        JsonNode after=data(get(base()).header("token","test-token"));
        for(String key:Arrays.asList("sopSets","ruleSets","rules","extensions","templates"))assertEquals(before.path(key),after.path(key));
        mvc.perform(get(download).header("token","test-token")).andExpect(status().isOk()).andExpect(content().bytes(bytes));
        assertEquals(3,data(delete(removeUrl(restored)).header("token","test-token")).path("membershipRevision").asLong());
    }
    @Test void customExpertDeletionIsAccountScopedIdempotentAndRetainsConfiguration() throws Exception {
        when(sessions.findActor("other-token")).thenReturn("other-user");
        createSop("process");
        JsonNode before=data(get(base()).header("token","test-token"));
        String remove=removeUrl(before.path("agent"));
        JsonNode result=data(delete(remove).header("token","test-token").header("userId","other-user"));
        assertTrue(result.path("removed").asBoolean());assertTrue(result.path("sourceMarketId").isNull());
        assertEquals(1,result.path("membershipRevision").asLong());
        assertEquals(result,data(delete(remove).header("token","test-token")));
        assertTrue(rowById(data(get("/api/agents").header("token","test-token")),expert).isNull());
        for(String path:Arrays.asList(base(),base()+"/sop-sets",base()+"/rule-sets",base()+"/rules"))
            mvc.perform(get(path).header("token","test-token")).andExpect(status().isNotFound());
        mvc.perform(post(base()+"/sop-sets").header("token","test-token").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"不可写\",\"kind\":\"process\"}")).andExpect(status().isNotFound());
        assertEquals(before,data(get(base()).header("token","other-token")));
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM nw_config_audit WHERE object_id=? AND action_name='delete' AND actor='real-user-id'",Integer.class,expert));
        assertNotNull(db.expert(expert));assertEquals(1,db.sops(expert).size());
    }
    @Test void presetDeletionPersistsAcrossSeedRestartForOnlyTheCurrentAccount() throws Exception {
        String actor="preset-user-"+UUID.randomUUID();when(sessions.findActor("preset-token")).thenReturn(actor);
        JsonNode before=data(get("/api/agents/a2").header("token","preset-token"));
        JsonNode profile=before.path("agent");
        data(delete("/api/agents/a2?revision="+profile.path("revision").asLong()+"&membershipRevision="+profile.path("membershipRevision").asLong()).header("token","preset-token"));
        seed.run(new DefaultApplicationArguments(new String[0]));
        assertTrue(rowById(data(get("/api/agents").header("token","preset-token")),"a2").isNull());
        mvc.perform(get("/api/agents/a2").header("token","preset-token")).andExpect(status().isNotFound());
        assertEquals(before,data(get("/api/agents/a2").header("token","test-token")));
    }
    @Test void deletionRequiresAuthenticationAndValidVersions() throws Exception {
        String custom=base();
        mvc.perform(delete(custom).param("revision","1").param("membershipRevision","0")).andExpect(status().isUnauthorized());
        mvc.perform(delete(custom).header("token","test-token")).andExpect(status().isBadRequest());
        mvc.perform(delete(base()).header("token","test-token").param("revision","0").param("membershipRevision","0")).andExpect(status().isUnprocessableEntity());
        mvc.perform(delete(base()).header("token","test-token").param("revision","1").param("membershipRevision","-1")).andExpect(status().isUnprocessableEntity());
        JsonNode before=data(get(base()).header("token","test-token"));
        createSop("workflow");
        mvc.perform(delete(removeUrl(before.path("agent"))).header("token","test-token")).andExpect(status().isConflict());
        assertNotNull(db.visibleExpert("real-user-id",expert));assertNull(db.membership("real-user-id",expert));
    }
    @Test void auditUsesVerifiedAccountRatherThanForwardedUserId() throws Exception {
        JsonNode created=data(post("/api/agents").header("token","test-token").header("userId","forged-user")
            .contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(map("name","审计验证","role","测试","modelProviderId",provider,"tagline","test"))));
        assertEquals("real-user-id",jdbc.queryForObject("SELECT actor FROM nw_config_audit WHERE object_id=?",String.class,created.path("id").asText()));
    }
    @Test void expertBasicSettingsPersistWithRevisionAndOwnedModelValidation() throws Exception {
        JsonNode before=data(get(base()).header("token","test-token"));long revision=before.path("agent").path("revision").asLong();
        String second=UUID.randomUUID().toString();jdbc.update("INSERT INTO nw_model_provider(id,owner_id,provider_type,base_url,model_name,config_fingerprint,api_key_ciphertext) VALUES(?,?,?,?,?,?,?)",
            second,"real-user-id","custom","https://example.test","new-model",second,"unused-test-ciphertext");
        String payload=json.writeValueAsString(map("revision",revision,"name","新专家","role","合同审查","tagline","能力说明","modelProviderId",second));
        JsonNode saved=data(post(base()).header("token","test-token").header("userId","forged-user").contentType(MediaType.APPLICATION_JSON).content(payload));
        assertEquals("新专家",saved.path("name").asText());assertEquals("新",saved.path("initials").asText());assertEquals("合同审查",saved.path("role").asText());
        assertEquals("能力说明",saved.path("tagline").asText());assertEquals(second,saved.path("modelProviderId").asText());assertEquals("new-model",saved.path("model").asText());
        assertEquals(revision+1,saved.path("revision").asLong());assertEquals(saved,data(get(base()).header("token","test-token")).path("agent"));
        mvc.perform(post(base()).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(payload)).andExpect(status().isConflict());
        assertEquals("real-user-id",jdbc.queryForObject("SELECT actor FROM nw_config_audit WHERE object_id=? AND action_name='update'",String.class,expert));
        when(sessions.findActor("other-profile-token")).thenReturn("other-user");
        mvc.perform(post(base()).header("token","other-profile-token").contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(map("revision",saved.path("revision").asLong(),"modelProviderId",second)))).andExpect(status().isNotFound());
        JsonNode descriptionOnly=data(post(base()).header("token","other-profile-token").contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(map("revision",saved.path("revision").asLong(),"tagline","人工修订"))));
        assertEquals(second,descriptionOnly.path("modelProviderId").asText());assertEquals("人工修订",descriptionOnly.path("tagline").asText());
        mvc.perform(post(base()).contentType(MediaType.APPLICATION_JSON).content(payload)).andExpect(status().isUnauthorized());
        mvc.perform(post(base()).header("token","test-token").header("Origin","https://untrusted.example").contentType(MediaType.APPLICATION_JSON).content(payload)).andExpect(status().isForbidden());
    }
    @Test void abilityCompletionIsDraftOnlyAndUsesVerifiedActorAndSubmittedSavedModel() throws Exception {
        JsonNode before=data(get(base()).header("token","test-token"));
        when(modelText.complete(org.mockito.ArgumentMatchers.eq("real-user-id"),org.mockito.ArgumentMatchers.eq(provider),org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.anyString())).thenReturn("合同核对与风险说明");
        JsonNode result=data(post("/api/agents/ability-completion").header("token","test-token").header("userId","forged-user").contentType(MediaType.APPLICATION_JSON)
            .content(json.writeValueAsString(map("name","合同专家","role","合同审查","tagline","原稿","modelProviderId",provider))));
        assertEquals("合同核对与风险说明",result.path("tagline").asText());assertEquals(provider,result.path("modelProviderId").asText());
        assertEquals(before,data(get(base()).header("token","test-token")));
        mvc.perform(post("/api/agents/ability-completion").contentType(MediaType.APPLICATION_JSON).content("{}")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/agents/ability-completion").header("token","test-token").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"专家\",\"modelProviderId\":\"id\",\"baseUrl\":\"https://override.example\"}")).andExpect(status().isUnprocessableEntity());
    }
    JsonNode createSop(String kind) throws Exception {
        return data(post(base()+"/sop-sets").header("token","test-token").header("Idempotency-Key",UUID.randomUUID().toString()).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"验收 SOP\",\"kind\":\""+kind+"\",\"desc\":\"test\"}"));
    }
    @Test void newWorkflowSopCreatesAccountLocalWorkflowAndReplaysTheOriginalSubmission() throws Exception {
        String key=UUID.randomUUID().toString(),body="{\"name\":\"真实工作流 SOP\",\"kind\":\"workflow\",\"desc\":\"新建而非绑定\"}";
        JsonNode first=data(post(base()+"/sop-sets").header("token","test-token").header("Idempotency-Key",key).contentType(MediaType.APPLICATION_JSON).content(body));
        JsonNode replay=data(post(base()+"/sop-sets").header("token","test-token").header("Idempotency-Key",key).contentType(MediaType.APPLICATION_JSON).content(body));
        assertEquals(first,replay);assertEquals("pending",first.path("workflow").path("status").asText());assertFalse(first.path("workflow").path("id").asText().isEmpty());
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM nw_sop_workflow WHERE sop_id=? AND owner_id=?",Integer.class,first.path("id").asText(),"real-user-id"));
        when(sessions.findActor("other-workflow-token")).thenReturn("other-workflow-user");
        JsonNode other=data(get(base()+"/sop-sets").header("token","other-workflow-token"));assertTrue(rowById(other,first.path("id").asText()).path("workflow").isNull());
        mvc.perform(get("/api/workflows/"+first.path("workflow").path("id").asText()).header("token","other-workflow-token")).andExpect(status().isNotFound());
    }
    @Test void requiresUnifiedSessionAndRejectsCrossSiteWrites() throws Exception {
        mvc.perform(get("/api/agents")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/agents").header("token","test-token").header("Origin","https://other.example").contentType(MediaType.APPLICATION_JSON).content("{}"))
            .andExpect(status().isForbidden());
        mvc.perform(get("/api/agents").header("userId","forged-user")).andExpect(status().isUnauthorized());
        when(sessions.findActor("test-token")).thenReturn(null);
        mvc.perform(get("/api/agents").header("token","test-token")).andExpect(status().isUnauthorized());
    }
    @Test void detailContainsRealConfigurationWithoutMockMetrics() throws Exception {
        JsonNode d=data(get(base()).header("token","test-token"));
        assertEquals(0,d.path("knowledgeBases").size()); assertEquals(0,d.path("tasks").size()); assertEquals(0,d.path("growth").size());
        assertTrue(d.path("agent").path("stats").path("successRate").isNull());
        assertEquals(1,d.path("agent").path("level").asInt()); assertEquals(14,d.path("usage").path("daily").size());
        assertEquals(0,d.path("sopSets").size());
        JsonNode seeded=data(get("/api/agents/a1").header("token","test-token"));
        assertEquals("missing",seeded.path("sopSets").get(1).path("materialRefs").get(0).path("status").asText());
    }
    @Test void sopPersistsStableNodesAndRejectsStaleOrForeignRevision() throws Exception {
        JsonNode s=createSop("workflow"); String url=base()+"/sop-sets/"+s.path("id").asText();
        ObjectNode payload=(ObjectNode)s.deepCopy();
        ((ObjectNode)payload.path("wf")).putArray("nodes").addObject().put("t","节点").put("d","说明").put("x",100).put("y",60);
        mvc.perform(post(url).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload))).andExpect(status().isUnauthorized());
        JsonNode saved=data(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload)));
        String nodeId=saved.path("wf").path("nodes").get(0).path("id").asText(); assertFalse(nodeId.isEmpty()); assertEquals(2,saved.path("revision").asInt());
        mvc.perform(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload))).andExpect(status().isConflict());
        mvc.perform(post("/api/agents/a1/sop-sets/"+s.path("id").asText()).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(saved))).andExpect(status().isNotFound());
        JsonNode legacy=data(patch(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(saved)));
        assertEquals(3,legacy.path("revision").asInt());
        assertEquals(nodeId,data(get(base()).header("token","test-token")).path("sopSets").get(0).path("wf").path("nodes").get(0).path("id").asText());
        mvc.perform(delete(url).header("token","test-token").param("revision","1")).andExpect(status().isConflict());
        mvc.perform(delete(url).header("token","test-token").param("revision","3")).andExpect(status().isOk());
    }
    @Test void processSpecsAndStepsRoundTrip() throws Exception {
        JsonNode s=createSop("process"); ObjectNode p=(ObjectNode)s.deepCopy();
        ((ObjectNode)p.path("proc")).putArray("specRefs").add("规范 v1");
        ((ObjectNode)p.path("proc")).putArray("steps").addObject().put("t","核对").put("d","说明").put("sys","ERP").put("rpa",true);
        JsonNode saved=data(post(base()+"/sop-sets/"+s.path("id").asText()).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(p)));
        assertEquals("规范 v1",saved.path("proc").path("specRefs").get(0).asText());
        assertTrue(saved.path("proc").path("steps").get(0).path("rpa").asBoolean());
    }
    @Test void processCanvasAndConfigurationSurviveOldClientUpdates() throws Exception {
        ObjectNode payload=(ObjectNode)createSop("process");String sop=payload.path("id").asText(),url=base()+"/sop-sets/"+sop;
        ObjectNode proc=(ObjectNode)payload.path("proc");
        proc.put("source","ERP 数据").put("rules","核对制度").put("input","业务日期").put("output","核对报告");
        proc.putArray("specRefs").add("制度 v1");
        proc.putArray("steps").addObject().put("t","核对").put("d","操作说明").put("sys","ERP").put("rpa",true).put("x",72).put("y",58);
        JsonNode saved=data(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload)));
        String stepId=saved.path("proc").path("steps").get(0).path("id").asText();assertFalse(stepId.isEmpty());
        ObjectNode legacy=(ObjectNode)saved.deepCopy();((ObjectNode)legacy.path("proc")).remove(Arrays.asList("source","rules","input","output"));
        ((ObjectNode)legacy.path("proc").path("steps").get(0)).put("t","重命名步骤");
        saved=data(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(legacy)));
        JsonNode reloaded=rowById(data(get(base()).header("token","test-token")).path("sopSets"),sop).path("proc");
        assertEquals("ERP 数据",reloaded.path("source").asText());assertEquals("核对制度",reloaded.path("rules").asText());
        assertEquals("业务日期",reloaded.path("input").asText());assertEquals("核对报告",reloaded.path("output").asText());
        assertEquals(stepId,reloaded.path("steps").get(0).path("id").asText());assertEquals("重命名步骤",reloaded.path("steps").get(0).path("t").asText());
        assertEquals(72,reloaded.path("steps").get(0).path("x").asInt());assertEquals(58,reloaded.path("steps").get(0).path("y").asInt());
        assertTrue(reloaded.path("steps").get(0).path("rpa").asBoolean());assertEquals("ERP",reloaded.path("steps").get(0).path("sys").asText());
        ObjectNode invalid=(ObjectNode)saved.deepCopy();((ObjectNode)invalid.path("proc")).put("input",String.join("",Collections.nCopies(16001,"x")));
        mvc.perform(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(invalid))).andExpect(status().isUnprocessableEntity());
        assertEquals(saved.path("revision"),rowById(data(get(base()).header("token","test-token")).path("sopSets"),sop).path("revision"));
    }
    @Test void workflowBranchesAndEmptyEdgesRoundTripWithoutLegacyClientReconnectingNodes() throws Exception {
        ObjectNode payload=(ObjectNode)createSop("workflow"); String sop=payload.path("id").asText(),url=base()+"/sop-sets/"+sop;
        ObjectNode wf=(ObjectNode)payload.path("wf");
        wf.set("nodes",json.readTree("[{\"id\":\"a\",\"t\":\"起点\"},{\"id\":\"b\",\"t\":\"分支一\"},{\"id\":\"c\",\"t\":\"分支二\"}]"));
        wf.set("edges",json.readTree("[{\"id\":\"ab\",\"source\":\"a\",\"target\":\"b\"},{\"id\":\"ac\",\"source\":\"a\",\"target\":\"c\"}]"));
        JsonNode saved=data(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload)));
        assertEquals(wf.path("edges"),rowById(data(get(base()).header("token","test-token")).path("sopSets"),sop).path("wf").path("edges"));
        // A previous frontend version omits edges when editing node text; the graph must survive.
        ObjectNode legacy=(ObjectNode)saved.deepCopy(); ((ObjectNode)legacy.path("wf")).remove("edges");
        saved=data(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(legacy)));
        assertEquals(wf.path("edges"),saved.path("wf").path("edges"));
        // Node removal and its incident edges are one revision-checked write.
        payload=(ObjectNode)saved.deepCopy(); wf=(ObjectNode)payload.path("wf");
        ((com.fasterxml.jackson.databind.node.ArrayNode)wf.path("nodes")).remove(1);
        ((com.fasterxml.jackson.databind.node.ArrayNode)wf.path("edges")).remove(0);
        saved=data(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload)));
        assertEquals("ac",saved.path("wf").path("edges").get(0).path("id").asText());
        payload=(ObjectNode)saved.deepCopy(); ((ObjectNode)payload.path("wf")).putArray("edges");
        saved=data(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload)));
        legacy=(ObjectNode)saved.deepCopy(); ((ObjectNode)legacy.path("wf")).remove("edges");
        saved=data(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(legacy)));
        assertEquals(0,saved.path("wf").path("edges").size());
        JsonNode reloaded=rowById(data(get(base()).header("token","test-token")).path("sopSets"),sop);
        assertTrue(reloaded.path("wf").path("edges").isArray()); assertEquals(0,reloaded.path("wf").path("edges").size());
    }
    @Test void legacyWorkflowReadsStableSequentialEdgesAndDoesNotBridgeDeletedNodes() throws Exception {
        JsonNode created=createSop("workflow"); String sop=created.path("id").asText(),url=base()+"/sop-sets/"+sop;
        String legacy="{\"nodes\":[{\"id\":\"a\",\"t\":\"一\"},{\"id\":\"b\",\"t\":\"二\"},{\"id\":\"c\",\"t\":\"三\"}]}";
        jdbc.update("UPDATE nw_sop SET definition_json=? WHERE id=?",legacy,sop);
        ObjectNode loaded=(ObjectNode)rowById(data(get(base()).header("token","test-token")).path("sopSets"),sop);
        JsonNode expected=json.readTree("[{\"id\":\"legacy-edge-1\",\"source\":\"a\",\"target\":\"b\"},{\"id\":\"legacy-edge-2\",\"source\":\"b\",\"target\":\"c\"}]");
        assertEquals(expected,loaded.path("wf").path("edges"));
        assertEquals(expected,rowById(data(get(base()).header("token","test-token")).path("sopSets"),sop).path("wf").path("edges"));
        // Simulate an older client deleting a node without understanding the edge property.
        ObjectNode wf=(ObjectNode)loaded.path("wf"); wf.remove("edges");
        ((com.fasterxml.jackson.databind.node.ArrayNode)wf.path("nodes")).remove(1);
        JsonNode saved=data(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(loaded)));
        assertEquals(0,saved.path("wf").path("edges").size());
        assertTrue(json.readTree(jdbc.queryForObject("SELECT definition_json FROM nw_sop WHERE id=?",String.class,sop)).path("edges").isArray());
    }
    @Test void rejectsInvalidEdgesWithoutChangingSopRevisionOrStoredGraph() throws Exception {
        ObjectNode payload=(ObjectNode)createSop("workflow"); String sop=payload.path("id").asText(),url=base()+"/sop-sets/"+sop;
        ObjectNode wf=(ObjectNode)payload.path("wf");
        wf.set("nodes",json.readTree("[{\"id\":\"a\",\"t\":\"一\"},{\"id\":\"b\",\"t\":\"二\"}]"));
        for(String invalid:Arrays.asList("null","{}",
            "[{\"id\":\"e\",\"source\":\"a\",\"target\":\"missing\"}]",
            "[{\"id\":\"e\",\"source\":\"a\",\"target\":\"a\"}]",
            "[{\"id\":\"e\",\"source\":\"a\",\"target\":\"b\"},{\"id\":\"e\",\"source\":\"b\",\"target\":\"a\"}]",
            "[{\"id\":\"e\",\"source\":\"a\",\"target\":\"b\"},{\"id\":\"other\",\"source\":\"a\",\"target\":\"b\"}]",
            "[{\"id\":\"bad id\",\"source\":\"a\",\"target\":\"b\"}]",
            "[{\"id\":\"e\",\"source\":1,\"target\":\"b\"}]")) {
            wf.set("edges",json.readTree(invalid));
            mvc.perform(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload)))
                .andExpect(status().isUnprocessableEntity());
        }
        com.fasterxml.jackson.databind.node.ArrayNode excessive=wf.putArray("edges");
        for(int i=0;i<1001;i++) excessive.addObject().put("id","edge-"+i).put("source","a").put("target","b");
        mvc.perform(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsBytes(payload)))
            .andExpect(status().isUnprocessableEntity());
        JsonNode loaded=rowById(data(get(base()).header("token","test-token")).path("sopSets"),sop);
        assertEquals(1,loaded.path("revision").asInt()); assertEquals(0,loaded.path("wf").path("nodes").size()); assertEquals(0,loaded.path("wf").path("edges").size());
    }
    @Test void rulesAndInlineRuleSetsAreAtomic() throws Exception {
        String url=base()+"/rules";
        mvc.perform(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content("{\"scene\":\"不应留下\",\"name\":\"\"}")).andExpect(status().isUnprocessableEntity());
        assertEquals(0,db.ruleSets(expert).size());
        JsonNode rule=data(post(url).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"规则\",\"scene\":\"新规则集\",\"content\":\"不得遗漏\"}"));
        assertEquals(1,db.ruleSets(expert).size()); assertEquals(0,rule.path("hits").asInt());
        String ruleUrl=url+"/"+rule.path("id").asText();
        mvc.perform(post(ruleUrl).contentType(MediaType.APPLICATION_JSON).content("{\"revision\":1,\"enabled\":false}")).andExpect(status().isUnauthorized());
        JsonNode off=data(post(ruleUrl).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content("{\"revision\":1,\"enabled\":false}"));
        assertFalse(off.path("enabled").asBoolean());
        mvc.perform(post(ruleUrl).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content("{\"revision\":1,\"enabled\":true}")).andExpect(status().isConflict());
        String foreign=db.ruleSets("a1").get(0).get("id").toString();
        mvc.perform(post(ruleUrl).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content("{\"revision\":2,\"ruleSetId\":\""+foreign+"\"}")).andExpect(status().isNotFound());
        JsonNode legacy=data(patch(ruleUrl).header("token","test-token").contentType(MediaType.APPLICATION_JSON).content("{\"revision\":2,\"enabled\":true}"));
        assertTrue(legacy.path("enabled").asBoolean()); assertEquals(3,legacy.path("revision").asInt());
        mvc.perform(delete(ruleUrl).header("token","test-token").param("revision","3")).andExpect(status().isOk());
        assertEquals(0,db.rules(expert).size());
    }
    @Test void legacyExtensionsAreRejectedWhileTemplateBindingsAndMarketHireAreIdempotent() throws Exception {
        String extension=data(get("/api/plaza/extensions").header("token","test-token")).get(0).path("id").asText();
        String template=data(get("/api/plaza/templates").header("token","test-token")).get(0).path("id").asText();
        for(int i=0;i<2;i++) {
            mvc.perform(put(base()+"/extensions/"+extension).header("token","test-token")).andExpect(status().isConflict());
            mvc.perform(put(base()+"/tpls/"+template).header("token","test-token")).andExpect(status().isOk());
        }
        assertTrue(db.extensionIds(expert).isEmpty()); assertEquals(1,db.templateIds(expert).size());
        mvc.perform(delete(base()+"/extensions/"+extension).header("token","test-token")).andExpect(status().isConflict());
        mvc.perform(delete(base()+"/tpls/"+template).header("token","test-token")).andExpect(status().isOk());
        assertTrue(db.extensionIds(expert).isEmpty()); assertTrue(db.templateIds(expert).isEmpty());
        String market=db.marketExperts().get(0).get("id").toString();
        JsonNode first=data(post("/api/plaza/agents/"+market+"/hire").header("token","test-token"));
        JsonNode second=data(post("/api/plaza/agents/"+market+"/hire").header("token","test-token"));
        assertEquals(first.path("id"),second.path("id"));
    }
    @Test void realFileBytesAndUnlinkDoNotDeleteAnotherReference() throws Exception {
        JsonNode s=createSop("process"),other=createSop("process");
        String sop=s.path("id").asText(),url=base()+"/sop-sets/"+sop+"/materials";
        byte[] bytes="真实素材\n".getBytes(StandardCharsets.UTF_8);
        MockMultipartFile file=new MockMultipartFile("file","材料.txt","text/plain",bytes);
        JsonNode saved=data(multipart(url).file(file).param("revision","1").header("token","test-token"));
        String material=saved.path("materialRefs").get(0).path("id").asText();
        mvc.perform(get(url+"/"+material+"/content").header("token","test-token")).andExpect(status().isOk()).andExpect(content().bytes(bytes));
        mvc.perform(get("/api/agents/a1/sop-sets/"+sop+"/materials/"+material+"/content").header("token","test-token")).andExpect(status().isNotFound());
        mvc.perform(multipart(url).file(file).param("revision","1").header("token","test-token")).andExpect(status().isConflict());
        Map<String,Object> row=db.material(sop,material);
        String linked=ExpertService.id("mat");
        db.insertMaterial(map("id",linked,"sop",other.path("id").asText(),"artifact",row.get("artifact_id"),"version",row.get("artifact_version"),"owner",row.get("artifact_owner_id"),"size",row.get("byte_size"),"sha256",row.get("sha256"),"name","共享引用.txt"));
        mvc.perform(delete(url+"/"+material).header("token","test-token").param("revision","2")).andExpect(status().isOk());
        mvc.perform(get(base()+"/sop-sets/"+other.path("id").asText()+"/materials/"+linked+"/content").header("token","test-token")).andExpect(status().isOk()).andExpect(content().bytes(bytes));
    }
    @Test void repeatingSeedDoesNotOverwriteOrDuplicateConfiguration() throws Exception {
        int before=db.experts().size();
        String sop=db.sops("a1").get(0).get("id").toString();
        Map<String,Object> row=db.sop("a1",sop);
        db.updateSop(map("id",sop,"expert","a1","name","保留用户修改","description",row.get("description"),"definition",row.get("definition_json"),"revision",row.get("revision")));
        seed.run(new DefaultApplicationArguments(new String[0]));
        assertEquals(before,db.experts().size()); assertEquals("保留用户修改",db.sop("a1",sop).get("name"));
    }
}
