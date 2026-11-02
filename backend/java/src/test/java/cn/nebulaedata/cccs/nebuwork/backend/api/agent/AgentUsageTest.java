package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

class AgentUsageTest {
    final ObjectMapper json=new ObjectMapper();final AgentClient engine=mock(AgentClient.class);final AgentStore db=mock(AgentStore.class);
    final AgentUsage usage=new AgentUsage(engine,db,json);
    @Test void unknownZeroPartialAndOutagesStayDistinct(){
        Map<String,Object> zero=usage.empty();zero.put("callCount",1L);
        Map<String,Object> unknown=usage.empty();unknown.putAll(map("callCount",1L,"totalTokens",null,"inputTokens",null,"outputTokens",null,"cacheReadTokens",null,"cacheWriteTokens",null,"unknownCalls",1L,"usageKnown",false));
        assertNull(usage.add(Collections.singletonList(unknown)).get("totalTokens"));
        assertEquals(0L,usage.add(Arrays.asList(zero,unknown)).get("totalTokens"));
        assertEquals(false,usage.add(Arrays.asList(zero,unknown)).get("usageKnown"));
        assertEquals(true,usage.add(Arrays.asList(zero,usage.unavailable())).get("unavailable"));
        when(engine.get("alice",null,"/v1/usage")).thenThrow(new IllegalStateException("offline"));
        assertTrue(usage.load("alice",null).path("unavailable").asBoolean());
        assertNull(usage.scoped(usage.load("alice",null),"experts","e").get("totalTokens"));
    }
    @Test void batchesProjectsWithVerifiedBusinessTaskIdentity(){
        JsonNode data=json.valueToTree(map("summary",map("totalTokens",200),"tasks",Arrays.asList(map("taskId","t","projectId","p","status","completed","updatedAt","2026-10-16T01:00:00Z","totalTokens",200,"usageKnown",true),map("taskId","foreign","projectId","p","totalTokens",999)),"projects",Collections.singletonList(map("id","p","totalTokens",200,"tokens",200,"callCount",3,"usageKnown",true,"activeRuns",0)),"projectDaily",Collections.emptyList()));
        when(engine.get("alice",null,"/v1/usage")).thenReturn(data);
        when(db.rows(anyString(),eq("alice"),eq("alice"))).thenReturn(Collections.singletonList(map("id","t","project_id","p","project_name","项目","workbench_id","w","session_id","s","title","业务任务","context_json","{}")));
        List<Map<String,Object>> projects=Arrays.asList(map("id","p"),map("id","empty"));usage.projects("alice",projects);
        JsonNode result=json.valueToTree(projects);assertEquals(200,result.get(0).path("stats").path("tokens").asInt());assertEquals(1,result.get(0).path("stats").path("tasks").asInt());assertEquals("业务任务",result.get(0).path("sessions").get(0).path("title").asText());assertEquals(0,result.get(1).path("stats").path("tokens").asInt());
        verify(engine,times(1)).get("alice",null,"/v1/usage");
    }
    @Test void expertPaginationKeepsTotalsAndHidesForeignTaskRows(){
        JsonNode remote=json.valueToTree(map("summary",map("tasks",51,"totalTokens",100,"usageKnown",true),"taskTotal",51,"hasMore",true,"tasks",Arrays.asList(map("taskId","t","role","collaborator","totalTokens",100,"status","completed","participatedAt","2026-10-16T01:00:00Z"),map("taskId","foreign","title","secret")),"daily",Collections.emptyList(),"taskStates",Collections.singletonList(map("status","completed"))));
        when(engine.get("alice",null,"/v1/experts/e/tasks?offset=0&limit=50")).thenReturn(remote);
        when(db.rows(anyString(),eq("alice"),eq("alice"))).thenReturn(Collections.singletonList(map("id","t","title","真实任务","project_id","p","project_name","项目")));
        JsonNode result=json.valueToTree(usage.expert("alice","e",0));assertEquals(51,result.path("taskTotal").asInt());assertTrue(result.path("hasMore").asBoolean());assertEquals(1,result.path("tasks").size());assertEquals(14,result.path("usage").path("daily").size());assertFalse(result.toString().contains("secret"));assertEquals(1,result.path("usage").path("taskStates").size());
    }
}
