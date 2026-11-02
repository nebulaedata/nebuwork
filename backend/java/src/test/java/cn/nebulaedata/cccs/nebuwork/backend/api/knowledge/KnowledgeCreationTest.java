package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentClient;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.*;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.MediaType;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(properties={"spring.datasource.url=jdbc:h2:mem:knowledgecreation;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false","nebu.knowledge.creation-worker-enabled=false","nebu.knowledge.admin-ids=admin","nebu.knowledge.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="})
@ActiveProfiles("expert-local") @AutoConfigureMockMvc
class KnowledgeCreationTest {
 @Autowired MockMvc mvc;@Autowired ObjectMapper json;@Autowired KnowledgeCreationService service;@Autowired JdbcTemplate sql;
 @MockBean AccountSessionStore sessions;@MockBean KnowledgeCreationRemote remote;@MockBean AgentClient engine;
 @SpyBean KnowledgeAccess access;
 String connection;JsonNode payload;ObjectNode config,business;
 @BeforeEach void setup()throws Exception{
  for(String table:Arrays.asList("nw_knowledge_creation_job","nw_knowledge_template_version","nw_knowledge_template","nw_knowledge_library_access","nw_knowledge_library","nw_knowledge_operation","nw_knowledge_connection"))sql.update("DELETE FROM "+table);
  for(String actor:Arrays.asList("admin","alice","bob"))when(sessions.findActor(actor+"-token")).thenReturn(actor);
  connection=post("admin","/connections",map("name","远端","driver","nebulae-v100-rest","endpoint","http://knowledge.invalid/api/v1","authType","header","authHeader","X-API-Key","secret","test-secret","enabled",true,"published",true)).path("id").asText();
  config=templateConfig(json);
  business=(ObjectNode)json.readTree("{\"name\":\"标准规范库\",\"description\":\"标准资料\",\"wiki_config\":{\"content_instructions\":\"按标准组织\",\"extraction_instructions\":\"提取技术指标\"},\"vlm_config\":{\"custom_instructions\":\"保留单位\"},\"extract_config\":{\"custom_instructions\":\"提取标准实体\",\"text\":\"虚构示例：示例机构发布示例标准\",\"tags\":[\"发布\"],\"nodes\":[{\"name\":\"示例机构\",\"attributes\":[]},{\"name\":\"示例标准\",\"attributes\":[]}],\"relations\":[{\"node1\":\"示例机构\",\"node2\":\"示例标准\",\"type\":\"发布\"}]}}");
  when(remote.generate(anyMap(),any(),any())).thenAnswer(i->business.deepCopy());
  when(remote.create(anyMap(),any())).thenAnswer(i->{payload=i.getArgument(1);return json.valueToTree(map("id",payload.path("id").asText()));});
  when(remote.read(anyMap(),anyString())).thenAnswer(i->payload.deepCopy());doCallRealMethod().when(remote).verify(any(),any());
 }
 static ObjectNode templateConfig(ObjectMapper json)throws Exception{return (ObjectNode)json.readTree("{\"generation_model_id\":\"chat\",\"embedding_model_id\":\"embed\",\"summary_model_id\":\"chat\",\"indexing_strategy\":{\"vector_enabled\":true,\"keyword_enabled\":true,\"wiki_enabled\":true,\"graph_enabled\":true},\"chunking_config\":{\"chunk_size\":1000,\"chunk_overlap\":200,\"strategy\":\"legacy\",\"parser_engine_rules\":[{\"engine\":\"builtin\",\"file_types\":[\"pdf\"]}]},\"wiki_config\":{\"synthesis_model_id\":\"chat\",\"extraction_granularity\":\"standard\",\"max_pages_per_ingest\":0},\"vlm_config\":{\"enabled\":true,\"model_id\":\"vision\",\"description_language\":\"\"},\"image_processing_config\":{\"image_attrs_enabled\":false,\"image_vector_enabled\":false},\"asr_config\":{\"enabled\":false,\"model_id\":\"\",\"language\":\"\"},\"storage_backend_id\":\"\",\"vector_store_id\":\"\"}");}
 JsonNode post(String actor,String path,Object body)throws Exception{return json.readTree(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/api/knowledge-mcp"+path).header("token",actor+"-token").header("userId","forged").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))).andExpect(status().is2xxSuccessful()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8)).path("data");}
 JsonNode get(String actor,String path)throws Exception{return json.readTree(mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/knowledge-mcp"+path).header("token",actor+"-token")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString(StandardCharsets.UTF_8)).path("data");}
 JsonNode template()throws Exception{return post("admin","/connections/"+connection+"/creation-templates",map("name","企业知识库","enabled",true,"isDefault",true,"config",config));}
 Map<String,Object> input(JsonNode t,boolean preview){return map("templateId",t.path("id").asText(),"revision",t.path("revision").asLong(),"name","","description","建立标准规范知识库","preview",preview,"requestKey","create-test-key");}
 String submit(JsonNode t,boolean preview)throws Exception{return post("alice","/creation-jobs",input(t,preview)).path("id").asText();}
 String state(String id)throws Exception{return get("alice","/creation-jobs/"+id).path("status").asText();}
 @Test void generatesCreatesVerifiesAndRegistersWithFrozenTemplate()throws Exception{
  JsonNode t=template();String id=submit(t,false);assertEquals(id,submit(t,false));service.process(id);assertEquals("completed",state(id));
  assertEquals("alice",sql.queryForObject("SELECT owner_id FROM nw_knowledge_library ",String.class));
  assertTrue(payload.path("indexing_strategy").path("graph_enabled").asBoolean());assertTrue(payload.path("extract_config").path("enabled").asBoolean());assertTrue(payload.path("vlm_config").path("enabled").asBoolean());assertTrue(payload.path("indexing_strategy").path("wiki_enabled").asBoolean());assertFalse(payload.has("generation_model_id"));assertFalse(payload.has("vector_store_id"));
  service.process(id);verify(remote,times(1)).create(anyMap(),any());assertEquals(0,get("bob","/creation-jobs").size());
  String publicTemplates=get("bob","/creation-templates").toString();assertFalse(publicTemplates.contains("model_id"));assertFalse(publicTemplates.contains("secret"));assertFalse(publicTemplates.contains("knowledge.invalid"));
  mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/knowledge-mcp/creation-jobs/"+id).header("token","bob-token")).andExpect(status().isNotFound());
 }
 @Test void previewEditsBusinessButCannotInjectInfrastructure()throws Exception{
  String id=submit(template(),true);service.process(id);assertEquals("preview",state(id));verify(remote,never()).create(anyMap(),any());
  ObjectNode injected=business.deepCopy();((ObjectNode)injected.get("vlm_config")).put("base_url","http://evil");assertThrows(ApiException.class,()->service.confirm("alice",id,json.valueToTree(map("business",injected))));
  ObjectNode edited=business.deepCopy();edited.put("name","用户编辑名称");post("alice","/creation-jobs/"+id+"/confirm",map("business",edited));service.process(id);assertEquals("completed",state(id));assertEquals("用户编辑名称",payload.path("name").asText());verify(remote,times(1)).generate(anyMap(),any(),any());
 }
 @Test void administratorEndpointsRejectOrdinaryUsers()throws Exception{
  JsonNode body=json.valueToTree(map("name","模板","enabled",true,"isDefault",true,"config",config));assertThrows(ApiException.class,()->service.saveTemplate("alice",connection,null,body));assertThrows(ApiException.class,()->service.validateTemplate("alice",connection,config));assertThrows(ApiException.class,()->service.resources("alice",connection));
  mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/api/knowledge-mcp/connections/"+connection+"/creation-templates").header("token","alice-token")).andExpect(status().isForbidden());
 }
 @Test void missingDependencyBlocksEnableAndGenerationCanRetry()throws Exception{
  doThrow(new ApiException(422,"Neo4j 未启用")).when(remote).validate(anyMap(),any());assertThrows(ApiException.class,()->service.saveTemplate("admin",connection,null,json.valueToTree(map("name","模板","enabled",true,"isDefault",true,"config",config))));assertEquals(0,sql.queryForObject("SELECT COUNT(*) FROM nw_knowledge_template",Integer.class));doNothing().when(remote).validate(anyMap(),any());
  String id=submit(template(),false);when(remote.generate(anyMap(),any(),any())).thenThrow(new ApiException(504,"生成超时"));service.process(id);assertEquals("failed",state(id));verify(remote,never()).create(anyMap(),any());
  doReturn(business).when(remote).generate(anyMap(),any(),any());post("alice","/creation-jobs/"+id+"/retry",map());service.process(id);assertEquals("completed",state(id));
 }
 @Test void lostCreateResponseNeverReplays()throws Exception{
  String id=submit(template(),false);doAnswer(i->{payload=i.getArgument(1);throw new ApiException(504,"远端响应丢失");}).when(remote).create(anyMap(),any());service.process(id);assertEquals("unknown",state(id));
  assertThrows(ApiException.class,()->service.retry("alice",id,false));service.retry("alice",id,true);service.process(id);assertEquals("completed",state(id));verify(remote,times(1)).create(anyMap(),any());
 }
 @Test void knownRemoteIdSurvivesFailedRegistration()throws Exception{
  String id=submit(template(),false);doThrow(new ApiException(503,"登记暂不可用")).when(access).register(anyMap(),anyString(),eq("alice"));service.process(id);assertEquals("unknown",state(id));
  doCallRealMethod().when(access).register(anyMap(),anyString(),eq("alice"));post("alice","/creation-jobs/"+id+"/recover",map());service.process(id);assertEquals("completed",state(id));verify(remote,times(1)).create(anyMap(),any());verify(remote,times(1)).generate(anyMap(),any(),any());
 }
 @Test void templateChangesFreezeExistingJobsButTargetChangesStopThem()throws Exception{
  JsonNode t=template();String id=submit(t,false);ObjectNode changedConfig=config.deepCopy();changedConfig.put("summary_model_id","new-model");post("admin","/connections/"+connection+"/creation-templates/"+t.path("id").asText(),map("name","模板新版","revision",1,"enabled",true,"isDefault",true,"config",changedConfig));service.process(id);assertEquals("chat",payload.path("summary_model_id").asText());assertEquals(2,sql.queryForObject("SELECT COUNT(*) FROM nw_knowledge_template_version",Integer.class));
  JsonNode next=json.valueToTree(map("id",t.path("id").asText(),"revision",2));Map<String,Object> request=input(next,false);request.put("requestKey","another-creation-key");String stopped=post("alice","/creation-jobs",request).path("id").asText();sql.update("UPDATE nw_knowledge_connection SET tenant_id='changed' WHERE id=?",connection);service.process(stopped);assertEquals("failed",state(stopped));verify(remote,times(1)).create(anyMap(),any());
 }
 @Test void expiredWorkerLeaseRequiresExplicitRetryAndRevokedLibraryHidesDraft()throws Exception{
  String id=submit(template(),false);sql.update("UPDATE nw_knowledge_creation_job SET status='running',lease_token='old',lease_until=? WHERE id=?",new java.sql.Timestamp(1),id);service.due();assertEquals("failed",state(id));post("alice","/creation-jobs/"+id+"/retry",map());service.process(id);assertEquals("completed",state(id));sql.update("UPDATE nw_knowledge_library SET owner_id='bob' ");assertTrue(get("alice","/creation-jobs/"+id).path("business").isNull());
 }
}
