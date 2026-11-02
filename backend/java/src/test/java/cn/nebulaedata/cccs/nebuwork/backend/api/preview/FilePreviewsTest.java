package cn.nebulaedata.cccs.nebuwork.backend.api.preview;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeContent;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ScriptUtils;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mock.env.MockEnvironment;
import java.sql.Connection;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class FilePreviewsTest {
    ObjectMapper json=new ObjectMapper();AgentStore db;PreviewSources sources;AgentClient engine;FilePreviews service;MockEnvironment env;
    final String digest=String.join("",Collections.nCopies(64,"a"));
    JsonNode source(String id){return json.createObjectNode().put("kind","artifact").put("projectId","project").put("artifactId",id).put("version",1);}
    JsonNode metadata(String name){return json.createObjectNode().put("name",name).put("size",30L*1024*1024).put("sha256",digest).put("version",1).put("objectKey","private-s3-object");}
    JsonNode create(String file)throws Exception{return json.valueToTree(service.create("alice",json.createObjectNode().set("source",source(file))));}
    @BeforeEach void setup()throws Exception{
        DriverManagerDataSource ds=new DriverManagerDataSource("jdbc:h2:mem:preview_"+UUID.randomUUID()+";MODE=MySQL;DB_CLOSE_DELAY=-1","sa","");try(Connection c=ds.getConnection()){ScriptUtils.executeSqlScript(c,new ClassPathResource("db/migration/V27__file_previews.sql"));ScriptUtils.executeSqlScript(c,new ClassPathResource("db/migration/V28__file_preview_account_lease.sql"));}
        db=new AgentStore(new JdbcTemplate(ds));engine=mock(AgentClient.class);sources=mock(PreviewSources.class);env=new MockEnvironment().withProperty("nebu.files.enabled","true").withProperty("nebu.files.worker-key","isolated-preview-worker-key-32-characters");service=new FilePreviews(db,engine,sources,json,env);
        when(sources.validate(any())).thenAnswer(a->((ObjectNode)a.getArgument(0)).deepCopy());when(sources.metadata(eq("alice"),any())).thenReturn(metadata("report.docx"));
    }
    @Test void cachesFixedSourcesAndKeepsStorageDetailsOutOfTheBrowser()throws Exception{JsonNode a=create("file"),b=create("file");assertEquals(a.path("id").asText(),b.path("id").asText());assertEquals("queued",a.path("status").asText());assertFalse(a.toString().contains("private-s3-object"));assertEquals(404,assertThrows(ApiException.class,()->service.status("bob",a.path("id").asText())).status);}
    @Test void leasesAreFencedAndOnlyOneJobPerAccountRuns()throws Exception{String id=create("a").path("id").asText();create("b");JsonNode first=json.valueToTree(service.claim());assertEquals(id,first.path("id").asText());assertNull(service.claim());String old=first.path("lease").asText();db.update("UPDATE nw_file_preview SET lease_until=0 WHERE id=?",id);JsonNode second=json.valueToTree(service.claim());assertNotEquals(old,second.path("lease").asText());assertEquals(409,assertThrows(ApiException.class,()->service.heartbeat(id,old,json.createObjectNode())).status);service.action("alice",id,"cancel");assertNotNull(service.claim());}
    @Test void everyCachedReadRechecksSourcePermission()throws Exception{String id=create("a").path("id").asText();when(sources.metadata(eq("alice"),any())).thenThrow(new ApiException(403,"revoked"));assertEquals(403,assertThrows(ApiException.class,()->service.status("alice",id)).status);assertNull(service.claim());assertEquals("failed",db.one("SELECT status FROM nw_file_preview WHERE id=?",id).get("status"));}
    @Test void nativePdfIsImmediatelyReadyAndWorkerCallsRequireTheConfiguredKey()throws Exception{when(sources.metadata(eq("alice"),any())).thenReturn(metadata("report.pdf"));assertEquals("ready",create("pdf").path("status").asText());assertThrows(ApiException.class,()->service.workerAuth(null));assertThrows(ApiException.class,()->service.workerAuth("Bearer incorrect"));assertDoesNotThrow(()->service.workerAuth("Bearer isolated-preview-worker-key-32-characters"));}
    @Test void disabledFeatureAndExpiredLeasesCannotProcessFiles()throws Exception{String id=create("a").path("id").asText();JsonNode lease=json.valueToTree(service.claim());db.update("UPDATE nw_file_preview SET started_at=0 WHERE id=?",id);assertThrows(ApiException.class,()->service.heartbeat(id,lease.path("lease").asText(),json.createObjectNode()));env.withProperty("nebu.files.enabled","false");assertEquals(503,assertThrows(ApiException.class,()->create("disabled")).status);}
    @Test void sourceValidationRejectsUrlsUnversionedArtifactsAndMismatchedProjects()throws Exception{AgentTasks tasks=mock(AgentTasks.class);PreviewSources real=new PreviewSources(tasks,engine,mock(KnowledgeContent.class),mock(KnowledgeEvidence.class),json);assertThrows(ApiException.class,()->real.validate(json.createObjectNode().put("kind","artifact").put("url","https://private")));ObjectNode unversioned=(ObjectNode)source("f");unversioned.remove("version");assertThrows(ApiException.class,()->real.validate(unversioned));when(engine.get(eq("alice"),eq("project"),anyString())).thenReturn(json.createObjectNode().put("projectId","other"));assertEquals(404,assertThrows(ApiException.class,()->real.metadata("alice",source("f"))).status);}
    @Test void passesMimeResolvedTypeToTheWorkerAndOnlyDownloadsOversizedText()throws Exception{
        when(sources.metadata(eq("alice"),any())).thenReturn(((ObjectNode)metadata("report.bin")).put("mediaType","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
        assertEquals("xlsx",create("mime").path("metadata").path("fileType").asText());
        when(sources.metadata(eq("alice"),any())).thenReturn(metadata("notes.md"));
        ObjectNode body=json.createObjectNode().put("downloadOnly",true);body.set("source",source("notes"));JsonNode job=json.valueToTree(service.create("alice",body));assertEquals("ready",job.path("status").asText());
        assertEquals(422,assertThrows(ApiException.class,()->service.content("alice",job.path("id").asText(),null,new org.springframework.mock.web.MockHttpServletResponse())).status);
    }
}
