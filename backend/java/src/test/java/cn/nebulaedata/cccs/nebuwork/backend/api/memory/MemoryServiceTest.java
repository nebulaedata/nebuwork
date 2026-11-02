package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.*;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;
import java.util.function.Supplier;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Isolated H2 source/version ledger; never connects to the configured Hindsight. */
class MemoryServiceTest {
    ObjectMapper json=new ObjectMapper(); MemoryStore db; MemoryService service; MemoryScopes scopes;
    HindsightClient client; JdbcTemplate jdbc; TransactionTemplate tx;
    @BeforeEach void setup() {
        DriverManagerDataSource ds=new DriverManagerDataSource("jdbc:h2:mem:memory"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","sa","");
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V12__unified_memory.sql")).execute(ds);
        jdbc=new JdbcTemplate(ds); db=new MemoryStore(jdbc); tx=new TransactionTemplate(new DataSourceTransactionManager(ds));
        scopes=mock(MemoryScopes.class); client=mock(HindsightClient.class);
        when(scopes.authorize(anyString(),anyString(),anyString(),anyBoolean())).thenAnswer(i -> map("kind",i.getArgument(1),"scopeId",i.getArgument(2),"readOnly",false));
        service=new MemoryService(db,scopes,new MemorySettings(new MockEnvironment().withProperty("nebu.memory.enabled","true")),json,client);
    }
    @AfterEach void close() { service.close(); jdbc.execute("DROP ALL OBJECTS"); }
    JsonNode node(Object value) { return json.valueToTree(value); }
    JsonNode action(Supplier<Object> call) { return node(tx.execute(s -> call.get())); }
    JsonNode create(String kind,String object,String key) { return action(()->service.create("alice",kind,object,node(map("title","Preference","content","Answer in Chinese")),key)); }
    void ready(String id) { jdbc.update("UPDATE nw_memory_entry SET sync_state='ready',synced_revision=revision WHERE id=?",id); }
    JsonNode fact(String id,long revision) { return node(map("type","world","document_id","memory-"+id,"text","Answer in Chinese","metadata",map("entry_id",id,"revision",String.valueOf(revision)))); }

    @Test void uncertainCreateReplayReturnsOneEntryAndOneStableOperation() {
        JsonNode first=create("task","task-one","request-create");
        String operation=(String)db.rows("SELECT operation_id FROM nw_memory_job").get(0).get("operation_id");
        assertEquals(first.toString(),create("task","task-one","request-create").toString());
        assertEquals(1,db.rows("SELECT id FROM nw_memory_entry").size());
        assertEquals(operation,db.rows("SELECT operation_id FROM nw_memory_job").get(0).get("operation_id"));
        assertEquals(409,assertThrows(ApiException.class,()->action(()->service.create("alice","task","task-one",node(map("title","Changed","content","Different")),"request-create"))).status);
    }
    @Test void expertDraftCannotBeRecalledUntilApprovedAndSynced() {
        String id=create("expert","shared-expert","request-expert").path("id").asText();
        assertEquals("draft",db.entry(id,false).get("state")); assertTrue(db.due().isEmpty());
        ready(id);
        assertNull(service.validatedFact("alice",map("kind","expert","scopeId","shared-expert"),fact(id,1)));
        action(()->service.change("alice",id,"approve",node(map("revision",1)),"request-approve")); ready(id);
        assertNotNull(service.validatedFact("alice",map("kind","expert","scopeId","shared-expert"),fact(id,2)));
        assertNull(service.validatedFact("bob",map("kind","expert","scopeId","shared-expert"),fact(id,2)));
        assertEquals(404,assertThrows(ApiException.class,()->service.detail("bob",id)).status);
        action(()->service.change("alice",id,"edit",node(map("revision",2,"title","Revised","content","New method")),"request-edit"));
        assertEquals("draft",db.entry(id,false).get("state"));
        assertNull(service.validatedFact("alice",map("kind","expert","scopeId","shared-expert"),fact(id,2)));
    }
    @Test void editsImmediatelySuppressOldFactsAndRejectRevisionConflicts() {
        String id=create("project","project-one","request-project").path("id").asText(); ready(id);
        Map<String,Object> scope=map("kind","project","scopeId","project-one");
        assertNotNull(service.validatedFact("alice",scope,fact(id,1)));
        assertNull(service.validatedFact("alice",map("kind","project","scopeId","other-project"),fact(id,1)));
        action(()->service.change("alice",id,"edit",node(map("revision",1,"title","Updated","content","New constraint")),"request-update"));
        assertNull(service.validatedFact("alice",scope,fact(id,1)));
        assertEquals(409,assertThrows(ApiException.class,()->action(()->service.change("alice",id,"disable",node(map("revision",1)),"request-conflict"))).status);
        ready(id); assertNotNull(service.validatedFact("alice",scope,fact(id,2)));
        JsonNode wrong=fact(id,2).deepCopy(); ((com.fasterxml.jackson.databind.node.ObjectNode)wrong).put("document_id","another-document");
        assertNull(service.validatedFact("alice",scope,wrong));
        // A newer job cannot overtake an earlier unfinished revision.
        assertEquals(1,db.due().size());
    }
    @Test void userPromotionCopiesOnlyEditedContentAndRequiresReview() {
        String id=create("task","task-one","request-source").path("id").asText();
        JsonNode promoted=action(()->service.promote("alice",id,node(map("revision",1,"kind","user","scopeId","self","title","Style","content","Use concise Chinese")),"request-promote"));
        assertEquals("draft",promoted.path("state").asText());
        assertEquals("Use concise Chinese",promoted.path("content").asText());
        assertEquals(id,promoted.path("source").path("entryId").asText());
        assertEquals(1,db.rows("SELECT id FROM nw_memory_job").size());
    }
    @Test void humanProjectPromotionSynchronizesWithoutExtraReview() {
        String id=create("task","task-one","request-project-source").path("id").asText();
        JsonNode promoted=action(()->service.promote("alice",id,node(map("revision",1,"kind","project","scopeId","project-one","title","Constraint","content","Confirmed project deadline")),"request-project-promote"));
        assertEquals("active",promoted.path("state").asText());
        assertFalse(promoted.path("source").path("requiresReview").asBoolean());
        assertEquals(2,db.rows("SELECT id FROM nw_memory_job").size());
    }
    @Test void deleteIsImmediateAndCleanupRetryDoesNotResurrectOrChangeOperation() {
        String id=create("task","task-one","request-delete-source").path("id").asText(); ready(id);
        action(()->service.change("alice",id,"delete",node(map("revision",1)),"request-delete"));
        assertNull(service.validatedFact("alice",map("kind","task","scopeId","task-one"),fact(id,1)));
        jdbc.update("UPDATE nw_memory_job SET state='failed' WHERE entry_id=?",id);
        List<Map<String,Object>> before=db.rows("SELECT operation_id FROM nw_memory_job ORDER BY sequence_no");
        doThrow(new ApiException(404,"Task removed")).when(scopes).authorize("alice","task","task-one",true);
        action(()->service.retry("alice",id,node(map("revision",2)),"request-cleanup"));
        assertEquals(before,db.rows("SELECT operation_id FROM nw_memory_job ORDER BY sequence_no"));
        assertEquals("deleted",db.entry(id,false).get("state"));
        assertEquals(1,service.cleanup("alice").size()); assertTrue(service.cleanup("bob").isEmpty());
    }
    @Test void unavailableServiceIsDifferentFromEmptySearch() {
        String id=create("user","self","request-search").path("id").asText(); ready(id);
        when(client.request(anyString(),anyString(),any(),anyInt())).thenThrow(new HindsightClient.Failure(503));
        assertEquals("unavailable",service.search("alice",Collections.singletonList(map("kind","user","scopeId","self")),"preference").get("status"));
        assertEquals("empty",service.search("alice",Collections.singletonList(map("kind","task","scopeId","empty-task")),"preference").get("status"));
    }
    @Test void deletionAfterEarlierFailureRemainsVisibleAndRetryable() {
        String id=create("task","task-one","request-blocked-source").path("id").asText();
        jdbc.update("UPDATE nw_memory_job SET state='failed' WHERE entry_id=?",id);
        JsonNode deleted=action(()->service.change("alice",id,"delete",node(map("revision",1)),"request-blocked-delete"));
        assertEquals("failed",deleted.path("syncState").asText());
        assertEquals("failed",service.cleanup("alice").get(0).get("syncState"));
        action(()->service.retry("alice",id,node(map("revision",2)),"request-unblock-cleanup"));
        assertEquals(1,db.due().size());
    }
}
