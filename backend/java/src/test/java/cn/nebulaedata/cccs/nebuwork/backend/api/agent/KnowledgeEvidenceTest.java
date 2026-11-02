package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.expert.ExpertMapper;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

class KnowledgeEvidenceTest {
    final ObjectMapper json=new ObjectMapper();final AgentStore db=mock(AgentStore.class);final AgentTasks tasks=mock(AgentTasks.class);final KnowledgeService knowledge=mock(KnowledgeService.class);final KnowledgeContent content=mock(KnowledgeContent.class);final ExpertMapper experts=mock(ExpertMapper.class);
    final KnowledgeEvidence evidence=new KnowledgeEvidence(db,tasks,knowledge,content,experts,json);
    @Test void replayUsesStableHandlesAndDifferentCallsDoNotCollide()throws Exception{
        JsonNode result=json.readTree("{\"results\":[{\"text\":\"命中\",\"citation\":{\"collectionId\":\"k\",\"documentId\":\"doc\",\"chunkId\":\"chunk\",\"sourceLocators\":[{\"source_hash\":\"file-v1\"}]}}]}");
        JsonNode first=evidence.record("alice","task","run","call","project","p","ref",result),again=evidence.record("alice","task","run","call","project","p","ref",result),different=evidence.record("alice","task","run","call2","project","p","ref",result);
        String id=first.path("results").get(0).path("citation").path("evidenceId").asText();assertTrue(id.startsWith("ke_"));assertEquals(id,again.path("results").get(0).path("citation").path("evidenceId").asText());assertNotEquals(id,different.path("results").get(0).path("citation").path("evidenceId").asText());assertFalse(result.toString().contains("evidenceId"));
        assertEquals("file-v1",first.path("results").get(0).path("citation").path("sourceHash").asText());
    }
    @Test void everyHistoricalReadChecksCurrentTaskReferenceAndConnectionGrant(){
        when(tasks.owned("alice","task")).thenReturn(map("project_id","p"));when(db.one(anyString(),eq("id"),eq("alice"),eq("task"))).thenReturn(map("scope_kind","project","scope_id","p","reference_id","ref","snapshot_json","{\"text\":\"evidence\"}"));
        when(knowledge.authorizedReference("alice","project","p","ref")).thenReturn(map("enabled",true));JsonNode read=json.valueToTree(evidence.read("alice","task","id"));assertEquals("p",read.path("navigation").path("scopeId").asText());assertEquals("ref",read.path("navigation").path("id").asText());
        JsonNode listing=evidence.record("alice","task","run","call","project","p","ref",json.createObjectNode().set("documents",json.createArrayNode()));evidence.authorizeResult("alice","task",listing);
        when(knowledge.authorizedReference("alice","project","p","ref")).thenReturn(map("enabled",false));assertThrows(RuntimeException.class,()->evidence.read("alice","task","id"));assertThrows(RuntimeException.class,()->evidence.read("bob","task","id"));
        assertThrows(RuntimeException.class,()->evidence.authorizeResult("alice","task",listing));
    }
    @Test void evidenceCannotSwitchProjectOrReadAnotherExpertsLibrary(){
        assertThrows(RuntimeException.class,()->evidence.authorize("alice","p","project","other","ref"));
        when(tasks.project("alice","p",false)).thenReturn(map("snapshot_json","{\"config\":{\"agentIds\":[\"own\"]}}"));assertThrows(RuntimeException.class,()->evidence.authorize("alice","p","expert","foreign","ref"));verifyNoInteractions(content);
    }
}
