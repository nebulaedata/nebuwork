package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import org.springframework.boot.autoconfigure.flyway.FlywayMigrationStrategy;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import java.sql.Connection;

@Configuration
@Profile("!expert-local")
public class ModelDatabaseConfiguration {
    @Bean
    public FlywayMigrationStrategy nebuworkDatabaseMigration() {
        return flyway -> {
            try (Connection connection = flyway.getConfiguration().getDataSource().getConnection()) {
                if (!"nebuwork_1".equals(connection.getCatalog())) {
                    throw new IllegalStateException("NebuWork 数据源必须指向 nebuwork_1，已停止数据库迁移");
                }
                String schema = flyway.getConfiguration().getDefaultSchema();
                if (schema != null && !"nebuwork_1".equals(schema)) {
                    throw new IllegalStateException("Flyway 默认库必须为 nebuwork_1");
                }
                for (String target : flyway.getConfiguration().getSchemas()) {
                    if (!"nebuwork_1".equals(target)) throw new IllegalStateException("禁止跨库迁移");
                }
            } catch (java.sql.SQLException e) {
                throw new IllegalStateException("无法确认 NebuWork 数据库，已停止迁移");
            }
            flyway.migrate();
        };
    }
}
