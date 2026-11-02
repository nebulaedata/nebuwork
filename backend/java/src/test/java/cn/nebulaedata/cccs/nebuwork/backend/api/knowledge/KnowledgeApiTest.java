package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.*;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.*;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Real authenticated controllers/transactions/migrations, with remote MCP and core replaced by test doubles. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "spring.datasource.url=jdbc:h2:mem:knowledge;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
    "spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false",
    "nebu.knowledge.admin-ids=admin","nebu.knowledge.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
})
@ActiveProfiles("expert-local")
@AutoConfigureMockMvc
class KnowledgeApiTest {
    @org.springframework.boot.web.server.LocalServerPort int serverPort;
    @Autowired MockMvc mvc;@Autowired ObjectMapper json;@Autowired JdbcTemplate jdbc;
    @MockBean AccountSessionStore sessions;@MockBean AgentClient engine; @MockBean RuntimeResources runtime;
    @MockBean KnowledgeRestClient rest;
    @SpyBean KnowledgeAccess access;
    @Autowired KnowledgeSecretCipher cipher;
    @Autowired KnowledgeEvidence evidenceService;
    @Autowired KnowledgeService knowledgeService;
    @SpyBean NebulaeV1HttpDriver driver;
    String lastEndpoint;boolean unavailable;
    @BeforeEach void setup()throws Exception{
        when(engine.get(anyString(),anyString(),anyString())).thenReturn(json.valueToTree(map("items",Collections.emptyList())));
        when(runtime.view(anyString(),anyString(),anyString())).thenReturn(map());
        for(String table:Arrays.asList("nw_knowledge_operation","nw_knowledge_library_access","nw_knowledge_library","nw_knowledge_publication","nw_knowledge_reference","nw_knowledge_scope","nw_knowledge_connection",
            "nw_core_sync_job","nw_project_core","nw_core_template_release","nw_workbench_core","nw_project","nw_workbench_agent","nw_workbench_case",
            "nw_workbench_draft","nw_ontology_version","nw_workbench","nw_config_audit","nw_expert_membership","nw_expert"))jdbc.update("DELETE FROM "+table);
        jdbc.update("INSERT INTO nw_expert(id,name,role_label,tagline,model_name,initials,color) VALUES('expert','共享专家','法务','','model','专','#123456')");
        when(sessions.findActor("admin-token")).thenReturn("admin");
        when(sessions.findActor("alice-token")).thenReturn("alice");when(sessions.findActor("bob-token")).thenReturn("bob");
        doAnswer(invocation->{
            lastEndpoint=invocation.getArgument(0);
            if(unavailable)throw new ApiException(503,"远端暂不可用");
            String op=invocation.getArgument(2),collection=invocation.getArgument(3);
            if("collections".equals(op))return json.valueToTree(map("collections",Arrays.asList(map("id","A","name","制度","indexingStatus","ready"),map("id","B","name","业务","indexingStatus","pending")),"tools",NebulaeV1HttpDriver.TOOLS));
            if(!"A".equals(collection)&&!"B".equals(collection))throw new ApiException(409,"集合不可见");
            return json.valueToTree(map("results",Collections.emptyList(),"partial",false,"warnings",Collections.emptyList(),"documents",Collections.emptyList()));
        }).when(driver).execute(anyString(),anyMap(),anyString(),nullable(String.class),any(JsonNode.class));
    }
    MockHttpServletRequestBuilder postJson(String path,Object body)throws Exception{return post(path).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body));}
    JsonNode data(MockHttpServletRequestBuilder request,String owner)throws Exception{
        return json.readTree(mvc.perform(request.header("token",owner+"-token").header("userId","forged")).andExpect(status().is2xxSuccessful()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8)).path("data");
    }
    void failure(MockHttpServletRequestBuilder request,String owner,int code)throws Exception{mvc.perform(request.header("token",owner+"-token")).andExpect(status().is(code));}
    Map<String,Object> input(){return map("name","知识连接","driver","nebulae-v1-http","endpoint","http://knowledge.invalid/mcp/common-knowledge","authType","none","authHeader","","enabled",true);}
    JsonNode connection(String owner)throws Exception{JsonNode c=data(postJson("/api/knowledge-mcp/connections",input()),"admin");assign(c.path("id").asText(),owner,"bob".equals(owner)?"B":"A");return c;}
    void assign(String id,String owner,String kb)throws Exception{data(postJson("/api/knowledge-mcp/connections/"+id+"/assign",map("ownerId",owner,"collectionId",kb)),"admin");}
    String scope(String kind,String id){return "/api/knowledge-scopes/"+kind+"/"+id;}
    JsonNode bind(String owner,String kind,String target,String connection,String collection,long revision)throws Exception{
        return data(postJson(scope(kind,target)+"/references",map("revision",revision,"connectionId",connection,"collectionId",collection)),owner);
    }
    JsonNode workbench()throws Exception{
        return data(postJson("/api/workbenches",map("name","工作台")).header("Idempotency-Key",UUID.randomUUID().toString()),"alice");
    }
    JsonNode publish(String wb,long revision)throws Exception{
        JsonNode release=data(postJson("/api/workbenches/"+wb+"/publish",map("revision",revision)),"alice");
        return data(postJson("/api/workbenches/"+wb+"/publish",map("revision",revision)),"alice");
    }
    JsonNode project(String wb)throws Exception{
        return data(postJson("/api/projects",map("name","项目","workbenchId",wb)).header("Idempotency-Key",UUID.randomUUID().toString()),"alice");
    }
    @Test void bindsOneCollectionAndIsolatesBothAccountsOnTheSameSharedExpert()throws Exception{
        String a=connection("alice").path("id").asText(),b=connection("bob").path("id").asText();
        JsonNode alice=bind("alice","expert","expert",a,"A",1);
        String ref=alice.path("knowledgeBases").get(0).path("id").asText();
        assertEquals(1,alice.path("knowledgeBases").size());assertEquals("A",alice.path("knowledgeBases").get(0).path("collectionId").asText());
        assertEquals(0,data(get(scope("expert","expert")),"bob").path("knowledgeBases").size());
        assertEquals(1,data(get("/api/agents/expert"),"alice").path("knowledgeBases").size());
        assertEquals(0,data(get("/api/agents/expert"),"bob").path("knowledgeBases").size());
        failure(postJson(scope("expert","expert")+"/references",map("revision",1,"connectionId",a,"collectionId","A")),"bob",404);
        bind("bob","expert","expert",b,"B",1);
        failure(postJson(scope("expert","expert")+"/references/"+ref+"/read",map("operation","search","query","x")),"bob",404);
        data(postJson(scope("expert","expert")+"/references/"+ref+"/read",map("operation","search","query","x")),"alice");
        verify(driver).execute(anyString(),anyMap(),eq("search"),eq("A"),any(JsonNode.class));
        failure(postJson(scope("expert","expert")+"/references/"+ref+"/read",map("operation","search","query","x","collections",Collections.emptyList())),"alice",422);
        assertEquals(1,jdbc.queryForObject("SELECT revision FROM nw_expert WHERE id='expert'",Integer.class));
    }
    @Test void collectionOverviewIsOptInAndRequiresConnectionOwnership()throws Exception{
        String id=connection("alice").path("id").asText(),path="/api/knowledge-mcp/connections/"+id+"/collections";
        clearInvocations(driver);
        data(get(path),"alice");
        verify(driver).execute(anyString(),anyMap(),eq("collections"),isNull(),argThat(input->!input.path("includeDocumentCounts").asBoolean()));
        clearInvocations(driver);
        data(get(path).param("includeDocumentCounts","true"),"alice");
        verify(driver).execute(anyString(),anyMap(),eq("collections"),isNull(),argThat(input->input.path("includeDocumentCounts").asBoolean()));
        clearInvocations(driver);
        failure(get(path).param("includeDocumentCounts","true"),"bob",404);
        verify(driver,never()).execute(anyString(),anyMap(),anyString(),nullable(String.class),any(JsonNode.class));
    }
    @Test void systemCatalogPagesAuthorizedIdentitiesBeforeReadingMetadata()throws Exception{
        String id=connection("alice").path("id").asText();assign(id,"alice","B");clearInvocations(driver);
        JsonNode page=json.valueToTree(knowledgeService.collectionsPage("alice",id,null,1,0));assertEquals(1,page.path("items").size());assertTrue(page.path("hasMore").asBoolean());assertEquals("unsupported",page.path("items").path(0).path("metadataStatus").asText());
        JsonNode selected=json.valueToTree(knowledgeService.collectionsPage("alice",id,Collections.singletonList("A"),50,0));assertEquals(1,selected.path("items").size());assertEquals("A",selected.path("items").path(0).path("id").asText());
        assertThrows(ApiException.class,()->knowledgeService.collectionsPage("bob",id,null,50,0));verify(driver,never()).execute(anyString(),anyMap(),anyString(),nullable(String.class),any(JsonNode.class));
    }
    @Test void ordinaryUsersCannotConfigureTestAssignOrCreateLocalConnections()throws Exception{
        String id=connection("alice").path("id").asText();
        failure(postJson("/api/knowledge-mcp/connections",input()),"alice",403);
        Map<String,Object> update=input();update.put("revision",1);
        failure(postJson("/api/knowledge-mcp/connections/"+id,update),"alice",403);
        failure(postJson("/api/knowledge-mcp/connections/"+id+"/test",map()),"alice",403);
        failure(postJson("/api/knowledge-mcp/connections/test",input()),"alice",403);
        failure(delete("/api/knowledge-mcp/connections/"+id+"?revision=1"),"alice",403);
        failure(postJson("/api/knowledge-mcp/connections/"+id+"/assign",map("ownerId","alice","collectionId","B")),"alice",403);
        failure(postJson(scope("expert","expert")+"/connections",map("revision",1,"connection",input(),"collectionId","A")),"alice",403);
        JsonNode visible=data(get("/api/knowledge-mcp/connections"),"alice").get(0);
        assertFalse(visible.has("endpoint"));assertFalse(visible.has("tenantId"));assertFalse(visible.has("secret"));
        assertEquals(1,data(get("/api/knowledge-mcp/connections/"+id+"/collections"),"alice").path("collections").size());
    }
    @Test void administratorsAndUsersReceiveTheSameDriverCapabilities()throws Exception{
        restConnection();
        JsonNode admin=data(get("/api/knowledge-mcp/connections"),"admin").get(0);
        JsonNode user=data(get("/api/knowledge-mcp/connections"),"alice").get(0);
        assertTrue(admin.path("enabled").asBoolean());assertTrue(admin.path("published").asBoolean());
        assertTrue(admin.path("capabilities").isArray());
        List<?> capabilities=json.convertValue(admin.path("capabilities"),List.class);
        assertTrue(capabilities.contains("create"));assertTrue(capabilities.contains("manage"));
        assertEquals(admin.path("capabilities"),user.path("capabilities"));
        assertFalse(user.has("endpoint"));assertFalse(user.has("secret"));
        JsonNode legacy=data(postJson("/api/knowledge-mcp/connections",input()),"admin");
        assertFalse(json.convertValue(legacy.path("capabilities"),List.class).contains("create"));
    }
    @Test void optimisticRevisionsDeduplicationAndDeleteProtectionAreEnforced()throws Exception{
        JsonNode c=connection("alice");String id=c.path("id").asText();JsonNode configured=bind("alice","expert","expert",id,"A",1);
        failure(postJson(scope("expert","expert")+"/references",map("revision",1,"connectionId",id,"collectionId","B")),"alice",409);
        failure(postJson(scope("expert","expert")+"/references",map("revision",2,"connectionId",id,"collectionId","A")),"alice",409);
        failure(delete("/api/knowledge-mcp/connections/"+id+"?revision=1"),"admin",409);
        String ref=configured.path("knowledgeBases").get(0).path("id").asText();
        data(delete(scope("expert","expert")+"/references/"+ref+"?revision=2"),"alice");
        failure(delete("/api/knowledge-mcp/connections/"+id+"?revision=1"),"admin",409);
    }
    @Test void secretsAreEncryptedAndConnectionUpdatesApplyToExistingReferences()throws Exception{
        Map<String,Object> create=input();create.put("authType","bearer");create.put("secret","private-token");
        JsonNode c=data(postJson("/api/knowledge-mcp/connections",create),"admin");assertFalse(c.toString().contains("private-token"));assertTrue(c.path("hasSecret").asBoolean());
        String id=c.path("id").asText(),stored=jdbc.queryForObject("SELECT secret_cipher FROM nw_knowledge_connection WHERE id=?",String.class,id);
        assertTrue(stored.startsWith("v1:"));assertFalse(stored.contains("private-token"));
        assign(id,"alice","A");
        String ref=bind("alice","expert","expert",id,"A",1).path("knowledgeBases").get(0).path("id").asText();
        Map<String,Object> update=input();update.put("authType","bearer");update.put("revision",1);update.put("endpoint","http://updated.invalid/mcp");
        failure(postJson("/api/knowledge-mcp/connections/"+id,update),"admin",409);
        update.put("endpoint",input().get("endpoint"));data(postJson("/api/knowledge-mcp/connections/"+id,update),"admin");
        data(postJson(scope("expert","expert")+"/references/"+ref+"/read",map("operation","documents")),"alice");
        assertEquals(input().get("endpoint"),lastEndpoint);
        verify(driver).execute(eq(input().get("endpoint").toString()),eq(Collections.singletonMap("Authorization","Bearer private-token")),eq("documents"),eq("A"),any(JsonNode.class));
        update.put("revision",2);update.put("enabled",false);data(postJson("/api/knowledge-mcp/connections/"+id,update),"admin");
        failure(postJson(scope("expert","expert")+"/references/"+ref+"/read",map("operation","documents")),"alice",409);
        assertEquals(1,data(get(scope("expert","expert")),"alice").path("knowledgeBases").size());
        assertFalse(jdbc.queryForList("SELECT change_json FROM nw_config_audit").toString().contains("private-token"));
    }
    @Test void fixedProjectsKeepPublishedLocalReferencesAndAllowIndependentAdditions()throws Exception{
        String wb=workbench().path("id").asText();
        String shared=connection("alice").path("id").asText();
        JsonNode draft=bind("alice","workbench",wb,shared,"A",1);
        String local=draft.path("knowledgeBases").get(0).path("connectionId").asText(),ref=draft.path("knowledgeBases").get(0).path("id").asText();
        data(postJson("/api/workbenches/"+wb+"/config",map("revision",2,"bizName","业务","domain","领域","bizDef","业务定义")),"alice");
        JsonNode v1=publish(wb,3),p1=project(wb);
        assertEquals("A",v1.path("version").path("snapshot").path("knowledgeBases").get(0).path("collectionId").asText());
        data(delete(scope("workbench",wb)+"/references/"+ref+"?revision=3"),"alice");
        publish(wb,4);JsonNode p2=project(wb);
        JsonNode inherited=data(get(scope("project",p1.path("id").asText())),"alice");
        assertTrue(inherited.path("knowledgeBases").get(0).path("inherited").asBoolean());
        assertEquals(0,data(get(scope("project",p2.path("id").asText())),"alice").path("knowledgeBases").size());
        failure(delete(scope("project",p1.path("id").asText())+"/references/"+ref+"?revision=1"),"alice",409);
        data(postJson(scope("project",p1.path("id").asText())+"/references/"+ref+"/read",map("operation","documents")),"alice");
        assign(shared,"alice","B");JsonNode own=bind("alice","project",p1.path("id").asText(),shared,"B",1);
        assertEquals(2,own.path("knowledgeBases").size());
        failure(delete("/api/knowledge-mcp/connections/"+local+"?revision=1"),"admin",409);
        assertTrue(data(get("/api/knowledge-mcp/connections/"+local+"/references"),"admin").toString().contains("publication"));
        unavailable=true;assertEquals(2,data(get(scope("project",p1.path("id").asText())),"alice").path("knowledgeBases").size());
        failure(postJson(scope("project",p1.path("id").asText())+"/references/"+ref+"/read",map("operation","documents")),"alice",503);
    }
    @Test void publishedKnowledgeReferencesCannotContainEndpointOrCredentials()throws Exception{
        String connection=connection("alice").path("id").asText(),wb=workbench().path("id").asText();
        bind("alice","workbench",wb,connection,"A",1);
        JsonNode configured=data(postJson("/api/workbenches/"+wb+"/config",map("revision",data(get("/api/workbenches/"+wb+"/config"),"alice").path("config").path("revision").asLong(),"bizName","业务","domain","分析","bizDef","说明")),"alice");
        JsonNode release=publish(wb,configured.path("config").path("revision").asLong());
        String refs=release.path("version").path("snapshot").path("knowledgeBases").toString();
        assertTrue(refs.contains("collectionId"));assertFalse(refs.contains("endpoint"));assertFalse(refs.contains("secret"));assertFalse(refs.contains("knowledge.invalid"));
    }
    String restConnection()throws Exception{
        return data(postJson("/api/knowledge-mcp/connections",map("name","Nebulae V100","driver","nebulae-v100-rest","endpoint","https://v100.invalid/deploy","authType","header","authHeader","X-API-Key","secret","full-access-key","published",true)),"admin").path("id").asText();
    }
    KnowledgeRestClient.Session restFixture(){
        KnowledgeRestClient.Session session=mock(KnowledgeRestClient.Session.class);
        when(rest.execute(anyString(),anyMap(),any())).thenAnswer(i->((java.util.function.Function<KnowledgeRestClient.Session,Object>)i.getArgument(2)).apply(session));
        when(rest.executeUpload(anyString(),anyMap(),any())).thenAnswer(i->((java.util.function.Function<KnowledgeRestClient.Session,Object>)i.getArgument(2)).apply(session));
        when(session.request(anyString(),anyString(),nullable(JsonNode.class))).thenAnswer(i->{
            String method=i.getArgument(0),path=i.getArgument(1);JsonNode body=i.getArgument(2);
            if("POST".equals(method)&&"/knowledge-bases".equals(path))return json.valueToTree(map("success",true,"data",map("id","created","name",body.path("name").asText(),"type",body.path("type").asText())));
            if(path.startsWith("/knowledge-bases?"))return json.valueToTree(map("success",true,"data",Arrays.asList(map("id","created","name","我的库","type","document"),map("id","other","name","其他库","type","document"))));
            if(path.equals("/knowledge-bases/created"))return json.valueToTree(map("id","created","type","document"));
            if(path.startsWith("/knowledge/foreign"))return json.valueToTree(map("data",map("id","foreign","knowledge_base_id","other")));
            if(path.startsWith("/knowledge-bases/created/faq/entries?"))return json.valueToTree(map("success",true,"data",map("data",Collections.singletonList(map("id",7,"standard_question","问题","answers",Collections.singletonList("答案"))),"total",30,"page",2,"page_size",20)));
            if(path.startsWith("/faq/import/progress/"))return json.valueToTree(map("data",map("kb_id","created","task_id","import-task","status","processing")));
            if(path.endsWith("/faq/entries")&&"POST".equals(method))return json.valueToTree(map("data",map("task_id","import-task")));
            if(path.equals("/knowledge-search"))return json.valueToTree(map("data",Collections.singletonList(map("knowledge_base_id","created","knowledge_id","doc","id","chunk","content","证据"))));
            return json.createObjectNode();
        });return session;
    }
    JsonNode createRequest(String key){return json.valueToTree(map("operation","kb.create","requestKey",key,"payload",map("name","我的库","type","document","embedding_model_id","embedding")));}
    MockHttpServletRequestBuilder uploadRequest(String base,String key,String path,String content){
        org.springframework.test.web.servlet.request.MockMultipartHttpServletRequestBuilder request=multipart(base+"/upload").file(new MockMultipartFile("file","a.md","text/markdown",content.getBytes(StandardCharsets.UTF_8)));
        request.param("collectionId","created").param("fileName","a.md").param("requestKey",key);
        if(path!=null)request.param("relativePath",path);return request;
    }
    @Test void uploadsLegacyAndFolderFilesIdempotentlyWithIndependentPaths()throws Exception{
        KnowledgeRestClient.Session session=restFixture();String id=restConnection(),base="/api/knowledge-mcp/connections/"+id;
        data(postJson(base+"/manage",createRequest("create-upload-library")),"alice");
        when(session.upload(anyString(),any(),anyString())).thenReturn(json.valueToTree(map("data",map("id","doc","knowledge_base_id","created","parse_status","pending"))));
        assertEquals("accepted",data(uploadRequest(base,"upload-legacy-key",null,"正文"),"alice").path("outcome").asText());
        data(uploadRequest(base,"upload-legacy-key",null,"正文"),"alice");
        verify(session,times(1)).upload(eq("/knowledge-bases/created/knowledge/file"),any(),eq("a.md"));
        data(uploadRequest(base,"upload-folder-one","公司/一/a.md","正文一"),"alice");
        data(uploadRequest(base,"upload-folder-two","公司/二/a.md","正文二"),"alice");
        verify(session).upload(eq("/knowledge-bases/created/knowledge/file"),any(),eq("公司/一/a.md"));
        verify(session).upload(eq("/knowledge-bases/created/knowledge/file"),any(),eq("公司/二/a.md"));
        failure(uploadRequest(base,"upload-folder-one","公司/三/a.md","正文一"),"alice",409);
        failure(uploadRequest(base,"upload-foreign-key",null,"正文"),"bob",404);
        assertEquals(3,jdbc.queryForObject("SELECT COUNT(*) FROM nw_knowledge_operation WHERE operation='document.upload'",Integer.class));
    }
    @Test void uploadValidationAndFaqRejectionDoNotCreateReceipts()throws Exception{
        KnowledgeRestClient.Session session=restFixture();String id=restConnection(),base="/api/knowledge-mcp/connections/"+id;
        data(postJson(base+"/manage",createRequest("create-upload-validation")),"alice");
        failure(uploadRequest(base,"upload-invalid-path","../a.md","正文"),"alice",422);
        failure(uploadRequest(base,"upload-empty-file",null,""),"alice",422);
        when(session.request("GET","/knowledge-bases/created",null)).thenReturn(json.valueToTree(map("id","created","type","faq")));
        failure(uploadRequest(base,"upload-faq-rejected",null,"正文"),"alice",422);
        assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM nw_knowledge_operation WHERE operation='document.upload'",Integer.class));
        verify(session,never()).upload(anyString(),any(),anyString());
    }
    @Test void uploadTimeoutIsNeverReplayedAndDuplicatesPreserveTheirOriginalReceipt()throws Exception{
        KnowledgeRestClient.Session session=restFixture();String id=restConnection(),base="/api/knowledge-mcp/connections/"+id;
        data(postJson(base+"/manage",createRequest("create-upload-timeout")),"alice");
        when(session.upload(anyString(),any(),eq("a.md"))).thenThrow(new ApiException(504,"结果待核对"));
        failure(uploadRequest(base,"upload-timeout-key",null,"正文"),"alice",504);
        failure(uploadRequest(base,"upload-timeout-key",null,"正文"),"alice",409);
        verify(session,times(1)).upload(anyString(),any(),eq("a.md"));
        assertEquals("sent",jdbc.queryForObject("SELECT status FROM nw_knowledge_operation WHERE request_key='upload-timeout-key'",String.class));
        when(session.upload(anyString(),any(),eq("新目录/a.md"))).thenReturn(json.valueToTree(map("uploadOutcome","duplicate","data",map("id","existing","knowledge_base_id","created","folder_path","原目录"))));
        JsonNode first=data(uploadRequest(base,"upload-duplicate-key","新目录/a.md","正文"),"alice");
        JsonNode again=data(uploadRequest(base,"upload-duplicate-key","新目录/a.md","正文"),"alice");
        assertEquals("duplicate",first.path("outcome").asText());assertEquals(first.path("operationId"),again.path("operationId"));
        assertEquals("原目录",again.path("result").path("data").path("folder_path").asText());
        verify(session,times(1)).upload(anyString(),any(),eq("新目录/a.md"));
    }
    @Test void readOnlyHistoricalAccessCannotUploadAndDocumentReadsExposeSourcePaths()throws Exception{
        KnowledgeRestClient.Session session=restFixture();String id=restConnection(),base="/api/knowledge-mcp/connections/"+id;
        data(postJson(base+"/manage",createRequest("create-upload-reader")),"alice");
        JsonNode doc=json.valueToTree(map("id","doc","knowledge_base_id","created","title","a.md","file_name","a.md","folder_path","公司/制度","parse_status","pending"));
        when(session.request(eq("GET"),startsWith("/knowledge-bases/created/knowledge?"),isNull())).thenReturn(json.valueToTree(map("data",Collections.singletonList(doc),"total",1)));
        when(session.request("GET","/knowledge/doc",null)).thenReturn(json.valueToTree(map("data",doc)));
        when(session.request(eq("GET"),startsWith("/chunks/doc?"),isNull())).thenReturn(json.valueToTree(map("data",Collections.emptyList(),"total",0)));
        JsonNode list=data(postJson(base+"/read",map("collectionId","created","operation","documents")),"alice");
        assertEquals("公司/制度",list.path("documents").get(0).path("folderPath").asText());
        assertEquals("pending",list.path("documents").get(0).path("parseStatus").asText());
        JsonNode detail=data(postJson(base+"/read",map("collectionId","created","operation","document","documentId","doc")),"alice");
        assertEquals("公司/制度",detail.path("document").path("folderPath").asText());
        jdbc.update("INSERT INTO nw_knowledge_library_access(library_id,owner_id) SELECT id,'bob' FROM nw_knowledge_library WHERE collection_id='created'");
        failure(uploadRequest(base,"upload-reader-denied",null,"正文"),"bob",404);
        verify(session,never()).upload(anyString(),any(),anyString());
    }
    @Test void restContentAndTaskReceiptsStayIsolatedDespiteFullAccessKey()throws Exception{
        KnowledgeRestClient.Session session=restFixture();String id=restConnection(),base="/api/knowledge-mcp/connections/"+id;
        JsonNode request=createRequest("create-test-once");data(postJson(base+"/manage",request),"alice");data(postJson(base+"/manage",request),"alice");
        verify(session,times(1)).request(eq("POST"),eq("/knowledge-bases"),any());
        assertEquals(1,data(get(base+"/collections"),"alice").path("collections").size());assertEquals(0,data(get(base+"/collections"),"bob").path("collections").size());
        failure(postJson(base+"/manage",map("operation","kb.get","collectionId","created")),"bob",404);
        failure(postJson(base+"/manage",map("operation","kb.get","collectionId","created")),"admin",404);
        failure(postJson(base+"/manage",map("operation","document.delete","collectionId","created","resourceId","foreign","requestKey","delete-foreign")),"alice",404);
        verify(session,never()).request(eq("DELETE"),anyString(),any());
        JsonNode page=data(postJson(base+"/read",map("operation","documents","collectionId","created","contentKind","faq","page",2,"pageSize",20)),"alice");
        assertEquals(30,page.path("total").asInt());assertEquals("7",page.path("documents").get(0).path("id").asText());
        JsonNode receipt=data(postJson(base+"/manage",map("operation","faq.import","collectionId","created","requestKey","import-once","payload",map("entries",Collections.emptyList(),"mode","append"))),"alice");
        String operation=receipt.path("operationId").asText();failure(get("/api/knowledge-mcp/operations/"+operation+"/progress"),"bob",404);
        data(get("/api/knowledge-mcp/operations/"+operation+"/progress"),"alice");
        bind("alice","expert","expert",id,"created",1);
        failure(postJson(base+"/manage",map("operation","kb.delete","collectionId","created","requestKey","delete-referenced")),"alice",409);
    }
    @Test void remoteCreateReceiptCanOnlyBeRecoveredByItsInitiatorWithoutReplay()throws Exception{
        KnowledgeRestClient.Session session=restFixture();String id=restConnection(),base="/api/knowledge-mcp/connections/"+id;
        doThrow(new ApiException(500,"模拟归属登记失败")).doCallRealMethod().when(access).register(anyMap(),eq("created"),eq("alice"));
        failure(postJson(base+"/manage",createRequest("create-recover")),"alice",500);
        String op=jdbc.queryForObject("SELECT id FROM nw_knowledge_operation WHERE request_key='create-recover'",String.class);
        assertEquals("received",jdbc.queryForObject("SELECT status FROM nw_knowledge_operation WHERE id=?",String.class,op));
        failure(postJson(base+"/assign",map("collectionId","created","ownerId","bob")),"admin",409);
        failure(postJson("/api/knowledge-mcp/operations/"+op+"/recover",map()),"bob",404);
        data(postJson("/api/knowledge-mcp/operations/"+op+"/recover",map()),"alice");
        verify(session,times(1)).request(eq("POST"),eq("/knowledge-bases"),any());
        assertEquals("alice",jdbc.queryForObject("SELECT owner_id FROM nw_knowledge_library WHERE collection_id='created'",String.class));
    }
    @Test void legacyCipherAndSharedReadersSurviveExactlyOnceWithoutWriteEscalation()throws Exception{
        String id=connection("alice").path("id").asText();String ref=bind("alice","expert","expert",id,"A",1).path("knowledgeBases").get(0).path("id").asText();
        String encrypted=cipher.encrypt("legacy-owner",id,"legacy-key");
        jdbc.update("UPDATE nw_knowledge_connection SET owner_id='legacy-owner',scope_kind='user',legacy_migrated=FALSE,auth_type='bearer',secret_cipher=? WHERE id=?",encrypted,id);
        jdbc.update("DELETE FROM nw_knowledge_library");access.migrateLegacy();
        assertFalse(access.allowed("alice",access.connection(id),"A",true));assertTrue(access.allowed("alice",access.connection(id),"A",false));
        data(postJson(scope("expert","expert")+"/references/"+ref+"/read",map("operation","documents")),"alice");
        verify(driver).execute(anyString(),eq(Collections.singletonMap("Authorization","Bearer legacy-key")),eq("documents"),eq("A"),any());
        jdbc.update("DELETE FROM nw_knowledge_library_access");access.migrateLegacy();assertFalse(access.allowed("alice",access.connection(id),"A",false));
        assertFalse(data(get("/api/knowledge-mcp/connections"),"admin").toString().contains("legacy-key"));
    }
    @Test void embeddedServiceUsesVerifiedIdentityAndMigratedSchemaOverHttp()throws Exception{
        java.net.HttpURLConnection http=(java.net.HttpURLConnection)new java.net.URL("http://127.0.0.1:"+serverPort+"/nwaa/api/knowledge-mcp/settings").openConnection();
        http.setRequestProperty("token","alice-token");http.setRequestProperty("userId","admin");http.setConnectTimeout(3000);http.setReadTimeout(3000);
        try{assertEquals(200,http.getResponseCode());JsonNode settings=json.readTree(http.getInputStream()).path("data");assertEquals("alice",settings.path("actorId").asText());assertFalse(settings.path("canEdit").asBoolean());}finally{http.disconnect();}
        assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM nw_knowledge_guard",Integer.class));
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings={"document","faq","wiki"})
    void allLibraryKindsSupportContentSearchAndPinnedProjectReading(String kind)throws Exception{
        KnowledgeRestClient.Session session=restFixture();String id=restConnection(),base="/api/knowledge-mcp/connections/"+id;
        when(session.request("GET","/knowledge-bases/created",null)).thenReturn(json.valueToTree(map("id","created","type",kind)));
        String search="wiki".equals(kind)?"/wiki-search":"faq".equals(kind)?"/knowledge-bases/created/faq/search":"/knowledge-search";
        when(session.request(eq("POST"),eq(search),any())).thenReturn(json.valueToTree(map("data",Collections.singletonList(map("knowledge_base_id","created","knowledge_id","doc","id",7,"slug","nested/page","standard_question","问题","answers",Collections.singletonList("答案"),"content","证据","match_snippet","Wiki 证据")))));
        JsonNode create=createRequest("create-three-kinds");((ObjectNode)create.path("payload")).put("type",kind);data(postJson(base+"/manage",create),"alice");
        Object payload;String operation,path;
        if("faq".equals(kind)){operation="faq.create";path="/knowledge-bases/created/faq/entry";payload=map("standard_question","问题","answers",Collections.singletonList("答案"));}
        else if("wiki".equals(kind)){operation="wiki.create";path="/knowledgebase/created/wiki/pages";payload=map("title","页面","slug","nested/page","content","# 证据");}
        else{operation="document.manual";path="/knowledge-bases/created/knowledge/manual";payload=map("title","文档","content","# 证据","status","publish");}
        data(postJson(base+"/manage",map("operation",operation,"collectionId","created","requestKey","write-content-once","payload",payload)),"alice");verify(session).request(eq("POST"),eq(path),any());
        String wb=workbench().path("id").asText();String ref=bind("alice","workbench",wb,id,"created",1).path("knowledgeBases").get(0).path("id").asText();
        data(postJson("/api/workbenches/"+wb+"/config",map("revision",2,"bizName","业务","domain","领域","bizDef","定义")),"alice");publish(wb,3);String project=project(wb).path("id").asText();
        JsonNode evidence=data(postJson(scope("project",project)+"/references/"+ref+"/read",map("operation","search","contentKind",kind,"query","证据")),"alice");
        assertEquals(kind,evidence.path("results").get(0).path("citation").path("contentKind").asText());
        failure(postJson(scope("project",project)+"/references/"+ref+"/read",map("operation","search","contentKind",kind,"query","证据")),"bob",404);
    }
    @Test void sourceContentRequiresCurrentLibraryAndExactAssetOwnership()throws Exception{
        KnowledgeRestClient.Session session=restFixture();String connection=restConnection(),base="/api/knowledge-mcp/connections/"+connection;
        data(postJson(base+"/manage",createRequest("source-content-library")),"alice");
        when(session.request("GET","/knowledge/doc",null)).thenReturn(json.valueToTree(map("data",map("id","doc","knowledge_base_id","created","file_name","source.pdf","file_type","pdf"))));
        when(session.request("GET","/chunks/by-id/chunk",null)).thenReturn(json.valueToTree(map("data",map("id","chunk","knowledge_id","doc","knowledge_base_id","created","is_enabled",true,"content","证据"))));
        when(session.download("/knowledge/doc/preview")).thenReturn(new KnowledgeRestClient.Binary("%PDF source".getBytes(StandardCharsets.UTF_8),"application/pdf"));
        when(session.download("/knowledge-bases/created/images/chunk/0/content")).thenReturn(new KnowledgeRestClient.Binary(new byte[]{1,2,3},"image/png"));
        mvc.perform(postJson(base+"/preview",map("collectionId","created","documentId","doc")).header("token","alice-token")).andExpect(status().isOk()).andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.content().contentType("application/pdf"));
        failure(postJson(base+"/preview",map("collectionId","created","documentId","doc")),"bob",404);
        failure(postJson(base+"/preview",map("collectionId","created","documentId","foreign")),"alice",404);
        failure(postJson(base+"/preview",map("collectionId","created","documentId","doc","url","https://not-allowed.invalid")),"alice",422);
        mvc.perform(postJson(base+"/media",map("collectionId","created","documentId","doc","chunkId","chunk","imageId","chunk#0")).header("token","alice-token")).andExpect(status().isOk());
        failure(postJson(base+"/media",map("collectionId","created","documentId","doc","chunkId","chunk","imageId","other#0")),"alice",404);
        jdbc.update("UPDATE nw_knowledge_connection SET enabled=FALSE WHERE id=?",connection);
        failure(postJson(base+"/preview",map("collectionId","created","documentId","doc")),"alice",409);
    }
    @Test void persistedTaskEvidenceSurvivesRefreshAndCannotBypassRevokedPermission()throws Exception{
        KnowledgeRestClient.Session session=restFixture();String connection=restConnection(),base="/api/knowledge-mcp/connections/"+connection;
        data(postJson(base+"/manage",createRequest("evidence-library")),"alice");
        String wb=workbench().path("id").asText();String reference=bind("alice","workbench",wb,connection,"created",1).path("knowledgeBases").get(0).path("id").asText();
        data(postJson("/api/workbenches/"+wb+"/config",map("revision",2,"bizName","业务","domain","领域","bizDef","定义")),"alice");publish(wb,3);String project=project(wb).path("id").asText();
        jdbc.update("INSERT INTO nw_agent_task(id,owner_id,project_id,title,context_json,request_key,request_hash) VALUES('evidence-task','alice',?,'证据任务','{}','evidence-task-key','hash')",project);
        JsonNode response=json.valueToTree(map("results",Collections.singletonList(map("text","真实引用正文","citation",map("documentId","doc","collectionId","created","chunkId","chunk","contentKind","document","title","来源")))));
        JsonNode registered=evidenceService.record("alice","evidence-task","evidence-run","evidence-call","project",project,reference,response);String id=registered.path("results").get(0).path("citation").path("evidenceId").asText();
        String path="/api/tasks/evidence-task/evidence/"+id;assertEquals("真实引用正文",data(get(path),"alice").path("text").asText());assertEquals(id,data(get(path),"alice").path("citation").path("evidenceId").asText());
        evidenceService.record("alice","evidence-task","evidence-run","evidence-call","project",project,reference,response);assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM nw_knowledge_evidence WHERE task_id='evidence-task'",Integer.class));
        failure(get(path),"bob",404);
        jdbc.update("UPDATE nw_knowledge_library SET owner_id='bob' WHERE collection_id='created'");jdbc.update("DELETE FROM nw_knowledge_library_access WHERE owner_id='alice'");
        failure(get(path),"alice",404);
    }


    private String v101Connection()throws Exception{
        Map<String,Object> request=input();request.put("driver",NebulaeV101RestDriver.ID);request.put("endpoint","http://v101.invalid/api/v1");request.put("published",true);
        return data(postJson("/api/knowledge-mcp/connections",request),"admin").path("id").asText();
    }
    @SuppressWarnings("unchecked") private KnowledgeRestClient.Session v101Remote()throws Exception{
        KnowledgeRestClient.Session remote=mock(KnowledgeRestClient.Session.class);
        when(rest.execute(anyString(),anyMap(),any(java.util.function.Function.class))).thenAnswer(call->((java.util.function.Function<KnowledgeRestClient.Session,Object>)call.getArgument(2)).apply(remote));
        when(remote.request(eq("POST"),eq("/knowledge-bases"),any())).thenReturn(json.valueToTree(map("success",true,"data",map("id","created-v101","name","创建验证"))));
        return remote;
    }
    @Test void v101MainCreateCommitsRecoveryRequestWithoutBlockingReceiptAndNeverReplays()throws Exception{
        String connection=v101Connection(),path="/api/knowledge-mcp/connections/"+connection+"/manage";KnowledgeRestClient.Session remote=v101Remote();
        Map<String,Object> request=map("operation","kb.create","requestKey","main-create-123","payload",map("name","创建验证","description","主站管理入口"));
        JsonNode first=data(postJson(path,request),"alice"),second=data(postJson(path,request),"alice");
        assertEquals("created-v101",first.path("result").path("data").path("id").asText());assertEquals(first,second);
        Map<String,Object> receipt=jdbc.queryForMap("SELECT * FROM nw_knowledge_operation WHERE owner_id='alice' AND request_key='main-create-123'");
        assertEquals("completed",receipt.get("status"));assertNotNull(receipt.get("request_json"));assertNotNull(receipt.get("result_json"));assertEquals("POST",json.readTree(receipt.get("request_json").toString()).path("method").asText());
        assertEquals("alice",jdbc.queryForObject("SELECT owner_id FROM nw_knowledge_library WHERE collection_id='created-v101'",String.class));
        verify(remote,times(1)).request(eq("POST"),eq("/knowledge-bases"),any());
        request.put("payload",map("name","其他请求"));failure(postJson(path,request),"alice",409);
    }
    @Test void v101CreateResponseSurvivesOwnershipRollbackAndRecoveryOnlyRestoresLocalState()throws Exception{
        String connection=v101Connection(),path="/api/knowledge-mcp/connections/"+connection+"/manage";KnowledgeRestClient.Session remote=v101Remote();
        doThrow(new ApiException(503,"模拟归属保存失败")).when(access).register(anyMap(),eq("created-v101"),eq("alice"));
        failure(postJson(path,map("operation","kb.create","requestKey","recover-v101-create","payload",map("name","创建验证"))),"alice",503);
        Map<String,Object> receipt=jdbc.queryForMap("SELECT * FROM nw_knowledge_operation WHERE owner_id='alice' AND request_key='recover-v101-create'");assertEquals("received",receipt.get("status"));assertNotNull(receipt.get("request_json"));assertNotNull(receipt.get("result_json"));
        failure(postJson("/api/knowledge-mcp/operations/"+receipt.get("id")+"/recover",map()),"bob",404);
        doCallRealMethod().when(access).register(anyMap(),eq("created-v101"),eq("alice"));data(postJson("/api/knowledge-mcp/operations/"+receipt.get("id")+"/recover",map()),"alice");
        assertEquals("alice",jdbc.queryForObject("SELECT owner_id FROM nw_knowledge_library WHERE collection_id='created-v101'",String.class));assertEquals("completed",jdbc.queryForObject("SELECT status FROM nw_knowledge_operation WHERE id=?",String.class,receipt.get("id")));
        verify(remote,times(1)).request(eq("POST"),eq("/knowledge-bases"),any());
    }
}
