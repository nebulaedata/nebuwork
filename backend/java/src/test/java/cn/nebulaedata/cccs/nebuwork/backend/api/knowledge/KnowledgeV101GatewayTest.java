package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.SessionFilter;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import java.util.*;
import java.util.function.Function;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class KnowledgeV101GatewayTest {
    final ObjectMapper json=new ObjectMapper();
    final KnowledgeRestClient client=mock(KnowledgeRestClient.class);
    final KnowledgeRestClient.Session remote=mock(KnowledgeRestClient.Session.class);
    final KnowledgeAccess access=mock(KnowledgeAccess.class);
    final KnowledgeService knowledge=mock(KnowledgeService.class);
    final KnowledgeOperations operations=mock(KnowledgeOperations.class);
    final JdbcTemplate jdbc=mock(JdbcTemplate.class);
    final NebulaeV101RestDriver driver=new NebulaeV101RestDriver(client,json);
    final KnowledgeV101Gateway gateway=new KnowledgeV101Gateway(access,knowledge,driver,operations,json,mock(SessionFilter.class));
    final Map<String,Object> connection=map("id","connection","driver",NebulaeV101RestDriver.ID,"enabled",true,"published",true,"endpoint","http://v101.invalid/api/v1");
    @BeforeEach @SuppressWarnings("unchecked") void setup(){when(access.connection("connection")).thenReturn(connection);when(access.visible("alice",connection)).thenReturn(true);when(access.jdbc()).thenReturn(jdbc);when(access.serviceKey(connection)).thenReturn("service");when(knowledge.headers(connection)).thenAnswer(x->new HashMap<String,String>());when(client.execute(anyString(),anyMap(),any(Function.class))).thenAnswer(x->((Function<KnowledgeRestClient.Session,Object>)x.getArgument(2)).apply(remote));when(client.executeRetrieval(anyString(),anyMap(),any(Function.class))).thenAnswer(x->((Function<KnowledgeRestClient.Session,Object>)x.getArgument(2)).apply(remote));when(remote.request(anyString(),anyString(),any())).thenReturn(json.valueToTree(map("success",true,"data",map())));}
    @Test void allowlistExposesKnowledgeButNeverAgentOrArbitraryPaths(){for(String path:Arrays.asList("/knowledge-bases","/knowledge-bases/k/wiki/pages/p/revisions","/knowledge/d/media/transcript","/knowledge/d/extractions/sections","/uploads/u/parts/1","/qa/messages/m/events","/search/image-vector","/settings/parser-engines"))assertTrue(KnowledgeV101Gateway.allowedRoute("GET",path),path);for(String path:Arrays.asList("/agent/runs","/internal/model-gateway","//evil.invalid/","/knowledge/../models","/initialization/reset","/assets/a/metadata"))assertFalse(KnowledgeV101Gateway.allowedRoute("POST",path),path);}
    @Test void retrievalIsReadOnlyButRebuildAndQaSubmissionAreWrites(){assertTrue(KnowledgeV101Gateway.readCall("POST","/search"));assertTrue(KnowledgeV101Gateway.readCall("POST","/knowledge-bases/k/graph/query"));assertFalse(KnowledgeV101Gateway.readCall("POST","/knowledge-bases/k/rebuild"));assertFalse(KnowledgeV101Gateway.readCall("POST","/qa/sessions/s/messages"));}
    @Test void queryStringsDoNotBypassResourceAuthorization(){when(remote.request("GET","/knowledge/d",null)).thenReturn(json.valueToTree(map("data",map("knowledge_base_id","other"))));doThrow(new ApiException(403,"denied")).when(access).require("alice",connection,"other",false);assertThrows(ApiException.class,()->gateway.call("alice","connection","GET","/knowledge/d/content?file_version_id=f",json.createObjectNode(),null));verify(remote,never()).request(eq("GET"),contains("/content"),any());}
    @Test void mixedLibrarySearchFailsBeforeCallingSearch(){doThrow(new ApiException(403,"denied")).when(access).require("alice",connection,"other",false);JsonNode body=json.valueToTree(map("knowledge_base_ids",Arrays.asList("mine","other"),"query_text","needle"));assertThrows(ApiException.class,()->gateway.call("alice","connection","POST","/search",body,null));verifyNoInteractions(remote);}
    @Test void cannotUseAnotherAccountsQaSessionOrQueryImage(){assertThrows(ApiException.class,()->gateway.call("alice","connection","GET","/qa/sessions/theirs/messages",json.createObjectNode(),null));assertThrows(ApiException.class,()->gateway.call("alice","connection","POST","/search",json.valueToTree(map("knowledge_base_ids",Collections.singletonList("mine"),"query_image_id","theirs")),null));verifyNoInteractions(remote);}
    @Test void currentPermissionRevokesAnOwnedQaSession(){when(access.one(anyString(),eq("service"),eq("alice"),eq("qa-session"),eq("mine"))).thenReturn(map("scope_json","[\"revoked\"]","parent_id",null));doThrow(new ApiException(403,"revoked")).when(access).require("alice",connection,"revoked",false);assertThrows(ApiException.class,()->gateway.call("alice","connection","GET","/qa/sessions/mine/messages",json.createObjectNode(),null));verifyNoInteractions(remote);}
    @Test void adminSettingsNeedAdminEvenWhenConnectionIsVisible(){doThrow(new ApiException(403,"admin only")).when(access).requireAdmin("alice");assertThrows(ApiException.class,()->gateway.call("alice","connection","PUT","/settings/parser-engines",json.createObjectNode(),"key-123456"));verifyNoInteractions(remote);}
    @Test void ordinaryModelDirectoryKeepsPurposeAndRemovesInfrastructure(){when(remote.request("GET","/models",null)).thenReturn(json.valueToTree(map("success",true,"data",Collections.singletonList(map("id","m","name","model","purpose","text","base_url","http://private","config",map("secret","private"))))));JsonNode result=gateway.call("alice","connection","GET","/models",json.createObjectNode(),null);assertEquals("text",result.path("data").get(0).path("purpose").asText());assertFalse(result.toString().contains("private"));}
    @Test void unknownWriteReceiptNeverReplaysRemoteRequest(){when(operations.beginWithRequest(anyString(),anyString(),anyString(),anyString(),anyString(),any(),any())).thenReturn(map("id","op","status","sent"));assertThrows(ApiException.class,()->gateway.call("alice","connection","POST","/knowledge-bases",json.valueToTree(map("name","KB")),"key-123456"));verifyNoInteractions(remote);}
    @Test void successfulCreateRegistersOnlyItsVerifiedCreator(){when(operations.beginWithRequest(anyString(),anyString(),anyString(),anyString(),anyString(),any(),any())).thenReturn(map("id","op","claimed",true));JsonNode request=json.valueToTree(map("name","KB"));when(remote.request("POST","/knowledge-bases",request)).thenReturn(json.valueToTree(map("success",true,"data",map("id","created"))));gateway.call("alice","connection","POST","/knowledge-bases",request,"key-123456");verify(access).register(connection,"created","alice");verify(operations).received(eq("op"),any());verify(operations).finish("op");}
    @Test void sourceProjectionPreservesVersionAndRejectsCrossLibrary(){JsonNode source=json.valueToTree(map("knowledge_base_id","mine","knowledge_id","doc","source_ref_id","source","file_version_id","file-old","parse_version_id","parse-old","file_hash","hash-old","quote","原文","locators",Collections.singletonList(map("type","page","page",3))));JsonNode citation=driver.citation(source,"mine");assertEquals("file-old",citation.path("fileVersionId").asText());assertEquals("parse-old",citation.path("parseVersionId").asText());assertEquals("pdf",citation.path("sourceLocators").get(0).path("type").asText());assertThrows(ApiException.class,()->driver.citation(source,"other"));}

    @Test void wikiProjectionResolvesTitleLinksAndImmutableSources(){
        when(remote.request("GET","/knowledge-bases/mine",null)).thenReturn(json.valueToTree(map("data",map("id","mine"))));
        when(remote.request("GET","/knowledge-bases/mine/wiki/graph?view=overview",null)).thenReturn(json.valueToTree(map("data",map("nodes",Arrays.asList(map("id","p","title","页面"),map("id","other","title","链接页面")),"edges",Collections.singletonList(map("source_id","p","target_id","other"))))));
        when(remote.request("GET","/knowledge-bases/mine/wiki/pages/p",null)).thenReturn(json.valueToTree(map("data",map("id","p","title","页面","content","[[链接页面]] [依据](source:source)","source_ids",Collections.singletonList("source")))));
        when(remote.request("GET","/sources/source",null)).thenReturn(json.valueToTree(map("data",map("source_ref_id","source","knowledge_base_id","mine","knowledge_id","d","file_name","原文件","file_version_id","old","parse_version_id","parsed","quote","原文"))));
        JsonNode result=driver.execute("http://v101.invalid/api/v1",Collections.emptyMap(),"document","mine",json.valueToTree(map("documentId","p","contentKind","wiki")));
        assertTrue(result.path("document").path("extractedText").asText().contains("[[other|链接页面]]"));assertEquals("d|原文件",result.path("document").path("sourceRefs").get(0).asText());
        JsonNode source=driver.execute("http://v101.invalid/api/v1",Collections.emptyMap(),"source","mine",json.valueToTree(map("sourceRefId","source")));assertEquals("old",source.path("citation").path("fileVersionId").asText());
    }
    @Test void unparsedDocumentMetadataDoesNotRequireParsedContent(){
        when(remote.request("GET","/knowledge-bases/mine",null)).thenReturn(json.valueToTree(map("data",map("id","mine"))));
        when(remote.request("GET","/knowledge/d",null)).thenReturn(json.valueToTree(map("data",map("id","d","knowledge_base_id","mine","name","原文件.txt","status","waiting_configuration","current_parse_version_id",null))));
        JsonNode result=driver.execute("http://v101.invalid/api/v1",Collections.emptyMap(),"document","mine",json.valueToTree(map("documentId","d")));
        assertEquals("原文件.txt",result.path("document").path("fileName").asText());verify(remote,never()).request(eq("GET"),contains("/content"),any());
    }

    @Test void scopedTaskRoutesRequireCurrentLibraryPermission(){
        for(String path:Arrays.asList("/knowledge-bases/mine/tasks","/knowledge-bases/mine/tasks/stats","/knowledge-bases/mine/tasks/cancel"))assertTrue(KnowledgeV101Gateway.allowedRoute("POST",path));
        assertFalse(KnowledgeV101Gateway.readCall("POST","/knowledge-bases/mine/tasks/cancel"));
        doThrow(new ApiException(403,"denied")).when(access).require("alice",connection,"other",true);
        assertThrows(ApiException.class,()->gateway.call("alice","connection","POST","/knowledge-bases/other/tasks/cancel",json.createObjectNode(),"cancel-other"));
        verifyNoInteractions(remote);verifyNoInteractions(operations);
    }
    @Test void scopedTaskReadsStayOnTheAuthorizedLibrary(){
        when(remote.request("GET","/knowledge-bases/mine/tasks?page_size=20",null)).thenReturn(json.valueToTree(map("success",true,"data",Collections.singletonList(map("id","task","knowledge_base_id","mine")))));
        JsonNode result=gateway.call("alice","connection","GET","/knowledge-bases/mine/tasks?page_size=20",json.createObjectNode(),null);
        assertEquals("task",result.path("data").get(0).path("id").asText());verify(access).require("alice",connection,"mine",false);verifyNoInteractions(operations);
    }
    @Test void v101SearchUsesNativeHybridDefaultAndRetrievalBudget(){
        when(remote.request("GET","/knowledge-bases/mine",null)).thenReturn(json.valueToTree(map("data",map("id","mine"))));
        when(remote.request(eq("POST"),eq("/search"),any())).thenReturn(json.valueToTree(map("data",map("results",Collections.emptyList(),"meta",map("warnings",Collections.singletonList(map("message","vector unavailable")))))));
        JsonNode result=driver.execute("http://v101.invalid/api/v1",Collections.emptyMap(),"search","mine",json.valueToTree(map("query","needle")));
        verify(client).executeRetrieval(anyString(),anyMap(),any(Function.class));
        verify(remote).request(eq("POST"),eq("/search"),argThat(body->body.path("mode").asText().equals("hybrid")&&body.path("allow_partial").asBoolean()&&body.path("knowledge_base_ids").get(0).asText().equals("mine")));
        assertTrue(result.path("partial").asBoolean());assertEquals("vector unavailable",result.path("warnings").get(0).path("message").asText());
    }
    @Test void pauseAndResumeStayWithinCurrentLibraryWritePermission(){
        when(operations.beginWithRequest(anyString(),anyString(),anyString(),anyString(),anyString(),any(),any())).thenReturn(map("id","op","claimed",true));
        doThrow(new ApiException(403,"read only")).when(access).require("alice",connection,"other",true);
        for(String action:Arrays.asList("pause","resume")){
            String path="/knowledge-bases/mine/tasks/"+action;
            assertTrue(KnowledgeV101Gateway.allowedRoute("POST",path));
            assertFalse(KnowledgeV101Gateway.readCall("POST",path));
            gateway.call("alice","connection","POST",path,json.createObjectNode(),"control-"+action);
            assertThrows(ApiException.class,()->gateway.call("alice","connection","POST","/knowledge-bases/other/tasks/"+action,json.createObjectNode(),"denied-"+action));
            verify(remote,never()).request(eq("POST"),contains("other/tasks/"+action),any());
        }
        verify(access,times(2)).require("alice",connection,"mine",true);
        verify(operations,times(2)).received(eq("op"),any());verify(operations,times(2)).finish("op");
    }
    @Test void bulkFailedRetryRequiresWriteAndKeepsItsReceipt(){
        when(operations.beginWithRequest(anyString(),anyString(),anyString(),anyString(),anyString(),any(),any())).thenReturn(map("id","op","claimed",true));
        String path="/knowledge-bases/mine/tasks/retry-failed";
        assertTrue(KnowledgeV101Gateway.allowedRoute("POST",path));
        assertFalse(KnowledgeV101Gateway.readCall("POST",path));
        when(remote.request("POST",path,json.createObjectNode())).thenReturn(json.valueToTree(map("success",true,"data",map("accepted",3,"skipped",2))));
        JsonNode result=gateway.call("alice","connection","POST",path,json.createObjectNode(),"retry-key-123");
        assertEquals(3,result.path("data").path("accepted").asInt());
        verify(access).require("alice",connection,"mine",true);
        verify(operations).received(eq("op"),any());verify(operations).finish("op");
        doThrow(new ApiException(403,"read only")).when(access).require("alice",connection,"other",true);
        assertThrows(ApiException.class,()->gateway.call("alice","connection","POST","/knowledge-bases/other/tasks/retry-failed",json.createObjectNode(),"retry-other"));
        verify(remote,never()).request(eq("POST"),contains("other/tasks/retry-failed"),any());
    }
    @Test void processingSummaryAndFiltersRequireCurrentLibraryReadAccess(){
        assertTrue(KnowledgeV101Gateway.allowedRoute("GET","/knowledge-bases/mine/processing"));
        when(remote.request("GET","/knowledge-bases/mine/processing",null)).thenReturn(json.valueToTree(map("success",true,"data",map("total_documents",10005,"counts",map("processing",4)))));
        JsonNode summary=gateway.call("alice","connection","GET","/knowledge-bases/mine/processing",json.createObjectNode(),null);
        assertEquals(10005,summary.path("data").path("total_documents").asInt());verify(access).require("alice",connection,"mine",false);
        String filtered="/knowledge-bases/mine/knowledge?status=processing&parse_status=parsed&q=needle&page=2";
        when(remote.request("GET",filtered,null)).thenReturn(json.valueToTree(map("success",true,"data",Collections.emptyList(),"meta",map("total",4))));
        assertEquals(4,gateway.call("alice","connection","GET",filtered,json.createObjectNode(),null).path("meta").path("total").asInt());
        doThrow(new ApiException(403,"revoked")).when(access).require("alice",connection,"other",false);
        assertThrows(ApiException.class,()->gateway.call("alice","connection","GET","/knowledge-bases/other/processing?knowledge_base_id=mine",json.createObjectNode(),null));
        verify(remote,never()).request(eq("GET"),contains("other/processing"),any());verifyNoInteractions(operations);
    }
    @Test void taskDirectorySkipsDeletedNullResourcesAndFiltersBeforePaging()throws Exception{
        when(jdbc.queryForList(anyString(),eq("service"))).thenReturn(Collections.singletonList(map("collection_id","mine")));
        when(access.allowed("alice",connection,"mine",false)).thenReturn(true);
        when(remote.request("GET","/tasks?page=1&page_size=100",null)).thenReturn(json.valueToTree(map("data",Arrays.asList(map("id","abandoned","knowledge_base_id",null,"knowledge_id",null),map("id","deletion","knowledge_base_id",null,"knowledge_id",null,"config",map("knowledge_base_id","mine")),map("id","other","knowledge_base_id","other")))));
        org.springframework.mock.web.MockHttpServletRequest request=new org.springframework.mock.web.MockHttpServletRequest("GET","/nwaa/api/knowledge-v101/connection/api/v1/tasks");org.springframework.mock.web.MockHttpServletResponse response=new org.springframework.mock.web.MockHttpServletResponse();
        gateway.serve("alice","connection","api/v1/tasks",request,response);JsonNode result=json.readTree(response.getContentAsByteArray());assertEquals(1,result.path("data").size());assertEquals("deletion",result.path("data").get(0).path("id").asText());verify(remote,never()).request("GET","/knowledge/null",null);
    }
}
