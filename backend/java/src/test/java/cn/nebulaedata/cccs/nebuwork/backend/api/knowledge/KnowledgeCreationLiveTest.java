package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentClient;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.*;
import org.springframework.test.context.ActiveProfiles;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Opt-in HTTP integration. Point only at a disposable WeKnora workspace; this creates a real library. */
@EnabledIfEnvironmentVariable(named="KNOWLEDGE_LIVE_TEST",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.DEFINED_PORT,properties={"server.address=127.0.0.1","server.port=${KNOWLEDGE_LIVE_PORT:0}","spring.datasource.url=jdbc:h2:mem:knowledgecreationlive;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false","nebu.knowledge.creation-worker-enabled=true","nebu.knowledge.admin-ids=admin","nebu.knowledge.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.knowledge.allowed-internal-origins=${KNOWLEDGE_LIVE_ORIGIN}"})
@ActiveProfiles("expert-local")
class KnowledgeCreationLiveTest {
    @Autowired TestRestTemplate http;
    @Autowired ObjectMapper json;
    @MockBean AccountSessionStore sessions;
    @MockBean AgentClient engine;
    private JsonNode request(String actor,HttpMethod method,String path,Object body) throws Exception {
        HttpHeaders headers=new HttpHeaders();headers.set("token",actor+"-isolated-token");headers.setContentType(MediaType.APPLICATION_JSON);
        ResponseEntity<String> response=http.exchange("/api/knowledge-mcp"+path,method,new HttpEntity<>(body,headers),String.class);
        assertTrue(response.getStatusCode().is2xxSuccessful(),"HTTP "+response.getStatusCodeValue()+" at "+path);
        JsonNode result=json.readTree(response.getBody());assertEquals(0,result.path("code").asInt(),result.path("msg").asText());return result.path("data");
    }
    @Test void actualGenerationAndReadbackThroughJavaHttpAndPersistentWorker() throws Exception {
        for(String actor:Arrays.asList("admin","alice","bob"))when(sessions.findActor(actor+"-isolated-token")).thenReturn(actor);
        String connection=request("admin",HttpMethod.POST,"/connections",map("name","隔离联调连接","driver","nebulae-v100-rest","endpoint",System.getenv("KNOWLEDGE_LIVE_ORIGIN")+"/api/v1","authType","header","authHeader","X-API-Key","secret",System.getenv("KNOWLEDGE_LIVE_KEY"),"enabled",true,"published",true)).path("id").asText();
        JsonNode resources=request("admin",HttpMethod.GET,"/connections/"+connection+"/creation-resources",null);
        ObjectNode config=KnowledgeCreationTest.templateConfig(json);
        for(JsonNode m:resources.path("models")){
            String type=m.path("type").asText(),id=m.path("id").asText();
            if("KnowledgeQA".equals(type)){config.put("generation_model_id",id);config.put("summary_model_id",id);((ObjectNode)config.path("wiki_config")).put("synthesis_model_id",id);}
            if("Embedding".equals(type))config.put("embedding_model_id",id);
            if("VLLM".equals(type))((ObjectNode)config.path("vlm_config")).put("model_id",id);
        }
        ((ObjectNode)config.path("chunking_config").path("parser_engine_rules").get(0)).putArray("file_types").add("docx").add("pdf");
        config.put("storage_backend_id",resources.path("storage").get(0).path("id").asText());
        JsonNode template=request("admin",HttpMethod.POST,"/connections/"+connection+"/creation-templates",map("name","隔离验收模板","enabled",true,"isDefault",true,"config",config));
        Map<String,Object> input=map("templateId",template.path("id").asText(),"revision",1,"name","","description","这是隔离测试知识库，收集虚构北辰设备工厂的设备运维手册、参数表格和流程图片，关注设备、部件、维护周期、温度范围和责任部门。要求答案引用来源，不能把配置示例当真实知识。","preview",false,"requestKey","live-creation-"+UUID.randomUUID());
        String id=request("alice",HttpMethod.POST,"/creation-jobs",input).path("id").asText();assertEquals(id,request("alice",HttpMethod.POST,"/creation-jobs",input).path("id").asText());
        long deadline=System.currentTimeMillis()+980000;JsonNode job;
        do{Thread.sleep(1500);job=request("alice",HttpMethod.GET,"/creation-jobs/"+id,null);if(!Arrays.asList("queued","running").contains(job.path("status").asText()))break;}while(System.currentTimeMillis()<deadline);
        assertEquals("completed",job.path("status").asText(),job.path("error").asText());
        assertFalse(job.path("collectionId").asText().isEmpty());assertEquals(0,request("bob",HttpMethod.GET,"/creation-jobs",null).size());
        assertFalse(request("bob",HttpMethod.GET,"/creation-templates",null).toString().contains("model_id"));
        System.out.println("CREATION_LIVE_VERIFIED collection="+job.path("collectionId").asText()+" name="+job.path("business").path("name").asText());
        // Optional bounded window for browser/upload verification against this isolated test server.
        String hold=System.getenv("KNOWLEDGE_LIVE_HOLD_SECONDS");
        if(hold!=null)Thread.sleep(Math.max(0,Math.min(300,Integer.parseInt(hold)))*1000L);
    }
}
