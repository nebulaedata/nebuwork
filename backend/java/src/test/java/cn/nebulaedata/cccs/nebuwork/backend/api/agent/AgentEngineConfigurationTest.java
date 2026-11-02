package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:enginesettings;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false","nebu.models.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.agent.base-url=http://ignored.invalid","nebu.agent.signing-key=ignored-legacy-key-12345678901234567"})
@ActiveProfiles("expert-local") @AutoConfigureMockMvc
class AgentEngineConfigurationTest {
    @Autowired MockMvc mvc;@Autowired JdbcTemplate db;@Autowired ObjectMapper json;@Autowired AgentSettings settings;
    @MockBean AccountSessionStore sessions;@MockBean AgentClient client;
    final String signing="signing-key-1234567890123456789012",callback="callback-key-1234567890123456789012",cluster="cluster-12345678901234567890",storage=String.join("",Collections.nCopies(64,"a"));
    @BeforeEach void setup(){
        db.update("DELETE FROM nw_agent_engine_settings_audit");db.update("DELETE FROM nw_agent_request WHERE scope='engine-settings'");db.update("DELETE FROM nw_agent_engine_admin");db.update("INSERT INTO nw_agent_engine_admin VALUES('admin')");
        db.update("UPDATE nw_agent_engine_settings SET configured=FALSE,api_urls_json='[]',namespace='nebuwork-v2',signing_key_cipher=NULL,callback_key_cipher=NULL,cluster_id=NULL,storage_id=NULL,revision=0 WHERE id=1");
        when(sessions.findActor("admin-token")).thenReturn("admin");when(sessions.findActor("user-token")).thenReturn("user");
        when(client.inspect(any(),anyString())).thenReturn(info(cluster));
    }
    JsonNode info(String id){return json.valueToTree(map("clusterId",id,"storageId",storage,"workers",Collections.emptyList(),"images",Collections.singletonList("nebu-agent-sandbox:1"),"sdkVersion","1.1.0"));}
    ObjectNode draft(long revision){return json.valueToTree(map("revision",revision,"apiUrls",Arrays.asList("http://api-one:42110","http://api-two:42110"),"namespace","nebuwork-v2","sandboxImage","nebu-agent-sandbox:1","requestTimeoutMs",15000,"signingKey",signing,"callbackKey",callback));}
    JsonNode save(ObjectNode body,String key)throws Exception{return json.readTree(mvc.perform(post("/api/agent-engine/settings").header("token","admin-token").header("Idempotency-Key",key).contentType(MediaType.APPLICATION_JSON).content(body.toString())).andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8)).path("data");}
    @Test void readsDatabaseOnlyAndProtectsSettingsByVerifiedAdministrator()throws Exception{
        assertFalse(settings.enabled());assertTrue(settings.current().urls.isEmpty());
        mvc.perform(get("/api/agent-engine/settings")).andExpect(status().isUnauthorized());
        mvc.perform(get("/api/agent-engine/settings").header("token","user-token")).andExpect(status().isOk()).andExpect(jsonPath("$.data.canEdit").value(false)).andExpect(jsonPath("$.data.apiUrls").doesNotExist());
        mvc.perform(post("/api/agent-engine/settings/test").header("token","user-token").header("userId","admin").contentType(MediaType.APPLICATION_JSON).content(draft(0).toString())).andExpect(status().isForbidden());
        verify(client,never()).inspect(any(),anyString());
    }
    @Test void savesEncryptedSecretsAndReplaysOneRevisionWithoutDisclosingCredentials()throws Exception{
        JsonNode result=save(draft(0),"save-operation-1");assertEquals(1,result.path("revision").asInt());assertFalse(result.has("signingKey"));assertFalse(result.has("callbackKey"));assertEquals(2,result.path("apiUrls").size());
        assertEquals(result,save(draft(0),"save-operation-1"));assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM nw_agent_engine_settings_audit",Integer.class));
        Map<String,Object> stored=db.queryForMap("SELECT * FROM nw_agent_engine_settings");assertTrue(stored.get("signing_key_cipher").toString().startsWith("v1:"));assertFalse(stored.toString().contains(signing));assertEquals(signing,settings.current().signingKey());
        String audit=db.queryForObject("SELECT settings_json FROM nw_agent_engine_settings_audit",String.class);assertFalse(audit.contains(signing));assertFalse(audit.contains(callback));
        save(draft(1).put("signingKey","").put("callbackKey",""),"save-operation-2");assertEquals(callback,settings.callbackKey());
        mvc.perform(post("/api/agent-engine/settings").header("token","admin-token").header("Idempotency-Key","save-operation-1").contentType(MediaType.APPLICATION_JSON).content(draft(0).put("requestTimeoutMs",1000).toString())).andExpect(status().isConflict());
    }
    @Test void testsWithoutSavingAndRejectsMixedClusters()throws Exception{
        when(client.inspect(any(),eq("http://api-two:42110"))).thenReturn(info("other-cluster-1234567890123456"));
        mvc.perform(post("/api/agent-engine/settings/test").header("token","admin-token").contentType(MediaType.APPLICATION_JSON).content(draft(0).toString())).andExpect(status().isOk()).andExpect(jsonPath("$.data.ready").value(false));
        assertFalse(settings.enabled());
        mvc.perform(post("/api/agent-engine/settings").header("token","admin-token").header("Idempotency-Key","mixed-clusters").contentType(MediaType.APPLICATION_JSON).content(draft(0).toString())).andExpect(status().isUnprocessableEntity());
        assertEquals(0,db.queryForObject("SELECT revision FROM nw_agent_engine_settings",Integer.class));
    }
    @Test void preservesClusterAndNamespaceAndRejectsStaleEdits()throws Exception{
        save(draft(0),"initial-cluster");
        mvc.perform(post("/api/agent-engine/settings").header("token","admin-token").header("Idempotency-Key","stale-edit").contentType(MediaType.APPLICATION_JSON).content(draft(0).toString())).andExpect(status().isConflict());
        mvc.perform(post("/api/agent-engine/settings/test").header("token","admin-token").contentType(MediaType.APPLICATION_JSON).content(draft(1).put("namespace","other").toString())).andExpect(status().isConflict());
        when(client.inspect(any(),anyString())).thenReturn(info("other-cluster-1234567890123456"));
        mvc.perform(post("/api/agent-engine/settings/test").header("token","admin-token").contentType(MediaType.APPLICATION_JSON).content(draft(1).toString())).andExpect(status().isOk()).andExpect(jsonPath("$.data.ready").value(false));
    }
    @Test void rejectsUnsafeUrlsAndMetadataAddresses()throws Exception{
        for(String url:Arrays.asList("file:///etc/passwd","http://user:secret@localhost","http://host/path","http://host?query=x"))assertThrows(RuntimeException.class,()->AgentEndpoint.normalize(url));
        assertDoesNotThrow(()->AgentEndpoint.resolve("169.254.169.254"));
        assertEquals("http://localhost",AgentEndpoint.normalize("http://LOCALHOST:80/"));
    }
}
