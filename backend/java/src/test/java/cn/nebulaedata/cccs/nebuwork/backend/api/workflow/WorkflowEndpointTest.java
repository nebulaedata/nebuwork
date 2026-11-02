package cn.nebulaedata.cccs.nebuwork.backend.api.workflow;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class WorkflowEndpointTest {
    @Test void configuredServicesCanUseLanLocalAndProxyAddresses(){for(String host:new String[]{"127.0.0.1","192.168.1.2","198.18.0.57","169.254.169.254","::1"})assertDoesNotThrow(()->WorkflowEndpoint.resolve(host),host);}
}
