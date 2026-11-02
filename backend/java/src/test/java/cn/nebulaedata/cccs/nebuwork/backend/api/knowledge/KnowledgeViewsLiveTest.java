package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentClient;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
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

/** Only run against the disposable stack created for this test workflow. */
@EnabledIfEnvironmentVariable(named="KNOWLEDGE_VIEWS_LIVE_TEST",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.DEFINED_PORT,properties={"server.address=127.0.0.1","server.port=${KNOWLEDGE_VIEWS_QA_PORT:0}","spring.datasource.url=jdbc:h2:mem:knowledgeviewslive;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false","nebu.knowledge.creation-worker-enabled=false","nebu.knowledge.admin-ids=admin","nebu.knowledge.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.knowledge.allowed-internal-origins=${KNOWLEDGE_LIVE_ORIGIN}","logging.level.root=WARN"})
@ActiveProfiles("expert-local")
class KnowledgeViewsLiveTest {
    @Autowired TestRestTemplate http;@Autowired ObjectMapper json;@MockBean AccountSessionStore sessions;@MockBean AgentClient engine;
    HttpHeaders headers(String actor){HttpHeaders h=new HttpHeaders();h.set("token",actor+"-isolated-token");h.setContentType(MediaType.APPLICATION_JSON);return h;}
    JsonNode post(String actor,String path,Object body)throws Exception{ResponseEntity<String> response=http.exchange("/api/knowledge-mcp"+path,HttpMethod.POST,new HttpEntity<>(body,headers(actor)),String.class);assertTrue(response.getStatusCode().is2xxSuccessful(),path+": "+response.getStatusCodeValue());JsonNode n=json.readTree(response.getBody());assertEquals(0,n.path("code").asInt());return n.path("data");}
    @Test void actualSearchWikiGraphGallerySourceAndImageThroughJavaHttp()throws Exception{
        for(String actor:Arrays.asList("admin","alice","bob"))when(sessions.findActor(actor+"-isolated-token")).thenReturn(actor);
        String kb=System.getenv("KNOWLEDGE_LIVE_KB"),doc=System.getenv("KNOWLEDGE_LIVE_DOC");
        String connection=post("admin","/connections",map("name","全能力隔离联调","driver","nebulae-v100-rest","endpoint",System.getenv("KNOWLEDGE_LIVE_ORIGIN"),"authType","header","authHeader","X-API-Key","secret",System.getenv("KNOWLEDGE_LIVE_KEY"),"tenantId",System.getenv("KNOWLEDGE_LIVE_TENANT"),"enabled",true,"published",false)).path("id").asText();
        String base="/connections/"+connection;post("admin",base+"/assign",map("collectionId",kb,"ownerId","alice"));
        JsonNode caps=post("alice",base+"/read",map("operation","capabilities","collectionId",kb));assertTrue(caps.path("capabilities").path("wiki").path("enabled").asBoolean());assertTrue(caps.path("capabilities").path("graph").path("enabled").asBoolean());
        JsonNode search=post("alice",base+"/read",map("operation","search","collectionId",kb,"query","BC-P100 水泵温度上限与维护责任","topK",5));assertTrue(search.path("results").size()>0);
        JsonNode citation=search.path("results").get(0).path("citation");String chunk=citation.path("chunkId").asText();assertEquals(doc,citation.path("documentId").asText());
        JsonNode source=post("alice",base+"/read",map("operation","chunk","collectionId",kb,"documentId",doc,"chunkId",chunk));assertEquals(chunk,source.path("chunk").path("id").asText());assertTrue(source.path("citation").path("sourceLocators").size()>0);
        JsonNode graph=post("alice",base+"/read",map("operation","graph","collectionId",kb,"mode","overview","limit",50));assertTrue(graph.path("nodes").size()>0);assertTrue(graph.path("sources").size()>0);
        JsonNode gallery=post("alice",base+"/read",map("operation","gallery","collectionId",kb));assertTrue(gallery.path("items").size()>0);assertFalse(gallery.toString().contains("resource://"));assertFalse(gallery.toString().contains("local://"));
        JsonNode pages=post("alice",base+"/read",map("operation","documents","contentKind","wiki","collectionId",kb));assertTrue(pages.path("documents").size()>0);JsonNode page=post("alice",base+"/read",map("operation","document","contentKind","wiki","documentId",pages.path("documents").get(0).path("id").asText(),"collectionId",kb));assertFalse(page.path("document").path("extractedText").asText().isEmpty());assertTrue(page.path("document").path("sourceRefs").size()>0);
        ResponseEntity<byte[]> file=http.exchange("/api/knowledge-mcp"+base+"/preview",HttpMethod.POST,new HttpEntity<>(map("collectionId",kb,"documentId",doc),headers("alice")),byte[].class);assertEquals(200,file.getStatusCodeValue());assertEquals('P',file.getBody()[0]);assertEquals('K',file.getBody()[1]);
        JsonNode image=gallery.path("items").get(0);ResponseEntity<byte[]> media=http.exchange("/api/knowledge-mcp"+base+"/media",HttpMethod.POST,new HttpEntity<>(map("collectionId",kb,"documentId",image.path("documentId").asText(),"chunkId",image.path("chunkId").asText(),"imageId",image.path("id").asText()),headers("alice")),byte[].class);assertEquals(200,media.getStatusCodeValue());assertTrue(media.getBody().length>100);
        ResponseEntity<String> denied=http.exchange("/api/knowledge-mcp"+base+"/read",HttpMethod.POST,new HttpEntity<>(map("operation","graph","collectionId",kb),headers("bob")),String.class);assertEquals(404,denied.getStatusCodeValue());
        System.out.println("KNOWLEDGE_VIEWS_LIVE_VERIFIED search="+search.path("results").size()+" graphNodes="+graph.path("nodes").size()+" images="+gallery.path("items").size()+" wikiPages="+pages.path("documents").size()+" sourceLocators="+source.path("citation").path("sourceLocators").size());
        String resultFile=System.getenv("KNOWLEDGE_LIVE_RESULT_FILE");if(resultFile!=null)java.nio.file.Files.write(java.nio.file.Paths.get(resultFile),json.writeValueAsBytes(map("connectionId",connection,"collectionId",kb,"documentId",doc)));
        String hold=System.getenv("KNOWLEDGE_VIEWS_HOLD_SECONDS");if(hold!=null)Thread.sleep(Math.max(0,Math.min(300,Integer.parseInt(hold)))*1000L);

    }
}
