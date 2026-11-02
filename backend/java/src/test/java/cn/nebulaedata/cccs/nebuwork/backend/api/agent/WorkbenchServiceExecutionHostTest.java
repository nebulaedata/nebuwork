package cn.nebulaedata.cccs.nebuwork.backend.api.agent;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import java.nio.file.*;
import static org.mockito.Mockito.when;
import static org.junit.jupiter.api.Assertions.assertTrue;
@EnabledIfEnvironmentVariable(named="NEBU_SERVICE_EXECUTION_ACCEPTANCE",matches="1")
@ActiveProfiles("expert-local")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.DEFINED_PORT,properties={
 "server.port=42025","spring.datasource.url=jdbc:h2:mem:serviceexecution;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
 "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
 "spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false",
 "nebu.models.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.models.block-special-addresses=false",
 "nebu.agent.base-url=http://127.0.0.1:42320","nebu.agent.namespace=service-acceptance",
 "nebu.agent.signing-key=isolated-test-signing-key-32-characters","nebu.agent.callback-key=isolated-test-business-key-32-characters",
 "nebu.workbench-services.enabled=true","nebu.workbench-services.public-base-url=http://127.0.0.1:42025/nwaa",
 "nebu.workbench-services.frontend-url=http://127.0.0.1:5174","nebu.workflow.admin-ids=service-acceptance-user",
 "nebu.platform-mcp.url=http://127.0.0.1:42321/mcp","nebu.platform-mcp.service-key=isolated-service-protocol-key-32-characters"})
class WorkbenchServiceExecutionHostTest {
    @Autowired JdbcTemplate jdbc; @Autowired ModelSecretCipher cipher; @MockBean AccountSessionStore sessions;
    @Test void serveUntilExternalAssertionsFinish()throws Exception{
        AgentTestSettings.seed(jdbc,cipher,"http://127.0.0.1:42320","service-acceptance","isolated-test-signing-key-32-characters","isolated-test-business-key-32-characters");
        when(sessions.findActor("service-acceptance-token")).thenReturn("service-acceptance-user");
        Path done=Paths.get(System.getProperty("nebu.service.execution.done"));long deadline=System.currentTimeMillis()+15*60*1000;
        while(!Files.exists(done)&&System.currentTimeMillis()<deadline)Thread.sleep(250);
        assertTrue(Files.exists(done),"External service execution acceptance did not finish");
    }
}
