package cn.nebulaedata.cccs.nebuwork.backend.api.identity;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.config.YamlPropertiesFactoryBean;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.core.io.FileSystemResource;
import org.springframework.test.context.ActiveProfiles;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

/** Reads Nacos configuration only: no business beans, datasource, workers or registration. */
@EnabledIfEnvironmentVariable(named="NEBU_NACOS_ACCEPTANCE", matches="1")
@SpringBootTest(classes=NacosConfigurationAcceptanceTest.Probe.class,
    webEnvironment=SpringBootTest.WebEnvironment.NONE)
@ActiveProfiles("dev")
class NacosConfigurationAcceptanceTest {
    @Configuration
    static class Probe { }
    @Autowired Environment environment;

    @Test void loadsTheOriginalDatabaseAndComponentValuesFromTheNewNamespace() throws Exception {
        Properties expected=new Properties();
        for(String name:Arrays.asList("cccs-database-base-dev.yml","cccs-config-base-dev.yml","nebuwork-backend-api-dev.yml")) {
            YamlPropertiesFactoryBean yaml=new YamlPropertiesFactoryBean();
            yaml.setResources(new FileSystemResource(".qa/nacos-source/"+name));
            expected.putAll(Objects.requireNonNull(yaml.getObject()));
        }
        List<String> checked=new ArrayList<>();
        for(String key:expected.stringPropertyNames()) {
            if(!(key.startsWith("spring.datasource.")||key.startsWith("spring.redis.")||key.startsWith("nebu.")))continue;
            String value=environment.resolvePlaceholders(expected.getProperty(key));
            assertTrue(Objects.equals(value,environment.getProperty(key)),"Nacos property differs from its original configuration: "+key);
            checked.add(key);
        }
        assertTrue(checked.contains("spring.datasource.url"),"The database URL must come from Nacos");
        assertTrue(checked.contains("spring.redis.host"),"Unified login Redis must come from Nacos");
        assertEquals("nebuwork-dev",environment.getProperty("spring.cloud.nacos.config.namespace"));
        Map<String,Object> report=new LinkedHashMap<>();
        report.put("namespace","nebuwork-dev");
        report.put("verifiedPropertyCount",checked.size());
        report.put("databaseAndComponentValuesUnchanged",true);
        report.put("businessDatabaseConnected",false);
        report.put("businessWorkersStarted",false);
        Files.write(Paths.get("target/nacos-config-verification.json"),new ObjectMapper().writerWithDefaultPrettyPrinter().writeValueAsBytes(report));
    }
}
