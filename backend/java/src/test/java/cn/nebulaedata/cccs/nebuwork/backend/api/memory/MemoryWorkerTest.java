package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.*;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.SimpleTransactionStatus;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class MemoryWorkerTest {
    MemoryStore db=mock(MemoryStore.class); HindsightClient client=mock(HindsightClient.class);
    ObjectMapper json=new ObjectMapper(); MemoryWorker worker; Map<String,Object> job;
    @BeforeEach void setup() {
        PlatformTransactionManager manager=mock(PlatformTransactionManager.class);
        when(manager.getTransaction(any())).thenReturn(new SimpleTransactionStatus());
        worker=new MemoryWorker(db,new MemorySettings(new MockEnvironment()),client,json,manager);
        job=map("id","job-one","entry_id","entry-one","revision",2L,"kind","retain","operation_id","7bb453fc-6bc7-49d7-99e8-b6397e026958","remote_submitted",false,"attempts",0,
                "payload_json",json.valueToTree(map("bankId","bank-one","documentId","memory-entry-one","entryId","entry-one","revision",2,"scopeKind","task","content","Reported task outcome")).toString());
        when(db.claim(eq("job-one"),anyString())).thenReturn(true); when(db.job("job-one")).thenReturn(job);when(db.fenced(eq("job-one"),anyString())).thenReturn(job);
        when(client.request(eq("PUT"),anyString(),any(),anyInt())).thenReturn(json.createObjectNode());
    }
    @AfterEach void close(){worker.close();}
    @Test void lostRetainResponseRetriesSameDocumentAndOperationThenFencesVersionCompletion() {
        when(client.request(eq("POST"),endsWith("/memories"),any(),anyInt())).thenThrow(new HindsightClient.Failure(0)).thenReturn(json.valueToTree(map("async",true,"operation_id",job.get("operation_id"))));
        when(client.request(eq("GET"),anyString(),isNull(),anyInt())).thenReturn(json.valueToTree(map("status","completed")));
        worker.process("job-one");worker.process("job-one");
        org.mockito.ArgumentCaptor<Object> bodies=org.mockito.ArgumentCaptor.forClass(Object.class);
        verify(client,times(2)).request(eq("POST"),endsWith("/memories"),bodies.capture(),anyInt());
        assertEquals(bodies.getAllValues().get(0),bodies.getAllValues().get(1));
        verify(db).update(contains("synced_revision=?"),eq(2L),eq("entry-one"),eq(2L));
    }
    @Test void restartPollsPersistedOperationInsteadOfSubmittingNewContent() {
        job.put("remote_submitted",true);
        when(client.request(eq("GET"),anyString(),isNull(),anyInt())).thenReturn(json.valueToTree(map("status","processing")));
        worker.process("job-one");
        verify(client,never()).request(eq("POST"),endsWith("/memories"),any(),anyInt());
        verify(db,never()).update(contains("synced_revision=?"),any(),any(),any());
    }
    @Test void expiredLeaseCannotCommitRemoteCompletion() {
        job.put("remote_submitted",true);when(db.fenced(eq("job-one"),anyString())).thenReturn(null);
        when(client.request(eq("GET"),anyString(),isNull(),anyInt())).thenReturn(json.valueToTree(map("status","completed")));
        worker.process("job-one");
        verify(db,never()).update(anyString(),any(),any(),any());
    }
    @Test void repeatedDelete404IsSuccessfulAndDoesNotRetainAnything() {
        job.put("kind","delete");
        when(client.request(eq("DELETE"),anyString(),isNull(),anyInt())).thenThrow(new HindsightClient.Failure(404));
        worker.process("job-one");
        verify(db).update(contains("synced_revision=?"),eq(2L),eq("entry-one"),eq(2L));
        verify(client,never()).request(eq("POST"),anyString(),any(),anyInt());
    }
}
