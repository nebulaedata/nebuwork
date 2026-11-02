package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;
import java.nio.file.*;
import static org.mockito.Mockito.when;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** Explicit opt-in HTTP host for the real Java → engine acceptance suite; absent from the production JAR. */
@EnabledIfEnvironmentVariable(named="NEBU_AGENT_ACCEPTANCE",matches="1")
@ActiveProfiles("expert-local")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.DEFINED_PORT,properties={
 "server.port=42022","spring.datasource.url=jdbc:h2:mem:agentacceptance;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
 "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
 "nebu.seed-enabled=false","nebu.models.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
 "nebu.agent.base-url=http://host.docker.internal:42120","nebu.agent.signing-key=isolated-test-signing-key-32-characters",
 "nebu.agent.callback-key=isolated-test-business-key-32-characters","nebu.agent.namespace=acceptance-v2",
 "nebu.auth.allowed-origins=*","nebu.models.block-special-addresses=false"})
class AgentAcceptanceHostTest {
    @org.springframework.beans.factory.annotation.Autowired org.springframework.jdbc.core.JdbcTemplate jdbc;
    @org.springframework.beans.factory.annotation.Autowired cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher cipher;
    @MockBean AccountSessionStore sessions;
    @Test void serveIsolatedAcceptanceUntilExternalAssertionsFinish() throws Exception {
        AgentTestSettings.seed(jdbc,cipher,"http://host.docker.internal:42120","acceptance-v2","isolated-test-signing-key-32-characters","isolated-test-business-key-32-characters");
        jdbc.update("INSERT INTO nw_agent_engine_admin(owner_id) VALUES(?)","acceptance-user");
        when(sessions.findActor("acceptance-only-token")).thenReturn("acceptance-user");
        Path done=Paths.get("/work/.qa-agent-acceptance.done");long deadline=System.currentTimeMillis()+20*60*1000;
        while(!Files.exists(done)&&System.currentTimeMillis()<deadline)Thread.sleep(250);
        assertTrue(Files.exists(done),"External acceptance suite did not finish within 20 minutes");
    }
}
