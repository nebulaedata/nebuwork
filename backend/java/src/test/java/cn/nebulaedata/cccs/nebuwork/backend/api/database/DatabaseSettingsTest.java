package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import static org.junit.jupiter.api.Assertions.*;

class DatabaseSettingsTest {
    final MockEnvironment env = new MockEnvironment().withProperty("nebu.databases.target-allowlist-enabled","true").withProperty("nebu.databases.block-special-addresses","true");
    final DatabaseSettings settings = new DatabaseSettings(env);

    @Test void defaultAllowsResolvedDestinationsWithoutTargetList(){DatabaseSettings open=new DatabaseSettings(new MockEnvironment());for(String host:new String[]{"127.0.0.1","192.168.1.2","198.18.0.57","169.254.169.254"})assertDoesNotThrow(()->open.target(host,3306),host);}

    void allowed(String value) { env.setProperty("nebu.databases.allowed-targets", value); }
    void rejected(String host, int port, int status) {
        assertEquals(status, assertThrows(ApiException.class, () -> settings.target(host, port)).status);
    }

    @Test void emptyConfigurationDeniesExternalTargets() {
        rejected("127.0.0.1", 3306, 403);
        allowed(" , ");
        rejected("127.0.0.1", 3306, 403);
    }

    @Test void exactEntriesKeepTheirHostAndPortBoundaries() {
        allowed(" LOCALHOST:3306 , 127.0.0.1:5432 ");
        assertDoesNotThrow(() -> settings.target("localhost", 3306));
        assertDoesNotThrow(() -> settings.target("127.0.0.1", 5432));
        rejected("localhost", 5432, 403);
        rejected("127.0.0.2", 5432, 403);
    }

    @Test void standaloneWildcardAllowsAnyValidHostAndPort() {
        allowed("*");
        assertDoesNotThrow(() -> settings.target("127.0.0.1", 1));
        assertDoesNotThrow(() -> settings.target("192.168.204.128", 3306));
        assertDoesNotThrow(() -> settings.target("10.20.30.40", 65535));
    }

    @Test void wildcardCanBeMixedWithExactEntriesAndRemovedDynamically() {
        allowed(" 127.0.0.1:3306 , * , ");
        assertDoesNotThrow(() -> settings.target("127.0.0.1", 5432));
        allowed("127.0.0.1:3306");
        rejected("127.0.0.1", 5432, 403);
    }

    @Test void wildcardStillValidatesHostAndPortFormat() {
        allowed("*");
        rejected(null, 3306, 422);
        rejected("jdbc:mysql://127.0.0.1", 3306, 422);
        rejected("db..internal", 3306, 422);
        rejected("127.0.0.1", 0, 422);
        rejected("127.0.0.1", 65536, 422);
    }

    @Test void wildcardStillRejectsUnspecifiedMulticastAndLinkLocalAddresses() {
        allowed("*");
        rejected("0.0.0.0", 3306, 403);
        rejected("224.0.0.1", 3306, 403);
        rejected("169.254.169.254", 3306, 403);
    }
}
