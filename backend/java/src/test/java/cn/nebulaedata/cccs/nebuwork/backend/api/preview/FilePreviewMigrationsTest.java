package cn.nebulaedata.cccs.nebuwork.backend.api.preview;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.exception.FlywayValidateException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class FilePreviewMigrationsTest {
    private static final String V27 = "V27__file_previews.sql";
    private static final String V28 = "V28__file_preview_account_lease.sql";
    private static final int DEPLOYED_V27_CHECKSUM = -259110397;

    @TempDir Path migrations;

    private DriverManagerDataSource database() {
        return new DriverManagerDataSource("jdbc:h2:mem:migration_" + UUID.randomUUID()
                + ";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1", "sa", "");
    }

    private Flyway flyway(DriverManagerDataSource dataSource) {
        return Flyway.configure().dataSource(dataSource)
                .locations("filesystem:" + migrations.toAbsolutePath()).load();
    }

    private void copy(String name) throws Exception {
        try (InputStream input = new ClassPathResource("db/migration/" + name).getInputStream()) {
            Files.copy(input, migrations.resolve(name));
        }
    }

    @Test void upgradesAnAppliedV27WithoutRepairOrChangingItsChecksum() throws Exception {
        copy(V27);
        DriverManagerDataSource dataSource = database();
        Flyway previous = flyway(dataSource);
        previous.migrate();
        assertEquals(DEPLOYED_V27_CHECKSUM, previous.info().current().getChecksum().intValue());

        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        jdbc.update("INSERT INTO nw_file_preview(id,owner_id,cache_key,source_json,metadata_json,status,created_at,expires_at)"
                + " VALUES('existing','alice','original','{}','{}','queued',1,9999999999999)");
        assertFalse(hasLeaseColumn(jdbc));

        // Reproduce the startup failure from the log before checking the fix.
        String original = new String(Files.readAllBytes(migrations.resolve(V27)), StandardCharsets.UTF_8);
        Files.write(migrations.resolve(V27), (original + "\n-- changed after deployment\n").getBytes(StandardCharsets.UTF_8));
        assertThrows(FlywayValidateException.class, () -> flyway(dataSource).validate());
        Files.write(migrations.resolve(V27), original.getBytes(StandardCharsets.UTF_8));

        copy(V28);
        Flyway upgraded = flyway(dataSource);
        assertEquals(1, upgraded.migrate().migrationsExecuted);
        upgraded.validate();
        assertEquals("28", upgraded.info().current().getVersion().getVersion());
        assertEquals(DEPLOYED_V27_CHECKSUM,
                jdbc.queryForObject("SELECT checksum FROM flyway_schema_history WHERE version='27'", Integer.class).intValue());
        assertEquals("queued", jdbc.queryForObject("SELECT status FROM nw_file_preview WHERE id='existing'", String.class));
        assertTrue(hasLeaseColumn(jdbc));
        assertEquals(0, flyway(dataSource).migrate().migrationsExecuted);
        assertAccountLeaseIsUnique(jdbc);
    }

    @Test void initializesFreshDatabasesWithTheSameAccountLeaseConstraint() throws Exception {
        copy(V27);
        copy(V28);
        DriverManagerDataSource dataSource = database();
        Flyway fresh = flyway(dataSource);
        assertEquals(2, fresh.migrate().migrationsExecuted);
        fresh.validate();
        JdbcTemplate jdbc = new JdbcTemplate(dataSource);
        assertTrue(hasLeaseColumn(jdbc));
        assertAccountLeaseIsUnique(jdbc);
    }

    private boolean hasLeaseColumn(JdbcTemplate jdbc) {
        return jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.columns"
                + " WHERE table_name='nw_file_preview' AND column_name='active_owner'", Integer.class) == 1;
    }

    private void assertAccountLeaseIsUnique(JdbcTemplate jdbc) {
        String insert = "INSERT INTO nw_file_preview(id,owner_id,cache_key,source_json,metadata_json,status,active_owner,created_at,expires_at)"
                + " VALUES(?,?,?,'{}','{}','reading',?,1,9999999999999)";
        jdbc.update(insert, "lease-1", "alice", "lease-key-1", "alice");
        assertThrows(org.springframework.dao.DuplicateKeyException.class,
                () -> jdbc.update(insert, "lease-2", "alice", "lease-key-2", "alice"));
        jdbc.update(insert, "lease-bob", "bob", "lease-key-bob", "bob");
    }
}
