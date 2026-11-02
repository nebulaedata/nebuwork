package cn.nebulaedata.cccs.nebuwork.backend.api.memory;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentTasks;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;
import static org.junit.jupiter.api.Assertions.*;
class MemoryRuntimeTest {
    @Test void historyReadsFrozenManifestThroughAuthorizedTaskBoundary()throws Exception{
        AgentTasks tasks=mock(AgentTasks.class);ObjectMapper json=new ObjectMapper();
        when(tasks.detail("alice","task")).thenReturn(json.readTree("{\"runs\":[{\"id\":\"run\",\"manifestHash\":\"fixed\",\"manifest\":{\"memory\":{\"status\":\"ready\",\"facts\":[{\"id\":\"fact\"}]}}}]}"));
        JsonNode history=json.valueToTree(new MemoryRuntime(tasks,json).history("alice","task"));assertEquals("fixed",history.path("contexts").get(0).path("manifestHash").asText());assertEquals("fact",history.path("contexts").get(0).path("context").path("facts").get(0).path("id").asText());verify(tasks).detail("alice","task");
    }
}
