package cn.nebulaedata.cccs.nebuwork.backend.api.platformmcp;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.expert.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.memory.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.workbench.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.workflow.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.junit.jupiter.api.*;
import org.springframework.transaction.PlatformTransactionManager;
import java.util.*;
import java.util.stream.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Every advertised adapter is exercised independently; domain behavior remains tested by its service suite. */
class PlatformMcpAdapterTest {
    final ObjectMapper json=new ObjectMapper();
    @TestFactory Stream<DynamicTest> everyAdvertisedToolHasAnExecutableAdapter(){PlatformMcpCatalog catalog=new PlatformMcpCatalog(json);return catalog.all().stream().map(tool->DynamicTest.dynamicTest(tool.name,()->exercise(tool)));}
    void exercise(PlatformMcpCatalog.Tool tool)throws Exception{
        WorkbenchService wb=mock(WorkbenchService.class);ExpertService experts=mock(ExpertService.class);ExpertAbilityService ability=mock(ExpertAbilityService.class);RuntimeResources runtime=mock(RuntimeResources.class);AgentTasks tasks=mock(AgentTasks.class);AgentUsage usage=mock(AgentUsage.class);AgentClient engine=mock(AgentClient.class);
        AgentStore db=mock(AgentStore.class,inv->{if(inv.getMethod().getName().equals("rows"))return new ArrayList<>();if(inv.getMethod().getName().equals("one")&&String.valueOf((Object)inv.getArgument(0)).contains("nw_platform_mcp_resource"))return map("descriptor_json","{\"type\":\"artifact\",\"projectId\":\"project\",\"id\":\"file\",\"version\":1}","expires_at",Long.MAX_VALUE);if(inv.getMethod().getName().equals("one"))return null;return org.mockito.Answers.RETURNS_DEFAULTS.answer(inv);});
        WorkflowService workflows=mock(WorkflowService.class);WorkflowSettings workflowSettings=mock(WorkflowSettings.class);KnowledgeService knowledge=mock(KnowledgeService.class);KnowledgeManagement management=mock(KnowledgeManagement.class);KnowledgeCreationService creation=mock(KnowledgeCreationService.class);KnowledgeContent content=mock(KnowledgeContent.class);KnowledgeEvidence evidence=mock(KnowledgeEvidence.class);MemoryService memory=mock(MemoryService.class);MemoryRuntime memoryRuntime=mock(MemoryRuntime.class);MemorySettings memorySettings=mock(MemorySettings.class);ModelProviderService models=mock(ModelProviderService.class);MemoryConfigurationService memoryConfig=mock(MemoryConfigurationService.class);AgentEngineConfiguration engineSettings=mock(AgentEngineConfiguration.class);
        PlatformMcpDispatch dispatch=new PlatformMcpDispatch(wb,experts,ability,runtime,tasks,usage,engine,db,workflows,workflowSettings,knowledge,management,creation,content,evidence,memory,memoryRuntime,memorySettings,models,memoryConfig,engineSettings,json);
        PlatformMcpCatalog catalog=new PlatformMcpCatalog(json);PlatformMcpService service=new PlatformMcpService(db,tasks,engine,mock(WorkbenchMapper.class),json,catalog,dispatch,knowledge,mock(PlatformTransactionManager.class),"http://mcp.invalid/mcp","test-service-key-1234567890123456789012");
        JsonNode policy=json.valueToTree(map("enabled",true,"scope","account","tools",Arrays.asList(tool.name),"resources",Collections.emptyList()));JsonNode run=json.valueToTree(map("id","run","sessionId","session","projectId","project","ownerId","alice","manifest",map("experts",Collections.emptyList(),"knowledgeReferences",Collections.emptyList())));
        when(tasks.project(anyString(),anyString(),anyBoolean())).thenReturn(map("id","project","workbench_id","workbench"));
        PlatformMcpService.Context c=service.new Context(run,map("id","task"),policy,policy);
        when(wb.get(anyString(),anyString())).thenReturn(map("id","wb","projectIds",Collections.emptyList()));
        when(tasks.detail(anyString(),anyString())).thenReturn(json.valueToTree(map("task",map("id","task","projectId","project"),"runs",Collections.emptyList())));
        when(tasks.create(anyString(),anyString(),any(),anyString())).thenReturn(json.valueToTree(map("task",map("id","target"))));
        when(tasks.send(anyString(),anyString(),any(),anyString())).thenReturn(json.valueToTree(map("id","new-run")));
        when(tasks.runs(anyString(),anyString())).thenReturn(json.valueToTree(map("items",Collections.emptyList())));
        when(experts.detail(anyString(),anyString(),anyInt())).thenReturn(map("agent",map()));
        when(tasks.run(anyString(),anyString(),anyString())).thenReturn(json.valueToTree(map("id","run","manifest",map())));
        when(usage.load(anyString(),nullable(String.class))).thenReturn(json.createObjectNode());
        when(memory.detail(anyString(),anyString())).thenReturn(map("id","memory","state","draft"));
        when(runtime.view(anyString(),anyString(),anyString())).thenReturn(map("revision",1,"document",RuntimeResources.empty(json)));
        when(runtime.upload(anyString(),anyString(),anyString(),anyString(),any(),anyString())).thenReturn(map("path","file"));
        when(engine.get(anyString(),nullable(String.class),anyString())).thenReturn(json.valueToTree(map("items",Collections.emptyList(),"name","file","mediaType","text/plain")));
        when(engine.contentBytes(anyString(),anyString(),anyString(),anyInt())).thenReturn(new byte[]{65});
        when(management.download(anyString(),anyString(),anyString(),anyString(),anyString())).thenReturn(new cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeRestClient.Binary(new byte[]{65},"text/plain"));
        when(content.catalog(anyString(),anyString(),anyString(),any(),anyBoolean())).thenReturn(new cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeRestClient.Binary(new byte[]{65},"text/plain"));
        when(knowledge.readCatalog(anyString(),anyString(),anyString(),anyString(),any())).thenReturn(json.createObjectNode());
        when(knowledge.collections(anyString(),anyString(),anyBoolean())).thenReturn(json.valueToTree(map("collections",Collections.emptyList())));
        when(evidence.recordCatalog(anyString(),anyString(),anyString(),anyString(),anyString(),anyString(),any())).thenReturn(json.createObjectNode());
        ObjectNode args=json.createObjectNode();JsonNode properties=json.valueToTree(tool.schema).path("properties");properties.fields().forEachRemaining(e->{String type=e.getValue().path("type").asText();if(type.equals("integer"))args.put(e.getKey(),1);else if(type.equals("boolean"))args.put(e.getKey(),true);else if(type.equals("object"))args.set(e.getKey(),json.createObjectNode());else args.put(e.getKey(),e.getKey().equals("mode")?"update":e.getKey().equals("kind")?"project":e.getKey().equals("uri")?"nebuwork://resource/handle":"id");});
        args.put("id","id");if(!properties.has("id"))args.remove("id");if(properties.has("projectId"))args.put("projectId","project");if(properties.has("expertId"))args.put("expertId","expert");if(properties.has("taskId"))args.put("taskId","task");if(properties.has("action"))args.put("action",tool.name.contains("reference")?"bind":tool.name.contains("parse")?"reparse":tool.name.contains("batch")?"tags":"cancel");if(properties.has("source"))args.put("source","manual");if(properties.has("format"))args.put("format","json");if(tool.name.startsWith("nw_admin_"))args.put("kind","memory");
        if(properties.has("data")){ObjectNode data=json.createObjectNode();data.put("title","title");data.put("content","content");data.put("revision",1);if(tool.name.equals("nw_runtime_save"))data.remove(Arrays.asList("title","content","revision"));if(tool.name.equals("nw_knowledge_library_create")){data.removeAll();data.put("name","test");data.put("type","faq");}if(tool.name.equals("nw_knowledge_library_update")){data.removeAll();data.put("name","test");}args.set("data",data);}
        if(properties.has("referenceId"))args.remove("referenceId");if(tool.name.equals("nw_expert_binding_set"))args.put("kind","extensions");
        if(properties.has("file"))args.set("file",json.valueToTree(map("projectId","project","id","file","version",1)));
        if(tool.name.equals("nw_faq_import"))args.remove("file");
        if(tool.name.equals("nw_memory_context_get"))args.put("taskId","task");if(tool.name.equals("nw_task_events_list")||tool.name.equals("nw_task_expert_run_get"))args.put("id","task");
        if(tool.name.equals("nw_operation_get"))assertThrows(RuntimeException.class,()->dispatch.invoke(c,tool.name,args,"operation-key"));else assertDoesNotThrow(()->dispatch.invoke(c,tool.name,args,"operation-key"),tool.name);
    }
    @Test void catalogSnapshotCanBeExportedWithoutCredentials()throws Exception{PlatformMcpCatalog catalog=new PlatformMcpCatalog(json);List<Object> tools=catalog.all().stream().map(PlatformMcpCatalog.Tool::dto).collect(Collectors.toList());java.nio.file.Path target=java.nio.file.Paths.get("target/platform-mcp-catalog.json");java.nio.file.Files.createDirectories(target.getParent());java.nio.file.Files.write(target,json.writerWithDefaultPrettyPrinter().writeValueAsBytes(map("version",PlatformMcpCatalog.VERSION,"tools",tools)));assertFalse(json.writeValueAsString(tools).contains("apiKey"));}
}
