package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class KnowledgeV100RestDriverTest {
    final ObjectMapper json=new ObjectMapper();
    final KnowledgeRestClient.Session session=mock(KnowledgeRestClient.Session.class);
    final NebulaeV100RestDriver driver=new NebulaeV100RestDriver(null,json);

    @Test void onlyConcreteVectorStoresCanBeBoundAndTheirEngineTypeIsPreserved()throws Exception{
        when(session.request("GET","/vector-stores",null)).thenReturn(json.readTree("{\"success\":true,\"data\":[{\"id\":\"__env_postgres__\",\"name\":\"PostgreSQL\",\"source\":\"env\",\"engine_type\":\"postgres\"},{\"id\":\"store-id\",\"name\":\"Search\",\"source\":\"user\",\"engine_type\":\"qdrant\",\"connection_config\":{\"api_key\":\"private\"}}]}"));
        JsonNode rows=driver.manage(session,"vectors","",json.createObjectNode());
        assertEquals(1,rows.size());assertEquals("store-id",rows.get(0).path("id").asText());
        assertEquals("qdrant",rows.get(0).path("type").asText());assertEquals(3,rows.get(0).size());
        assertFalse(rows.toString().contains("private"));
    }
    @Test void blankDisplayNamesFallBackToModelNamesWithoutReturningCredentials()throws Exception{
        when(session.request("GET","/models",null)).thenReturn(json.readTree("{\"data\":[{\"id\":\"model-id\",\"display_name\":\"  \",\"name\":\"bge-m3\",\"type\":\"Embedding\",\"credentials\":{\"api_key\":\"private\"}},{\"id\":\"chat-id\",\"display_name\":\"业务模型\",\"name\":\"qwen\",\"type\":\"KnowledgeQA\"}]}"));
        JsonNode rows=driver.manage(session,"models","",json.createObjectNode());
        assertEquals("bge-m3",rows.get(0).path("name").asText());assertEquals("业务模型",rows.get(1).path("name").asText());
        assertEquals(3,rows.get(0).size());assertFalse(rows.toString().contains("private"));
    }
    @ParameterizedTest @ValueSource(strings={"document","faq","wiki"})
    void usesDefaultEnginesForVirtualStoreSelectionsAndKeepsConcreteBindings(String kind)throws Exception{
        ObjectNode request=(ObjectNode)json.readTree("{\"payload\":{\"name\":\"法律法规\",\"vector_store_id\":\"__env_postgres__\",\"embedding_model_id\":\"embedding\",\"storage_backend_id\":\"storage\"}}");
        ((ObjectNode)request.path("payload")).put("type",kind);
        driver.manage(session,"kb.create","",request);
        ArgumentCaptor<JsonNode> body=ArgumentCaptor.forClass(JsonNode.class);
        verify(session).request(eq("POST"),eq("/knowledge-bases"),body.capture());
        assertFalse(body.getValue().has("vector_store_id"));assertEquals(kind,body.getValue().path("type").asText());
        assertEquals("storage",body.getValue().path("storage_backend_id").asText());
        assertEquals("__env_postgres__",request.path("payload").path("vector_store_id").asText());
        clearInvocations(session);
        String concrete="eb1a7e0a-5393-4c63-b2b4-f10288aa1407";((ObjectNode)request.path("payload")).put("vector_store_id",concrete);
        driver.manage(session,"kb.create","",request);
        verify(session).request(eq("POST"),eq("/knowledge-bases"),body.capture());assertEquals(concrete,body.getValue().path("vector_store_id").asText());
    }
}
