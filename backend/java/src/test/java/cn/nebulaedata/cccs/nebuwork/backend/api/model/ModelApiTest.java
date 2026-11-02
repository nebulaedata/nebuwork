package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={
    "spring.datasource.url=jdbc:h2:mem:models;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
    "spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false",
    "nebu.models.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
})
@ActiveProfiles("expert-local")
@AutoConfigureMockMvc
class ModelApiTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate jdbc;
    @Autowired Flyway flyway;
    @Autowired ModelProviderService service;
    @MockBean AccountSessionStore sessions;
    @MockBean ModelCatalogClient catalog;
    @BeforeEach void setup() {
        jdbc.update("DELETE FROM nw_user_model_settings"); jdbc.update("DELETE FROM nw_model_provider");
        jdbc.update("DELETE FROM nw_config_audit WHERE object_type IN ('model_provider','model_settings')");
        when(sessions.findActor("alice-token")).thenReturn("alice"); when(sessions.findActor("bob-token")).thenReturn("bob");
        when(catalog.fetch(any())).thenReturn(map("models",Arrays.asList("m"),"endpoint","https://api.example/v1/models","latencyMs",4));
    }
    JsonNode data(MockHttpServletRequestBuilder request,String user) throws Exception {
        return json.readTree(mvc.perform(request.header("token",user+"-token").header("userId","forged-id"))
            .andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8)).path("data");
    }
    String payload(String url) throws Exception {
        return json.writeValueAsString(map("type","custom","baseUrl",url,"apiKey","test-private-key","model","m","userId","forged-id"));
    }
    JsonNode create(String user) throws Exception { return data(post("/api/model-providers").contentType(MediaType.APPLICATION_JSON).content(payload("https://api.example")),user); }
    MockHttpServletRequestBuilder patchSettings(String body) { return patch("/api/model-settings").contentType(MediaType.APPLICATION_JSON).content(body); }
    MockHttpServletRequestBuilder postSettings(String body) { return post("/api/model-settings").contentType(MediaType.APPLICATION_JSON).content(body); }
    MockHttpServletRequestBuilder expert(String provider) throws Exception {
        return post("/api/agents").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(
            map("name","关联模型的专家","modelProviderId",provider,"model","forged-model","apiKey","must-not-be-audited","userId","alice")));
    }
    @Test void bothVendorsPersistDiscoverAndRemainSelectableForExecution() throws Exception {
        for(String vendor:Arrays.asList("mrtoken","custom")) {
            ObjectNode body=(ObjectNode)json.readTree(payload("https://api.example")); body.put("type",vendor);
            JsonNode saved=data(post("/api/model-providers").contentType(MediaType.APPLICATION_JSON).content(body.toString()),"alice");
            String id=saved.path("id").asText();
            assertEquals(vendor,saved.path("type").asText());
            assertEquals(vendor,jdbc.queryForObject("SELECT provider_type FROM nw_model_provider WHERE id=?",String.class,id));
            assertEquals(vendor,service.selectForTask("alice",id).get("type"));
            assertTrue(data(post("/api/model-providers/"+id+"/test"),"alice").path("modelFound").asBoolean());
            assertTrue(data(post("/api/model-providers/test").contentType(MediaType.APPLICATION_JSON).content(body.toString()),"alice").path("modelFound").asBoolean());
            body.remove("model");
            assertEquals("m",data(post("/api/model-providers/models").contentType(MediaType.APPLICATION_JSON).content(body.toString()),"alice").path("models").get(0).asText());
        }
    }
    @Test void removedProtocolsCannotBeSubmittedAsVendors() throws Exception {
        for(String vendor:Arrays.asList("openai","anthropic","gemini","other")) {
            ObjectNode body=(ObjectNode)json.readTree(payload("https://api.example")); body.put("type",vendor);
            for(String path:Arrays.asList("/api/model-providers","/api/model-providers/models","/api/model-providers/test"))
                mvc.perform(post(path).header("token","alice-token").contentType(MediaType.APPLICATION_JSON).content(body.toString())).andExpect(status().isUnprocessableEntity());
        }
        assertEquals(0,data(get("/api/model-providers"),"alice").size()); verifyNoInteractions(catalog);
    }
    @Test void expertCreationRequiresOwnedProviderAndDeletionClearsThePersistedReference() throws Exception {
        String provider=create("alice").path("id").asText();
        mvc.perform(expert(provider).header("token","bob-token")).andExpect(status().isNotFound());
        mvc.perform(expert("missing").header("token","alice-token")).andExpect(status().isNotFound());
        mvc.perform(post("/api/agents").header("token","alice-token").contentType(MediaType.APPLICATION_JSON)
            .content("{\"name\":\"旧的名称输入\",\"model\":\"m\"}")).andExpect(status().isUnprocessableEntity());
        JsonNode saved=data(expert(provider),"alice");
        String expertId=saved.path("id").asText();
        assertEquals(provider,saved.path("modelProviderId").asText()); assertEquals("m",saved.path("model").asText());
        assertEquals(provider,jdbc.queryForObject("SELECT model_provider_id FROM nw_expert WHERE id=?",String.class,expertId));
        assertEquals(provider,data(get("/api/agents/"+expertId),"alice").path("agent").path("modelProviderId").asText());
        String audit=jdbc.queryForObject("SELECT change_json FROM nw_config_audit WHERE object_id=?",String.class,expertId);
        assertFalse(audit.contains("must-not-be-audited")); assertFalse(saved.toString().contains("test-private-key"));
        data(postSettings("{\"revision\":0,\"defaultProviderId\":\""+provider+"\"}"),"alice");
        data(delete("/api/model-providers/"+provider),"alice");
        JsonNode deleted=data(get("/api/agents/"+expertId),"alice").path("agent");
        assertTrue(deleted.path("modelProviderId").isNull()); assertEquals("m",deleted.path("model").asText());
        assertEquals(saved.path("revision").asLong()+1,deleted.path("revision").asLong());
        assertTrue(data(get("/api/model-settings"),"alice").path("defaultProviderId").isNull());
        mvc.perform(expert(provider).header("token","alice-token")).andExpect(status().isNotFound());
        verifyNoInteractions(catalog);
    }
    @Test void postSettingsSupportsBrowserSavesWithTheSameOwnershipAndRevisionChecks() throws Exception {
        String update="{\"retainAuditTrail\":false,\"revision\":0}";
        mvc.perform(postSettings(update)).andExpect(status().isUnauthorized());
        String foreign=create("bob").path("id").asText();
        mvc.perform(postSettings("{\"revision\":0,\"defaultProviderId\":\""+foreign+"\"}").header("token","alice-token")).andExpect(status().isNotFound());
        JsonNode saved=data(postSettings(update),"alice");
        assertFalse(saved.path("retainAuditTrail").asBoolean());
        assertEquals(1,saved.path("revision").asInt());
        assertFalse(data(get("/api/model-settings"),"alice").path("retainAuditTrail").asBoolean());
        assertTrue(data(get("/api/model-settings"),"bob").path("retainAuditTrail").asBoolean());
        mvc.perform(postSettings(update).header("token","alice-token")).andExpect(status().isConflict());
        JsonNode legacy=data(patchSettings("{\"revision\":1,\"autoMemoryBackflow\":false}"),"alice");
        assertEquals(2,legacy.path("revision").asInt());
        assertFalse(legacy.path("retainAuditTrail").asBoolean());
        assertFalse(legacy.path("autoMemoryBackflow").asBoolean());
    }
    @Test void emptyDefaultsThenPersistentConfigurationAndOneTimeMigration() throws Exception {
        JsonNode defaults=data(get("/api/model-settings"),"alice");
        assertEquals(0,defaults.path("revision").asInt()); assertTrue(defaults.path("defaultProviderId").isNull());
        for(String field:Arrays.asList("retainAuditTrail","autoArchiveArtifacts","autoMemoryBackflow")) assertTrue(defaults.path(field).asBoolean());
        assertEquals(0,data(get("/api/model-providers"),"alice").size());
        JsonNode model=create("alice"); assertEquals("untested",model.path("status").asText()); verifyNoInteractions(catalog);
        ObjectNode next=((ObjectNode)defaults).deepCopy(); next.remove("updatedAt"); next.put("defaultProviderId",model.path("id").asText()); next.put("autoMemoryBackflow",false);
        assertEquals(1,data(patchSettings(json.writeValueAsString(next)),"alice").path("revision").asInt());
        flyway.migrate();
        JsonNode reloaded=data(get("/api/model-settings"),"alice");
        assertFalse(reloaded.path("autoMemoryBackflow").asBoolean()); assertEquals(model.path("id"),reloaded.path("defaultProviderId"));
        assertEquals(1,data(get("/api/model-providers"),"alice").size());
    }
    @Test void preventsCrossUserListTestDeleteAndDefaultReferences() throws Exception {
        String id=create("alice").path("id").asText();
        assertEquals(0,data(get("/api/model-providers"),"bob").size());
        mvc.perform(post("/api/model-providers/"+id+"/test").header("token","bob-token")).andExpect(status().isNotFound());
        mvc.perform(delete("/api/model-providers/"+id).header("token","bob-token")).andExpect(status().isNotFound());
        mvc.perform(patchSettings("{\"revision\":0,\"defaultProviderId\":\""+id+"\"}").header("token","bob-token")).andExpect(status().isNotFound());
        mvc.perform(patchSettings("{\"revision\":0,\"auditFallbackProviderId\":\""+id+"\"}").header("token","bob-token")).andExpect(status().isNotFound());
        mvc.perform(get("/api/model-providers").header("userId","alice")).andExpect(status().isUnauthorized());
        assertEquals("alice",jdbc.queryForObject("SELECT owner_id FROM nw_model_provider WHERE id=?",String.class,id));
        assertEquals("alice",jdbc.queryForObject("SELECT actor FROM nw_config_audit WHERE object_id=?",String.class,id));
        verifyNoInteractions(catalog);
    }
    @Test void duplicateCanonicalEndpointIsPerUserAndApiKeysNeverLeaveStorage() throws Exception {
        String id=create("alice").path("id").asText();
        mvc.perform(post("/api/model-providers").header("token","alice-token").contentType(MediaType.APPLICATION_JSON).content(payload("https://API.EXAMPLE:443/v1/models/"))).andExpect(status().isConflict());
        create("bob");
        String ciphertext=jdbc.queryForObject("SELECT api_key_ciphertext FROM nw_model_provider WHERE id=?",String.class,id);
        assertTrue(ciphertext.startsWith("v1:")); assertFalse(ciphertext.contains("test-private-key"));
        String response=data(get("/api/model-providers"),"alice").toString();
        assertFalse(response.contains("test-private-key")); assertFalse(response.contains(ciphertext)); assertFalse(response.contains("ciphertext")); assertTrue(response.contains("hasApiKey"));
        for(String audit:jdbc.queryForList("SELECT change_json FROM nw_config_audit WHERE object_type='model_provider'",String.class)) {
            assertFalse(audit.contains("test-private-key")); assertFalse(audit.contains(ciphertext));
        }
    }
    @Test void deleteClearsBothDefaultsAtomicallyAndBumpsSettingsRevision() throws Exception {
        String id=create("alice").path("id").asText();
        data(patchSettings("{\"revision\":0,\"defaultProviderId\":\""+id+"\",\"auditFallbackProviderId\":\""+id+"\"}"),"alice");
        mvc.perform(patchSettings("{\"revision\":0,\"retainAuditTrail\":false}").header("token","alice-token")).andExpect(status().isConflict());
        data(delete("/api/model-providers/"+id),"alice");
        JsonNode settings=data(get("/api/model-settings"),"alice");
        assertEquals(2,settings.path("revision").asInt()); assertTrue(settings.path("defaultProviderId").isNull()); assertTrue(settings.path("auditFallbackProviderId").isNull());
        assertTrue(settings.path("retainAuditTrail").asBoolean()); assertEquals(0,data(get("/api/model-providers"),"alice").size());
    }
    @Test void concurrentInitialSavesHaveOneWinnerAndOneConflict() throws Exception {
        ExecutorService pool=Executors.newFixedThreadPool(2); CountDownLatch start=new CountDownLatch(1);
        try {
            Callable<Integer> save=()->{start.await();return mvc.perform(patchSettings("{\"revision\":0,\"retainAuditTrail\":false}").header("token","alice-token")).andReturn().getResponse().getStatus();};
            Future<Integer> first=pool.submit(save),second=pool.submit(save); start.countDown();
            List<Integer> statuses=Arrays.asList(first.get(5,TimeUnit.SECONDS),second.get(5,TimeUnit.SECONDS)); Collections.sort(statuses);
            assertEquals(Arrays.asList(200,409),statuses); assertEquals(1,data(get("/api/model-settings"),"alice").path("revision").asInt());
        } finally { pool.shutdownNow(); }
    }
    @Test void draftTestsDontPersistAndFailedSavedTestsPersistWithoutLoggingOut() throws Exception {
        assertTrue(data(post("/api/model-providers/test").contentType(MediaType.APPLICATION_JSON).content(payload("https://api.example")),"alice").path("modelFound").asBoolean());
        assertEquals(0,data(get("/api/model-providers"),"alice").size());
        String id=create("alice").path("id").asText();
        when(catalog.fetch(any())).thenReturn(map("models",Arrays.asList("another-model"),"latencyMs",7));
        assertFalse(data(post("/api/model-providers/"+id+"/test"),"alice").path("modelFound").asBoolean());
        when(catalog.fetch(any())).thenThrow(new ApiException(502,"模型服务拒绝凭据或权限（上游 HTTP 401）"));
        mvc.perform(post("/api/model-providers/"+id+"/test").header("token","alice-token")).andExpect(status().isBadGateway());
        JsonNode model=data(get("/api/model-providers"),"alice").get(0);
        assertEquals("error",model.path("status").asText()); assertFalse(model.path("lastTestedAt").isNull());
        assertFalse(model.toString().contains("test-private-key"));
    }
}
