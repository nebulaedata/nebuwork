package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.springframework.mock.env.MockEnvironment;
import java.net.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

class KnowledgeCreationRemoteTest {
 ObjectMapper json=new ObjectMapper();HttpServer server;KnowledgeRestClient client;KnowledgeCreationRemote remote;Map<String,Object> connection;Map<String,Object> replies=new HashMap<>();ObjectNode config;
 @BeforeEach void setup()throws Exception{
  server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);String root="http://127.0.0.1:"+server.getAddress().getPort();MockEnvironment env=new MockEnvironment().withProperty("nebu.knowledge.allowed-internal-origins",root);client=new KnowledgeRestClient(json,env,new KnowledgeNetworkPolicy(env));KnowledgeService knowledge=mock(KnowledgeService.class);when(knowledge.headers(anyMap())).thenReturn(Collections.singletonMap("X-API-Key","private-test-key"));remote=new KnowledgeCreationRemote(client,knowledge,json);connection=map("endpoint",root+"/deploy/api/v1");config=KnowledgeCreationTest.templateConfig(json);
  replies.put("/models",Arrays.asList(map("id","chat","type","KnowledgeQA","name","聊天","status","active","parameters",map("api_key","do-not-leak","base_url","http://private.invalid")),map("id","embed","type","Embedding","name","向量","capabilities",map("input",Arrays.asList("text","image"))),map("id","vision","type","VLLM","name","视觉")));
  replies.put("/storage-backends",Arrays.asList(map("id","store","name","文件存储","provider","local","config",map("secret","private"))));replies.put("/vector-stores",Arrays.asList(map("id","__env_postgres__","name","PG","source","env"),map("id","vector","name","专用存储","engine_type","postgres")));
  replies.put("/system/parser-engines",Arrays.asList(map("Name","builtin","Available",true,"FileTypes",Arrays.asList("pdf","docx"))));replies.put("/system/info",map("graph_database_engine","Neo4j","vector_store_engine","PostgreSQL","keyword_index_engine","BM25"));replies.put("/initialization/generate/knowledge-base-config",map("schema_version",1,"graph_available",true,"accepts_create_id",true));replies.put("/models/embed",map("capabilities",map("input",Arrays.asList("text","image"))));
  server.createContext("/",e->{byte[] bytes=json.writeValueAsBytes(map("data",replies.get(e.getRequestURI().getPath().replace("/deploy/api/v1","")),"success",true));e.sendResponseHeaders(200,bytes.length);e.getResponseBody().write(bytes);e.close();});server.start();
 }
 @AfterEach void close(){client.close();server.stop(0);}
 @Test void catalogUsesRealWireShapesAndStripsAllInfrastructureSecrets(){JsonNode result=remote.resources(connection);assertEquals("builtin",result.path("parsers").get(0).path("id").asText());assertEquals(1,result.path("vectors").size());assertTrue(result.path("models").get(1).path("supportsImage").asBoolean());assertFalse(result.toString().contains("private"));assertFalse(result.toString().contains("config"));remote.validate(connection,config);}
 @Test void connectedGraphWithoutAPOCIsNotAUsableDependency(){replies.put("/initialization/generate/knowledge-base-config",map("schema_version",1,"graph_available",false,"graph_error","apoc_unavailable","accepts_create_id",true));RuntimeException error=assertThrows(RuntimeException.class,()->remote.validate(connection,config));assertTrue(error.getMessage().contains("APOC"));}
 @Test void unavailableGraphParserAndWrongModelsBlockCreation(){replies.put("/system/info",map("graph_database_engine","Not Enabled","vector_store_engine","PostgreSQL","keyword_index_engine","BM25"));assertThrows(RuntimeException.class,()->remote.validate(connection,config));replies.put("/system/info",map("graph_database_engine","Neo4j","vector_store_engine","PostgreSQL","keyword_index_engine","BM25"));replies.put("/system/parser-engines",Arrays.asList(map("Name","builtin","Available",false,"FileTypes",Arrays.asList("pdf"))));assertThrows(RuntimeException.class,()->remote.validate(connection,config));replies.put("/system/parser-engines",Arrays.asList(map("Name","builtin","Available",true,"FileTypes",Arrays.asList("pdf"))));config.put("summary_model_id","embed");assertThrows(RuntimeException.class,()->remote.validate(connection,config));}
 @Test void imageVectorChecksInputCapabilityAndUnsafeInlineCredentialsAreRejected(){((ObjectNode)config.path("image_processing_config")).put("image_vector_enabled",true);remote.validate(connection,config);replies.put("/models/embed",map("capabilities",map("input",Arrays.asList("text"))));assertThrows(RuntimeException.class,()->remote.validate(connection,config));((ObjectNode)config.path("vlm_config")).put("api_key","secret");assertThrows(RuntimeException.class,()->KnowledgeCreationConfig.technical(config));assertThrows(RuntimeException.class,()->KnowledgeCreationConfig.safeCreate(config));}
 @Test void readbackAllowsOmittedEmptyFieldsButDetectsMissingEnabledFeatures()throws Exception{ObjectNode expected=(ObjectNode)json.readTree("{\"vlm_config\":{\"enabled\":true,\"description_language\":\"\"},\"image_processing_config\":{\"image_vector_enabled\":false},\"chunking_config\":{\"parser_engine_rules\":[]}}");ObjectNode actual=(ObjectNode)json.readTree("{\"vlm_config\":{\"enabled\":true},\"image_processing_config\":{},\"chunking_config\":{}}");remote.verify(actual,expected);((ObjectNode)actual.path("vlm_config")).put("enabled",false);assertThrows(RuntimeException.class,()->remote.verify(actual,expected));}
}
