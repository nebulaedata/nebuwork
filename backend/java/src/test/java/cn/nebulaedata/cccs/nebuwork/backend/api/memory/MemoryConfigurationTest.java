package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.mockito.ArgumentCaptor;
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

/** Isolated migrations and mock HTTP only. Does not use the deployed Hindsight or business database. */
class MemoryConfigurationTest {
    ObjectMapper json=new ObjectMapper(); JdbcTemplate jdbc; MemoryStore db; MemoryConfigurationStore store;
    MemorySettings settings; MemoryConfigurationService service; HindsightClient client; MockEnvironment env; TransactionTemplate tx;
    @BeforeEach void setup() {
        DriverManagerDataSource ds=new DriverManagerDataSource("jdbc:h2:mem:memoryconfig"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","sa","");
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V12__unified_memory.sql"),new ClassPathResource("db/migration/V13__memory_settings.sql")).execute(ds);
        jdbc=new JdbcTemplate(ds);db=new MemoryStore(jdbc);tx=new TransactionTemplate(new DataSourceTransactionManager(ds));
        env=new MockEnvironment().withProperty("nebu.memory.admin-ids"," alice , second-admin ")
            .withProperty("nebu.models.encryption-key",Base64.getEncoder().encodeToString(new byte[32]));
        store=new MemoryConfigurationStore(db,new ModelSecretCipher(env));settings=new MemorySettings(env);settings.useStore(store);
        client=mock(HindsightClient.class);service=new MemoryConfigurationService(store,settings,db,env,json,client);
    }
    @AfterEach void close() {jdbc.execute("DROP ALL OBJECTS");}
    ObjectNode body(long revision) { return json.valueToTree(map("revision",revision,"enabled",true,"baseUrl","http://192.168.77.152:8888","recallTimeoutMs",3000,"requestTimeoutMs",15000,"recallMaxTokens",3000)); }
    JsonNode save(ObjectNode body,String key) {return json.valueToTree(tx.execute(s->service.save("alice",body,key)));}
    JsonNode read(String actor) {return json.valueToTree(service.read(actor));}
    @Test void defaultDeniesEveryoneAndDoesNotExposeConnectionDetails() {
        env.setProperty("nebu.memory.admin-ids","");env.setProperty("nebu.memory.api-key","deployment-secret");
        JsonNode view=read("alice");assertFalse(view.path("canEdit").asBoolean());assertFalse(view.has("baseUrl"));assertFalse(view.toString().contains("deployment-secret"));
        assertEquals(403,assertThrows(ApiException.class,()->save(body(0),"request-denied")).status);
        assertEquals(403,assertThrows(ApiException.class,()->service.test("alice",body(0))).status);
        verifyNoInteractions(client);
    }
    @Test void deniesNonAdminSaveAndTestEvenWhenUiRoleOrPayloadClaimsAdmin() {
        assertTrue(read("alice").path("canEdit").asBoolean());assertFalse(read("bob").path("canEdit").asBoolean());
        assertEquals(403,assertThrows(ApiException.class,()->service.save("bob",body(0).put("admin",true),"request-denied")).status);
        assertEquals(403,assertThrows(ApiException.class,()->service.test("bob",body(0))).status);
        assertEquals(0,((Number)store.read(false).get("revision")).intValue());verifyNoInteractions(client);
    }
    @Test void secretsAreEncryptedAndNeverAppearInViewsAuditOrRequestLedger() {
        ObjectNode first=body(0).put("apiKey","test-access-secret");JsonNode result=save(first,"request-key-save");
        String encrypted=store.read(false).get("api_key_cipher").toString();assertTrue(encrypted.startsWith("v1:"));assertFalse(encrypted.contains("test-access-secret"));
        assertFalse(result.has("apiKey"));assertTrue(result.path("hasApiKey").asBoolean());assertEquals("test-access-secret",settings.apiKey());
        assertFalse(db.rows("SELECT * FROM nw_memory_settings_audit").toString().contains("test-access-secret"));
        assertFalse(db.rows("SELECT * FROM nw_memory_request").toString().contains("test-access-secret"));
        save(body(1),"request-key-keep");assertEquals(encrypted,store.read(false).get("api_key_cipher"));
        save(body(2).put("clearApiKey",true),"request-key-clear");assertEquals("",settings.apiKey());assertNull(store.read(false).get("api_key_cipher"));
    }
    @Test void pageValuesOverrideDeploymentDefaultsImmediatelyAndPersistAcrossNewSettingsInstances() {
        save(body(0).put("enabled",false).put("recallMaxTokens",1234),"request-page-config");
        env.setProperty("nebu.memory.enabled","true");env.setProperty("nebu.memory.recall-max-tokens","6000");
        MemorySettings reloaded=new MemorySettings(env);reloaded.useStore(store);
        assertFalse(settings.enabled());assertFalse(reloaded.enabled());assertEquals(1234,reloaded.tokens());
        save(body(1),"request-enable");assertTrue(settings.enabled());
    }
    @Test void sameRequestReplaysWithoutNewRevisionAndDifferentBodyOrStaleRevisionConflicts() {
        ObjectNode body=body(0);JsonNode saved=save(body,"request-uncertain");assertEquals(saved,save(body,"request-uncertain"));
        assertEquals(1,db.rows("SELECT revision FROM nw_memory_settings_audit").size());
        assertEquals(409,assertThrows(ApiException.class,()->save(body.deepCopy().put("enabled",false),"request-uncertain")).status);
        assertEquals(409,assertThrows(ApiException.class,()->save(body,"request-stale")).status);
        assertEquals(1,db.rows("SELECT request_key FROM nw_memory_request").size());
        env.setProperty("nebu.memory.admin-ids","");assertEquals(403,assertThrows(ApiException.class,()->save(body,"request-uncertain")).status);
    }
    @Test void cannotSendExistingCredentialToDifferentOriginWithoutExplicitReplacementOrClear() {
        save(body(0).put("apiKey","old-secret"),"request-first-secret");
        ObjectNode changed=body(1).put("baseUrl","http://192.168.77.153:8888");
        assertEquals(422,assertThrows(ApiException.class,()->service.test("alice",changed)).status);verifyNoInteractions(client);
        assertEquals(422,assertThrows(ApiException.class,()->save(changed,"request-change-deny")).status);
        save(changed.put("clearApiKey",true),"request-change-clear");assertEquals("",settings.apiKey());assertEquals("http://192.168.77.153:8888",settings.baseUrl());
    }
    @Test void existingScopesFixDestinationAndKeepTimeoutAndKeyRotationEditable() {
        save(body(0),"request-initial");
        jdbc.update("INSERT INTO nw_memory_scope(id,owner_id,kind,object_id,bank_id) VALUES('scope','alice','task','task','bank')");
        assertTrue(read("alice").path("originLocked").asBoolean());
        assertEquals(409,assertThrows(ApiException.class,()->save(body(1).put("baseUrl","http://different:8888"),"request-switch")).status);
        save(body(1).put("apiKey","rotated-key").put("requestTimeoutMs",20000),"request-rotate");
        assertEquals("rotated-key",settings.apiKey());assertEquals(20000,settings.requestMs());
    }
    @Test void healthTestUsesDraftWithoutSavingAndKeepsCredentialOriginTogether() {
        save(body(0).put("apiKey","saved-key"),"request-initial-secret");
        ObjectNode draft=body(1).put("apiKey","draft-key").put("requestTimeoutMs",15000);
        when(client.request(any(MemorySettings.Connection.class),eq("GET"),eq("/health"),isNull(),eq(10000))).thenReturn(json.getNodeFactory().nullNode());
        JsonNode result=json.valueToTree(service.test("alice",draft));assertTrue(result.path("reachable").asBoolean());
        ArgumentCaptor<MemorySettings.Connection> captured=ArgumentCaptor.forClass(MemorySettings.Connection.class);
        verify(client).request(captured.capture(),eq("GET"),eq("/health"),isNull(),eq(10000));
        assertEquals("draft-key",captured.getValue().apiKey());assertEquals("http://192.168.77.152:8888",captured.getValue().baseUrl);
        assertEquals("saved-key",settings.apiKey());assertEquals(1,read("alice").path("revision").asLong());
        save(body(1).put("apiKey","next-key"),"request-next-secret");assertEquals("draft-key",captured.getValue().apiKey());
    }
    @Test void invalidAddressLimitsAndFailedEncryptionCannotPartiallySave() {
        for(String url:Arrays.asList("file:///tmp","http://user:password@host","http://host/mcp/","http://host?query=1","http://host#fragment"))
            assertEquals(422,assertThrows(ApiException.class,()->save(body(0).put("baseUrl",url),"request-invalid-url")).status);
        assertEquals(422,assertThrows(ApiException.class,()->save(body(0).put("recallMaxTokens",6001),"request-invalid-budget")).status);
        env.setProperty("nebu.models.encryption-key","");
        assertEquals(503,assertThrows(ApiException.class,()->save(body(0).put("apiKey","not-persisted"),"request-cipher-failed")).status);
        assertFalse(read("alice").path("configured").asBoolean());assertTrue(db.rows("SELECT * FROM nw_memory_request").isEmpty());
        // An unauthenticated Hindsight does not require a credential-encryption key.
        save(body(0),"request-without-key");assertTrue(settings.enabled());
    }
    @Test void endpointCanonicalizationDoesNotMistakeDefaultPortsForServiceMoves() {
        assertEquals("http://example.com",MemoryEndpoint.normalize("HTTP://EXAMPLE.COM:80/"));
        assertDoesNotThrow(()->MemoryEndpoint.resolve("169.254.169.254"));
    }
}
