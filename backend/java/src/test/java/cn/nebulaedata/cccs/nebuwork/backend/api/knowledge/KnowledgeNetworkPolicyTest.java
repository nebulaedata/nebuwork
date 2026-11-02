package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import java.net.InetAddress;
import java.net.URI;
import static org.junit.jupiter.api.Assertions.*;

/** Policy checks use numeric IP fixtures only; no DNS queries or servers. */
class KnowledgeNetworkPolicyTest {
    private MockEnvironment strictEnvironment(){return new MockEnvironment().withProperty("nebu.knowledge.internal-allowlist-enabled","true").withProperty("nebu.knowledge.block-special-addresses","true");}
    @Test void defaultAllowsAllResolvedDestinationsWithoutAnOriginList()throws Exception{
        KnowledgeNetworkPolicy policy=new KnowledgeNetworkPolicy(new MockEnvironment());
        for(String ip:new String[]{"198.18.0.57","198.19.0.57","127.0.0.1","192.168.1.100","100.64.0.1","169.254.169.254","fd00:ec2::254","::1"})assertDoesNotThrow(()->policy.validate(ENDPOINT,new InetAddress[]{InetAddress.getByName(ip)}),ip);
    }
    private static final String SWITCH="nebu.knowledge.internal-allowlist-enabled";
    private static final String ORIGINS="nebu.knowledge.allowed-internal-origins";
    private static final URI ENDPOINT=URI.create("http://knowledge.example:3001/mcp/common-knowledge");

    @Test void explicitEnabledRequiresTheExactInternalOrigin() throws Exception {
        MockEnvironment environment=strictEnvironment();
        KnowledgeNetworkPolicy policy=new KnowledgeNetworkPolicy(environment);
        InetAddress[] addresses={InetAddress.getByName("8.8.8.8"),InetAddress.getByName("192.168.1.100")};
        assertEquals(422,assertThrows(ApiException.class,()->policy.validate(ENDPOINT,addresses)).status);
        environment.setProperty(SWITCH,"true");
        environment.setProperty(ORIGINS,"http://knowledge.example:3002");
        assertEquals(422,assertThrows(ApiException.class,()->policy.validate(ENDPOINT,addresses)).status);
        environment.setProperty(ORIGINS,"https://knowledge.example:3001");
        assertEquals(422,assertThrows(ApiException.class,()->policy.validate(ENDPOINT,addresses)).status);
        environment.setProperty(ORIGINS,"http://knowledge.example:3001");
        assertDoesNotThrow(()->policy.validate(ENDPOINT,addresses));
    }

    @Test void disabledAllowsInternalHostsWithoutAnOriginList() throws Exception {
        MockEnvironment environment=strictEnvironment().withProperty(SWITCH,"false");
        KnowledgeNetworkPolicy policy=new KnowledgeNetworkPolicy(environment);
        for(String ip:new String[]{"127.0.0.1","10.0.0.1","172.16.0.1","192.168.1.100","100.64.0.1","::1","fd12::1"}) {
            InetAddress[] addresses={InetAddress.getByName(ip)};
            assertDoesNotThrow(()->policy.validate(ENDPOINT,addresses),ip);
        }
    }

    @Test void refreshedSwitchAffectsTheSamePolicyAndSkipsAnUnusedList() throws Exception {
        MockEnvironment environment=strictEnvironment();
        KnowledgeNetworkPolicy policy=new KnowledgeNetworkPolicy(environment);
        InetAddress[] addresses={InetAddress.getByName("127.0.0.1")};
        assertEquals(422,assertThrows(ApiException.class,()->policy.validate(ENDPOINT,addresses)).status);
        environment.setProperty(SWITCH,"false");
        environment.setProperty(ORIGINS,"*");
        assertDoesNotThrow(()->policy.validate(ENDPOINT,addresses));
        environment.setProperty(SWITCH,"true");
        assertEquals(503,assertThrows(ApiException.class,()->policy.validate(ENDPOINT,addresses)).status);
        environment.setProperty(ORIGINS,"");
        assertEquals(422,assertThrows(ApiException.class,()->policy.validate(ENDPOINT,addresses)).status);
        environment.setProperty(ORIGINS,"http://knowledge.example:3001");
        assertDoesNotThrow(()->policy.validate(ENDPOINT,addresses));
    }

    @Test void disablingTheAllowlistStillValidatesEveryIpAndBlocksSpecialAddresses() throws Exception {
        MockEnvironment environment=strictEnvironment().withProperty(SWITCH,"false");
        KnowledgeNetworkPolicy policy=new KnowledgeNetworkPolicy(environment);
        for(String ip:new String[]{"0.0.0.0","169.254.169.254","100.100.100.200","168.63.129.16","224.0.0.1","::","fe80::1","ff02::1","fd00:ec2::254","2002:7f00:1::"}) {
            InetAddress[] addresses={InetAddress.getByName("192.168.1.100"),InetAddress.getByName(ip)};
            assertEquals(422,assertThrows(ApiException.class,()->policy.validate(ENDPOINT,addresses),ip).status);
        }
        assertEquals(502,assertThrows(ApiException.class,()->policy.validate(ENDPOINT,new InetAddress[0])).status);
        assertEquals(422,assertThrows(ApiException.class,()->KnowledgeNetworkPolicy.endpoint("file:///private")).status);
    }

    @Test void malformedSwitchIsAConfigurationErrorAndDoesNotDisableTheCheck() throws Exception {
        MockEnvironment environment=strictEnvironment();
        KnowledgeNetworkPolicy policy=new KnowledgeNetworkPolicy(environment);
        InetAddress[] addresses={InetAddress.getByName("192.168.1.100")};
        for(String value:new String[]{"","off","0","flase"}) {
            environment.setProperty(SWITCH,value);
            ApiException error=assertThrows(ApiException.class,()->policy.validate(ENDPOINT,addresses));
            assertEquals(503,error.status);
            assertTrue(error.getMessage().contains("internal-allowlist-enabled"));
        }
    }
}
