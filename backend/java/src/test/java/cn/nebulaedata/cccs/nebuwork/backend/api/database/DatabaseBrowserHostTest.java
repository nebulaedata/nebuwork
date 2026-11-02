package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.AccountSessionStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import static org.mockito.Mockito.when;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Explicit opt-in local browser host; no shared business services or accounts are changed. */
@EnabledIfEnvironmentVariable(named="NEBU_DATABASE_BROWSER",matches="true")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.DEFINED_PORT,properties={"server.port=42140","server.address=127.0.0.1","server.servlet.context-path=/nwaa","spring.datasource.url=jdbc:h2:file:./target/database-browser/state;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=","spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false","nebu.seed-enabled=false","nebu.models.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.knowledge.encryption-key=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=","nebu.models.allowed-internal-origins=http://127.0.0.1:42142","nebu.databases.enabled=true","nebu.databases.allowed-targets=127.0.0.1:43316,127.0.0.1:43317,127.0.0.1:45436","nebu.auth.allowed-origins=http://127.0.0.1:5176"})
@ActiveProfiles("expert-local")
class DatabaseBrowserHostTest {
    @Autowired JdbcTemplate jdbc;@Autowired ObjectMapper json;@Autowired ModelSecretCipher cipher;
    @MockBean AccountSessionStore sessions;
    @Test void serveIsolatedDatabaseAcceptance()throws Exception{
        when(sessions.findActor("database-browser-token")).thenReturn("alice");
        jdbc.update("UPDATE nw_agent_engine_settings SET configured=TRUE,api_urls_json='[\"http://127.0.0.1:42141\"]',namespace='database-browser-test',signing_key_cipher=?,callback_key_cipher=?,cluster_id=NULL,storage_id=NULL WHERE id=1",cipher.encrypt("system-agent-engine","signing","isolated-test-signing-key-32-characters"),cipher.encrypt("system-agent-engine","callback","isolated-test-business-key-32-characters"));
        if(jdbc.queryForObject("SELECT COUNT(*) FROM nw_workbench WHERE id='qa-workbench'",Integer.class)==0){
            String config=json.writeValueAsString(map("bizName","数据库验收","domain","数据分析","bizDef","验证数据库资源的管理和使用","systemPrompt","基于真实数据分析","agentIds",Collections.emptyList(),"tplIds",Collections.emptyList(),"defaultAgentId",null));
            jdbc.update("INSERT INTO nw_workbench(id,owner_id,name,description,icon,color,create_request_key,create_request_hash) VALUES('qa-workbench','alice','数据库验收工作台','仅用于隔离验收','database','#6c63f0','qa-workbench-stable','hash')");
            jdbc.update("INSERT INTO nw_workbench_draft(workbench_id,definition_json) VALUES('qa-workbench',?)",config);
            jdbc.update("INSERT INTO nw_ontology_version(id,workbench_id,version_number,source_revision,snapshot_json,content_hash,published_by) VALUES('qa-publication','qa-workbench',1,1,?,'hash','alice')",json.writeValueAsString(map("config",json.readTree(config),"agents",Collections.emptyList(),"workbench",map("id","qa-workbench","name","数据库验收工作台"))));
            jdbc.update("UPDATE nw_workbench SET active_version_id='qa-publication' WHERE id='qa-workbench'");
            jdbc.update("INSERT INTO nw_project(id,owner_id,workbench_id,ontology_version_id,name,description,create_request_key,create_request_hash) VALUES('qa-project','alice','qa-workbench','qa-publication','数据分析验收项目','隔离测试库','qa-project-stable','hash')");
            jdbc.update("INSERT INTO nw_expert(id,name,role_label,tagline,model_name,initials,color) VALUES('qa-expert','数据库验收专家','数据分析','隔离测试专家','','数','#6c63f0')");
        }
        Path directory=Paths.get("target","database-browser");Files.createDirectories(directory);Files.deleteIfExists(directory.resolve("stop"));Files.write(directory.resolve("ready"),"http://127.0.0.1:42140/nwaa".getBytes(StandardCharsets.UTF_8));
        long deadline=System.currentTimeMillis()+30*60*1000;while(System.currentTimeMillis()<deadline&&!Files.exists(directory.resolve("stop")))Thread.sleep(250);
    }
}
