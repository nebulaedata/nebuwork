package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.configuration.Configuration;
import org.junit.jupiter.api.Test;
import javax.sql.DataSource;
import java.sql.Connection;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ModelDatabaseConfigurationTest {
    @Test void refusesOtherDatabasesBeforeMigration() throws Exception {
        Flyway flyway=mock(Flyway.class); Configuration config=mock(Configuration.class);
        DataSource source=mock(DataSource.class); Connection connection=mock(Connection.class);
        when(flyway.getConfiguration()).thenReturn(config); when(config.getDataSource()).thenReturn(source);
        when(source.getConnection()).thenReturn(connection); when(connection.getCatalog()).thenReturn("user_service");
        assertThrows(IllegalStateException.class,()->new ModelDatabaseConfiguration().nebuworkDatabaseMigration().migrate(flyway));
        verify(flyway,never()).migrate();
        when(connection.getCatalog()).thenReturn("nebuwork_1"); when(config.getSchemas()).thenReturn(new String[]{"user_service"});
        assertThrows(IllegalStateException.class,()->new ModelDatabaseConfiguration().nebuworkDatabaseMigration().migrate(flyway));
        verify(flyway,never()).migrate();
        when(config.getSchemas()).thenReturn(new String[0]);
        new ModelDatabaseConfiguration().nebuworkDatabaseMigration().migrate(flyway);
        verify(flyway).migrate();
    }
}
