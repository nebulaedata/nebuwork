package cn.nebulaedata.cccs.nebuwork.backend.api.extensionmarket;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.expert.ExpertMapper;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import cn.nebulaedata.cccs.nebuwork.backend.api.workbench.WorkbenchMapper;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.*;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class ExtensionMarketTest {
    final ObjectMapper json=new ObjectMapper();
    AgentStore db;AgentClient engine;ExtensionMarket market;MockEnvironment env;
    JsonNode tree(Object value){return json.valueToTree(value);}
    @BeforeEach void setup()throws Exception{
        JdbcDataSource source=new JdbcDataSource();source.setURL("jdbc:h2:mem:market"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        try(java.sql.Connection c=source.getConnection()){ScriptUtils.executeSqlScript(c,new ClassPathResource("db/migration/V26__extension_market.sql"));}
        JdbcTemplate jdbc=new JdbcTemplate(source);db=new AgentStore(jdbc);
        jdbc.execute("CREATE TABLE nw_agent_resource(owner_id VARCHAR(128),scope_kind VARCHAR(16),scope_id VARCHAR(128),document_json JSON,revision BIGINT DEFAULT 1,active_version_id VARCHAR(64),updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6),PRIMARY KEY(owner_id,scope_kind,scope_id))");
        jdbc.execute("CREATE TABLE nw_agent_resource_version(id VARCHAR(64) PRIMARY KEY,owner_id VARCHAR(128),scope_kind VARCHAR(16),scope_id VARCHAR(128),source_revision BIGINT,bundle_id VARCHAR(128),bundle_version VARCHAR(64),document_json JSON,content_hash VARCHAR(64))");
        ExpertMapper experts=mock(ExpertMapper.class);WorkbenchMapper scopes=mock(WorkbenchMapper.class);engine=mock(AgentClient.class);
        when(experts.visibleExpert(anyString(),eq("expert"))).thenReturn(map("id","expert","name","Expert"));
        when(scopes.workbench(anyString(),eq("wb"))).thenReturn(map("id","wb","name","Workbench"));
        when(scopes.project(anyString(),eq("project"))).thenReturn(map("id","project","workbench_id","wb","status","active"));
        when(engine.get(anyString(),isNull(),eq("/v1/capabilities"))).thenReturn(tree(map("managedMarketMcp",true)));
        when(engine.post(anyString(),eq("extension-market"),eq("/v1/projects/extension-market/artifacts"),any(),anyString())).thenAnswer(call->tree(map("id","artifact-"+call.getArgument(4).hashCode(),"version",1,"mediaType","text/plain")));
        when(engine.contentBytes(anyString(),eq("extension-market"),anyString(),anyInt())).thenReturn("content".getBytes(java.nio.charset.StandardCharsets.UTF_8));
        when(engine.post(anyString(),isNull(),eq("/v1/objects"),any(),anyString())).thenAnswer(call->tree(map("objectKey",call.getArgument(0)+"/"+call.getArgument(4),"sha256",String.join("",Collections.nCopies(64,"a")),"size",7,"mediaType","text/plain")));
        env=new MockEnvironment().withProperty("nebu.extension-market.enabled","true").withProperty("nebu.extension-market.admin-ids","admin").withProperty("nebu.models.encryption-key",Base64.getEncoder().encodeToString(new byte[32]));
        market=new ExtensionMarket(db,engine,json,env,new ModelSecretCipher(env),experts,scopes,new DataSourceTransactionManager(source));
    }
    JsonNode draft(String id){return tree(market.detail("admin",id));}
    JsonNode skill()throws Exception{
        String id=tree(market.create("admin",tree(map("kind","skill","name","Published name","description","Purpose")))).path("id").asText();
        List<String> assets=new ArrayList<>();for(String path:Arrays.asList("SKILL.md","scripts/check.js"))assets.add(tree(market.upload("admin",id,path,new MockMultipartFile("file",path,"text/plain","content".getBytes()),"upload-"+UUID.randomUUID(),1)).path("id").asText());
        market.save("admin",id,tree(map("revision",draft(id).path("revision"),"name","Published name","description","Purpose","assetIds",assets,"requiredFiles",Collections.singletonList("scripts/check.js"))));
        return tree(market.publish("admin",id,tree(map("revision",draft(id).path("revision")))));
    }
    JsonNode install(String owner,JsonNode entry,String kind,String target,long revision,String key){return tree(market.install(owner,entry.path("id").asText(),tree(map("targetKind",kind,"targetId",target,"versionId",entry.path("versionId"),"runtimeRevision",revision)),key));}
    JsonNode document(String owner,String kind,String target){return cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.decode(json,db.draft(owner,kind,target).get("document_json"));}
    @Test void defaultsAndAdminBoundaryAreEnforced(){
        env.setProperty("nebu.extension-market.enabled","false");assertFalse(tree(market.list("alice","","",0,24,false)).path("enabled").asBoolean());
        assertThrows(ApiException.class,()->market.create("admin",tree(map())));
        env.setProperty("nebu.extension-market.enabled","true");assertThrows(ApiException.class,()->market.create("alice",tree(map())));
        env.setProperty("nebu.extension-market.admin-ids","");assertFalse(market.admin("admin"));
    }
    @Test void publishedMetadataAndVersionsDoNotChangeWithTheDraft()throws Exception{
        JsonNode entry=skill();String id=entry.path("id").asText();
        market.save("admin",id,tree(map("revision",entry.path("revision"),"name","Unpublished name","description","New purpose","assetIds",Collections.emptyList())));
        JsonNode publicEntry=tree(market.detail("alice",id));assertEquals("Published name",publicEntry.path("name").asText());
        assertEquals(2,publicEntry.path("versions").get(0).path("payload").path("files").size());
        assertFalse(publicEntry.has("draft"));assertFalse(publicEntry.toString().contains("artifactOwner"));
        assertEquals("Unpublished name",draft(id).path("name").asText());
    }
    @Test void installsAllThreeScopesAtomicallyAndSeparatelyForEachAccount()throws Exception{
        JsonNode entry=skill();ObjectNode original=RuntimeResources.empty(json);original.put("modelProviderId","personal-model");original.withArray("instructions").add(tree(map("path","AGENTS.md","content","keep")));
        for(String kind:Arrays.asList("expert","workbench","project")){String target=kind.equals("expert")?"expert":kind.equals("workbench")?"wb":"project";
            db.update("INSERT INTO nw_agent_resource(owner_id,scope_kind,scope_id,document_json) VALUES(?,?,?,?)","alice",kind,target,original.toString());
            JsonNode op=install("alice",entry,kind,target,1,"install-"+kind);market.work();assertEquals("succeeded",tree(market.operation("alice",op.path("id").asText())).path("state").asText());
            JsonNode saved=document("alice",kind,target);assertEquals("personal-model",saved.path("modelProviderId").asText());assertEquals("keep",saved.path("instructions").get(0).path("content").asText());assertEquals(0,saved.path("skills").size());assertEquals(1,saved.path("extensionRefs").size());
            JsonNode expanded=market.expand("alice",kind,target,saved);assertEquals(2,expanded.path("files").size());assertTrue(expanded.path("files").get(0).path("objectKey").asText().startsWith("alice/"));
        }
        install("bob",entry,"expert","expert",0,"bob-install");market.work();
        String alice=document("alice","expert","expert").path("extensionRefs").get(0).path("installationId").asText(),bob=document("bob","expert","expert").path("extensionRefs").get(0).path("installationId").asText();assertNotEquals(alice,bob);
        assertThrows(ApiException.class,()->market.validateRefs("bob","expert","expert",document("alice","expert","expert")));
        JsonNode again=install("alice",entry,"expert","expert",1,"install-expert");assertEquals("succeeded",again.path("state").asText());
        assertThrows(ApiException.class,()->install("alice",entry,"workbench","wb",1,"install-expert"));
    }
    @Test void copyFailureAndRevisionConflictNeverPartiallyChangeTheDraft()throws Exception{
        JsonNode entry=skill();JsonNode copy=tree(map("objectKey","alice/object","sha256",org.apache.commons.codec.digest.DigestUtils.sha256Hex("content"),"size",7,"mediaType","text/plain"));
        when(engine.post(eq("alice"),isNull(),eq("/v1/objects"),any(),anyString())).thenReturn(copy).thenThrow(new IllegalStateException("storage down")).thenReturn(copy);
        JsonNode op=install("alice",entry,"expert","expert",0,"failed-copy");market.work();assertNull(db.draft("alice","expert","expert"));JsonNode failed=tree(market.operation("alice",op.path("id").asText()));assertEquals("failed",failed.path("state").asText());assertEquals(1,failed.path("copiedFiles").asInt());
        market.retry("alice",op.path("id").asText());market.work();assertEquals("succeeded",tree(market.operation("alice",op.path("id").asText())).path("state").asText());verify(engine,times(3)).post(eq("alice"),isNull(),eq("/v1/objects"),any(),anyString());
        JsonNode conflict=install("alice",entry,"expert","expert",0,"stale-revision");market.work();assertEquals("conflict",tree(market.operation("alice",conflict.path("id").asText())).path("state").asText());assertEquals(1,document("alice","expert","expert").path("extensionRefs").size());
    }
    @Test void withdrawalBlocksNewInstallsButKeepsExistingFixedReferences()throws Exception{
        JsonNode entry=skill();JsonNode op=install("alice",entry,"expert","expert",0,"before-withdraw");market.work();String id=entry.path("id").asText();market.listing("admin",id,tree(map("revision",entry.path("revision"))),false);
        assertThrows(ApiException.class,()->install("bob",entry,"expert","expert",0,"after-withdraw"));
        assertEquals("succeeded",install("alice",entry,"expert","expert",0,"before-withdraw").path("state").asText());
        assertEquals(1,market.expand("alice","expert","expert",document("alice","expert","expert")).path("skills").size());
        JsonNode removed=document("alice","expert","expert");String installation=removed.path("extensionRefs").get(0).path("installationId").asText();
        market.remove("alice",installation,tree(map("targetKind","expert","targetId","expert","revision",1)));
        assertThrows(ApiException.class,()->market.validateRefs("alice","expert","expert",removed));
    }
    @Test void expiredOperationsRequireExplicitRecoveryAndRejectTheirOldExecutor()throws Exception{
        JsonNode entry=skill(),op=install("alice",entry,"expert","expert",0,"recover-original");String operation=op.path("id").asText();
        db.update("UPDATE nw_market_operation SET state='running',execution_token='old-executor',lease_until=? WHERE id=?",new java.sql.Timestamp(0),operation);
        Map<String,Object> old=db.one("SELECT * FROM nw_market_operation WHERE id=?",operation);
        market.work();assertEquals("unknown",tree(market.operation("alice",operation)).path("state").asText());assertNull(db.draft("alice","expert","expert"));
        market.retry("alice",operation);market.work();assertEquals("succeeded",tree(market.operation("alice",operation)).path("state").asText());
        assertThrows(ApiException.class,()->ReflectionTestUtils.invokeMethod(market,"perform",old));assertEquals(1,((Number)db.draft("alice","expert","expert").get("revision")).longValue());
        assertEquals(operation,install("alice",entry,"expert","expert",0,"recover-original").path("id").asText());
    }
    @Test void publicationProjectsExecutableFieldsOnlyAndUpgradePreservesRuntimeOptions()throws Exception{
        JsonNode entry=skill();String extension=entry.path("id").asText();install("alice",entry,"workbench","wb",0,"initial-publication");market.work();
        AgentModels models=mock(AgentModels.class);when(models.binding(anyString(),any())).thenReturn(json.createObjectNode());
        WorkbenchMapper scopes=mock(WorkbenchMapper.class);when(scopes.workbench("alice","wb")).thenReturn(map("id","wb"));
        RuntimeResources resources=new RuntimeResources(db,scopes,mock(ExpertMapper.class),engine,models,json,new ModelSecretCipher(env));ReflectionTestUtils.setField(resources,"market",market);
        when(engine.post(eq("alice"),isNull(),eq("/v1/runtime-bundles"),any(),anyString())).thenAnswer(call->{JsonNode payload=tree(call.getArgument(3));assertFalse(payload.has("extensionRefs"));assertFalse(payload.has("authProfileId"));assertEquals(1,payload.path("skills").size());return tree(map("hash","fixed-hash"));});
        ObjectNode doc=(ObjectNode)document("alice","workbench","wb");((ObjectNode)doc.path("extensionRefs").get(0)).put("required",true);
        resources.save("alice","workbench","wb",tree(map("revision",1,"document",doc)));resources.publish("alice","workbench","wb",2);
        assertEquals(0,document("alice","workbench","wb").path("skills").size());assertEquals(1,cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.decode(json,db.active("alice","workbench","wb").get("document_json")).path("skills").size());
        entry=tree(market.publish("admin",extension,tree(map("revision",draft(extension).path("revision")))));
        install("alice",entry,"workbench","wb",2,"manual-upgrade");market.work();assertTrue(document("alice","workbench","wb").path("extensionRefs").get(0).path("required").asBoolean());
        JsonNode inherited=tree(market.targetInstallations("alice","project","project"));assertTrue(inherited.path("items").get(0).path("inherited").asBoolean());assertEquals(1,inherited.path("items").get(0).path("version").asInt());
        String installed=document("alice","workbench","wb").path("extensionRefs").get(0).path("installationId").asText();market.remove("alice",installed,tree(map("targetKind","workbench","targetId","wb","revision",3)));
        assertEquals(0,document("alice","workbench","wb").path("extensionRefs").size());assertEquals(1,tree(market.targetInstallations("alice","project","project")).path("items").size());
    }
    @Test void sharedCredentialsRotateWithoutChangingVersionsAndOldWorkersFailClosed(){
        JsonNode entry=tree(market.create("admin",tree(map("kind","mcp","name","Shared MCP","description","Managed"))));String id=entry.path("id").asText();
        market.save("admin",id,tree(map("revision",entry.path("revision"),"name","Shared MCP","description","Managed","mcp",map("transport","http","url","https://mcp.test/api"))));
        market.auth("admin",id,tree(map("revision",draft(id).path("revision"),"secret",map("headers",map("Authorization","first")))));
        entry=tree(market.publish("admin",id,tree(map("revision",draft(id).path("revision")))));
        for(String owner:Arrays.asList("alice","bob")){install(owner,entry,"expert","expert",0,"managed-"+owner);market.work();}
        for(String owner:Arrays.asList("alice","bob")){
            JsonNode server=market.expand(owner,"expert","expert",document(owner,"expert","expert")).path("mcp").get(0);
            JsonNode run=tree(map("ownerId",owner,"projectId","project","workerId","worker","fence",7,"leaseUntil",System.currentTimeMillis()+60000,"manifest",map("primaryExpertId","expert")));
            JsonNode request=tree(map("managedAuthProtocol",1,"executionContext","worker_http","workerId","worker","fence",7));
            assertEquals("first",market.credential(request,run,server).path("headers").path("Authorization").asText());
            assertThrows(ApiException.class,()->market.credential(tree(map()),run,server));
            ObjectNode stale=request.deepCopy();stale.put("fence",8);assertThrows(ApiException.class,()->market.credential(stale,run,server));
            ObjectNode expired=run.deepCopy();expired.put("leaseUntil",0);assertThrows(ApiException.class,()->market.credential(request,expired,server));
            ObjectNode wrongContext=request.deepCopy();wrongContext.put("executionContext","isolated_stdio");assertThrows(ApiException.class,()->market.credential(wrongContext,run,server));
            ObjectNode changed=server.deepCopy();changed.put("url","https://other.test/api");assertThrows(ApiException.class,()->market.credential(request,run,changed));
        }
        market.auth("admin",id,tree(map("revision",draft(id).path("revision"),"secret",map("headers",map("Authorization","rotated")))));
        JsonNode server=market.expand("alice","expert","expert",document("alice","expert","expert")).path("mcp").get(0);
        assertEquals("rotated",market.credential(tree(map("managedAuthProtocol",1,"executionContext","worker_http","workerId","worker","fence",7)),tree(map("ownerId","alice","projectId","project","workerId","worker","fence",7,"leaseUntil",System.currentTimeMillis()+60000,"manifest",map("primaryExpertId","expert"))),server).path("headers").path("Authorization").asText());
        assertEquals(1,draft(id).path("versions").size());assertFalse(draft(id).toString().contains("rotated"));
        market.save("admin",id,tree(map("revision",draft(id).path("revision"),"name","Shared MCP","description","New connection","mcp",map("transport","http","url","https://new-mcp.test/api"))));
        market.auth("admin",id,tree(map("revision",draft(id).path("revision"),"secret",map("headers",map("Authorization","different-target-secret")))));
        JsonNode next=tree(market.publish("admin",id,tree(map("revision",draft(id).path("revision")))));
        install("bob",next,"expert","expert",1,"new-connection");market.work();
        for(String owner:Arrays.asList("alice","bob")){
            JsonNode fixed=market.expand(owner,"expert","expert",document(owner,"expert","expert")).path("mcp").get(0),request=tree(map("managedAuthProtocol",1,"executionContext","worker_http","workerId","worker","fence",7)),run=tree(map("ownerId",owner,"projectId","project","workerId","worker","fence",7,"leaseUntil",System.currentTimeMillis()+60000,"manifest",map("primaryExpertId","expert")));
            assertEquals(owner.equals("alice")?"rotated":"different-target-secret",market.credential(request,run,fixed).path("headers").path("Authorization").asText());
        }
    }
    @Test void packageOverrideRemovesFilesMissingInNewVersionAndRemovalRestoresParent(){
        ObjectNode wb=RuntimeResources.empty(json),expert=RuntimeResources.empty(json),project=RuntimeResources.empty(json);String marketId="market-skill-ext-"+String.join("",Collections.nCopies(32,"a"));
        wb.withArray("skills").add(tree(map("id",marketId,"directory","market/ext","revision","v1")));wb.withArray("files").add(tree(map("path","market/ext/SKILL.md"))).add(tree(map("path","market/ext/obsolete.js")));
        expert.withArray("skills").add(tree(map("id",marketId,"directory","market/ext","revision","v2")));expert.withArray("files").add(tree(map("path","market/ext/SKILL.md")));
        JsonNode resolved=ExtensionRuntime.compose(json,wb,expert,project);assertEquals(1,resolved.path("files").size());assertEquals("v2",resolved.path("skills").get(0).path("revision").asText());
        ObjectNode manual=RuntimeResources.empty(json);manual.withArray("mcp").add(tree(map("id","market-local","transport","http","url","https://manual.test")));manual.withArray("files").add(tree(map("path","market/custom/resource.txt")));assertDoesNotThrow(()->market.validateRefs("alice","expert","expert",manual));
        JsonNode inherited=ExtensionRuntime.compose(json,wb,RuntimeResources.empty(json),project);assertEquals(2,inherited.path("files").size());assertEquals("v1",inherited.path("skills").get(0).path("revision").asText());
    }
}
