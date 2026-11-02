package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import org.junit.jupiter.api.Test;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import java.util.UUID;
import static org.junit.jupiter.api.Assertions.*;

/** Exercises manual import followed by Flyway replay without a real MySQL or Hindsight service. */
class MemoryMigrationIdempotencyTest {
    @Test void replayPreservesMemoryDataAndExistingConfiguration() {
        DriverManagerDataSource ds=new DriverManagerDataSource("jdbc:h2:mem:memoryReplay"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1","sa","");
        JdbcTemplate jdbc=new JdbcTemplate(ds);
        ResourceDatabasePopulator v12=new ResourceDatabasePopulator(new ClassPathResource("db/migration/V12__unified_memory.sql"));
        ResourceDatabasePopulator v13=new ResourceDatabasePopulator(new ClassPathResource("db/migration/V13__memory_settings.sql"));
        try {
            v12.execute(ds);v13.execute(ds);
            jdbc.update("INSERT INTO nw_memory_scope(id,owner_id,kind,object_id,bank_id) VALUES('scope','alice','task','task-one','bank-one')");
            jdbc.update("INSERT INTO nw_memory_entry(id,scope_id,title,content_md,source_json,state,document_id,revision) VALUES('entry','scope','Saved memory','Keep this content','{}','active','document-one',7)");
            jdbc.update("UPDATE nw_memory_settings SET configured=TRUE,enabled=TRUE,base_url='http://saved-host:8888',api_key_cipher='opaque-ciphertext',recall_max_tokens=1500,revision=4,updated_by='alice' WHERE id=1");
            jdbc.update("INSERT INTO nw_memory_settings_audit(revision,actor,settings_json,credential_action) VALUES(4,'alice','{}','replace')");
            java.util.Map<String,Object> settingsBefore=jdbc.queryForMap("SELECT * FROM nw_memory_settings WHERE id=1");
            java.util.Map<String,Object> memoryBefore=jdbc.queryForMap("SELECT * FROM nw_memory_entry WHERE id='entry'");
            v12.execute(ds);v13.execute(ds);v12.execute(ds);v13.execute(ds);
            assertEquals(settingsBefore,jdbc.queryForMap("SELECT * FROM nw_memory_settings WHERE id=1"));
            assertEquals(memoryBefore,jdbc.queryForMap("SELECT * FROM nw_memory_entry WHERE id='entry'"));
            assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM nw_memory_settings",Integer.class).intValue());
            assertEquals(1,jdbc.queryForObject("SELECT COUNT(*) FROM nw_memory_settings_audit",Integer.class).intValue());
            // MySQL DDL failure may leave earlier CREATEs committed. Replaying fills a missing table.
            jdbc.execute("DROP TABLE nw_memory_request");
            v12.execute(ds);
            assertEquals(0,jdbc.queryForObject("SELECT COUNT(*) FROM nw_memory_request",Integer.class).intValue());
            assertEquals(memoryBefore,jdbc.queryForMap("SELECT * FROM nw_memory_entry WHERE id='entry'"));
        } finally {jdbc.execute("DROP ALL OBJECTS");}
    }
}
