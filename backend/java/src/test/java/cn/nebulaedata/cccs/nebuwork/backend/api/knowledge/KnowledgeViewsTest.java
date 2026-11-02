package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class KnowledgeViewsTest {
    final ObjectMapper json=new ObjectMapper();final KnowledgeRestClient.Session session=mock(KnowledgeRestClient.Session.class);
    final NebulaeV100RestDriver driver=new NebulaeV100RestDriver(null,json);final KnowledgeViews views=new KnowledgeViews(driver,json);
    JsonNode node(String raw)throws Exception{return json.readTree(raw);}
    @Test void graphPreservesIdentitySourcesAndTruncationWithoutLeakingUrls()throws Exception{
        when(session.request(eq("POST"),eq("/knowledge-bases/k/graph/query"),any())).thenReturn(node("{\"data\":{\"nodes\":[{\"id\":\"a\",\"name\":\"设备\"},{\"id\":\"b\",\"name\":\"设备\"}],\"edges\":[{\"source\":\"a\",\"target\":\"b\",\"type\":\"关联\"}],\"sources\":[{\"knowledge_base_id\":\"k\",\"knowledge_id\":\"d\",\"chunk_id\":\"c\",\"content\":\"证据\",\"source_locators\":[{\"type\":\"pdf\",\"page\":7}]}],\"truncated\":true}}"));
        JsonNode result=views.read(session,"graph","k",node("{\"mode\":\"expand\",\"nodeId\":\"a\"}"),node("{}"));
        assertEquals(2,result.path("nodes").size());assertTrue(result.path("truncated").asBoolean());assertEquals(7,result.path("sources").get(0).path("citation").path("sourceLocators").get(0).path("page").asInt());
    }
    @Test void graphCannotReturnAnEvidenceFromAnotherLibrary()throws Exception{
        when(session.request(eq("POST"),anyString(),any())).thenReturn(node("{\"data\":{\"sources\":[{\"knowledge_base_id\":\"other\"}]}}"));
        assertThrows(RuntimeException.class,()->views.read(session,"graph","k",json.createObjectNode(),json.createObjectNode()));
    }
    @Test void galleryReturnsContractAndOpaqueAssetsWithoutSignedUrls()throws Exception{
        when(session.request("GET","/knowledge-bases/k/gallery-config",null)).thenReturn(node("{\"data\":{\"attributes\":[{\"id\":\"custom:kind\",\"usage\":{\"in_filter\":true}}]}}"));
        when(session.request(eq("POST"),eq("/knowledge-bases/k/images"),any())).thenReturn(node("{\"total\":23,\"data\":[{\"id\":\"c#0\",\"chunk_id\":\"c\",\"knowledge_id\":\"d\",\"source_name\":\"来源\",\"caption\":\"描述\",\"url\":\"https://secret.invalid/?token=private\",\"original_url\":\"local://private\"}]}"));
        JsonNode out=views.read(session,"gallery","k",json.createObjectNode(),json.createObjectNode());assertTrue(out.path("hasMore").asBoolean());assertEquals("custom:kind",out.path("config").path("attributes").get(0).path("id").asText());assertEquals("c#0",out.path("items").get(0).path("id").asText());assertFalse(out.toString().contains("private"));assertFalse(out.toString().contains("https://"));
    }
    @Test void chunkLoadsDirectHitAndNeighborsAndChecksDocumentOwnership()throws Exception{
        when(session.request("GET","/chunks/by-id/c",null)).thenReturn(node("{\"data\":{\"id\":\"c\",\"knowledge_base_id\":\"k\",\"knowledge_id\":\"d\",\"content\":\"命中\",\"chunk_index\":67,\"source_locators\":[{\"type\":\"docx\",\"block\":80}],\"next_chunk_id\":\"next\",\"image_info\":\"private\"}}"));
        when(session.request("GET","/chunks/by-id/next",null)).thenReturn(node("{\"data\":{\"id\":\"next\",\"knowledge_base_id\":\"k\",\"knowledge_id\":\"d\",\"content\":\"下文\"}}"));
        when(session.request("GET","/knowledge/d",null)).thenReturn(node("{\"data\":{\"id\":\"d\",\"knowledge_base_id\":\"k\",\"file_hash\":\"hash\",\"title\":\"原文\"}}"));
        JsonNode result=views.read(session,"chunk","k",node("{\"chunkId\":\"c\",\"documentId\":\"d\"}"),json.createObjectNode());assertEquals(67,result.path("chunk").path("chunk_index").asInt());assertEquals(2,result.path("chunks").size());assertEquals("hash",result.path("document").path("sourceHash").asText());assertFalse(result.toString().contains("private"));
        assertThrows(RuntimeException.class,()->views.read(session,"chunk","k",json.valueToTree(java.util.Collections.singletonMap("chunkId","c-other")),json.createObjectNode()));
    }
    @Test void unavailableOrDisabledIsNotClaimedReady()throws Exception{
        JsonNode result=views.read(session,"capabilities","k",json.createObjectNode(),node("{\"indexing_strategy\":{\"wiki_enabled\":false,\"graph_enabled\":true}}"));assertFalse(result.path("capabilities").path("wiki").path("enabled").asBoolean());assertEquals("unknown",result.path("capabilities").path("graph").path("available").asText());
    }
    @Test void readerMetadataProjectsBusinessFieldsWithoutInternalStorageOrCredentials()throws Exception{
        com.fasterxml.jackson.databind.node.ObjectNode out=json.createObjectNode();
        views.readerMetadata(out,node("{\"description\":\"原文摘要\",\"file_size\":4096,\"created_at\":\"2026-10-16T02:00:00Z\",\"page_type\":\"concept\",\"aliases\":[\"别名\"],\"custom_metadata\":{\"业务分类\":\"法规\",\"api_key\":\"private\"},\"metadata\":{\"private\":\"internal\"},\"file_path\":\"s3://private\",\"download_url\":\"https://private\"}"));
        assertEquals("原文摘要",out.path("summary").asText());assertEquals(4096,out.path("fileSize").asInt());assertEquals("concept",out.path("pageType").asText());assertEquals("别名",out.path("aliases").get(0).asText());assertEquals("法规",out.path("customMetadata").path("业务分类").asText());assertFalse(out.toString().contains("private"));assertFalse(out.has("metadata"));
        views.readerMetadata(out,node("{\"summary\":\"Wiki 摘要\",\"description\":\"不覆盖摘要\",\"custom_metadata\":\"{\\\"版本\\\":2}\"}"));assertEquals("Wiki 摘要",out.path("summary").asText());assertEquals(2,out.path("customMetadata").path("版本").asInt());
    }
}
