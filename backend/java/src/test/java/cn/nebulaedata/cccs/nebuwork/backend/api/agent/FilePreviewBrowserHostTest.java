package cn.nebulaedata.cccs.nebuwork.backend.api.agent;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeContent;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import com.fasterxml.jackson.databind.*;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import javax.servlet.http.HttpServletResponse;
import java.nio.file.*;
import java.util.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

/** Opt-in isolated HTTP host. Only identity/project/knowledge-source discovery are fixtures. */
@EnabledIfEnvironmentVariable(named="NEBU_FILE_PREVIEW_HOST",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.DEFINED_PORT,properties={"server.port=42150","server.address=0.0.0.0","server.servlet.context-path=/nebulaedev/nwaa","spring.datasource.url=jdbc:h2:mem:file_preview_browser;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false","nebu.models.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.knowledge.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.files.enabled=true","nebu.files.worker-key=isolated-file-preview-worker-key-32-characters","nebu.auth.allowed-origins=http://127.0.0.1:5187,http://localhost:5187","nebu.knowledge.creation-worker-enabled=false"})
@ActiveProfiles("expert-local")
class FilePreviewBrowserHostTest {
    @Autowired JdbcTemplate jdbc;@Autowired ModelSecretCipher cipher;@Autowired AgentClient engine;@Autowired ObjectMapper json;
    @MockBean AccountSessionStore sessions;@MockBean AgentTasks tasks;@MockBean KnowledgeContent knowledge;
    @Test void serveIsolatedFileAcceptance()throws Exception{
        when(sessions.findActor("file-preview-browser-alice")).thenReturn("alice");when(sessions.findActor("file-preview-browser-bob")).thenReturn("bob");
        AgentTestSettings.seed(jdbc,cipher,"http://host.docker.internal:42151","file-preview-browser","isolated-test-signing-key-32-characters","isolated-test-business-key-32-characters");
        when(tasks.project(anyString(),anyString(),anyBoolean())).thenAnswer(a->{if(!"alice".equals(a.getArgument(0))||!"project".equals(a.getArgument(1)))throw new ApiException(404,"项目不存在");return Collections.singletonMap("id","project");});
        when(tasks.artifacts(eq("alice"),eq("project"))).thenAnswer(a->engine.get("alice","project","/v1/projects/project/artifacts"));
        when(knowledge.largeMetadata(anyString(),any())).thenAnswer(a->{String owner=a.getArgument(0);JsonNode source=a.getArgument(1);if(!"alice".equals(owner)||!"fixture".equals(source.path("collectionId").asText()))throw new ApiException(403,"来源无权限");JsonNode artifact=engine.get(owner,"project","/v1/artifacts/"+AgentClient.segment(source.path("documentId").asText())+"?version=1");return json.createObjectNode().put("name",artifact.path("name").asText()).put("size",artifact.path("size").asLong()).put("sourceHash",artifact.path("sha256").asText()).put("version",1);});
        doAnswer(a->{String owner=a.getArgument(0);JsonNode source=a.getArgument(1);knowledge.largeMetadata(owner,source);engine.fileStream(owner,"project","/v1/artifacts/"+AgentClient.segment(source.path("documentId").asText())+"/content?version=1",a.getArgument(2),a.getArgument(3));return null;}).when(knowledge).largeStream(anyString(),any(),nullable(String.class),any(HttpServletResponse.class));
        Path directory=Paths.get("target","file-preview-browser");Files.createDirectories(directory);Files.deleteIfExists(directory.resolve("stop"));Files.write(directory.resolve("ready"),new byte[]{1});
        long deadline=System.currentTimeMillis()+2*60*60*1000L;while(System.currentTimeMillis()<deadline&&!Files.exists(directory.resolve("stop")))Thread.sleep(500);
    }
}
