package cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.workbench.WorkbenchMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.transaction.PlatformTransactionManager;
import javax.servlet.FilterChain;
import java.nio.charset.StandardCharsets;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class ServiceCorsFilterTest {
    final ObjectMapper json=new ObjectMapper();
    ServiceCorsFilter filter(String base){return new ServiceCorsFilter(new ServiceAccess(mock(AgentStore.class),json,mock(WorkbenchMapper.class),mock(PlatformTransactionManager.class),base));}
    MockHttpServletRequest request(String origin){MockHttpServletRequest r=new MockHttpServletRequest("POST","/nwaa/api/workbench-services/wb/pages/report/instances");r.setContextPath("/nwaa");if(origin!=null)r.addHeader("Origin",origin);return r;}
    @Test void missingPublicAddressReportsConfigurationRatherThanAnUnregisteredOrigin()throws Exception{
        MockHttpServletResponse response=new MockHttpServletResponse();FilterChain chain=mock(FilterChain.class);
        filter("").doFilter(request("http://localhost:5173"),response,chain);
        assertEquals(503,response.getStatus());assertEquals("UTF-8",response.getCharacterEncoding());
        assertEquals("请配置工作台服务公开访问地址",json.readTree(response.getContentAsByteArray()).path("msg").asText());
        assertEquals("no-store",response.getHeader("Cache-Control"));verifyNoInteractions(chain);
    }
    @Test void unregisteredOriginsRemainForbiddenWithReadableUtf8Errors()throws Exception{
        MockHttpServletResponse response=new MockHttpServletResponse();FilterChain chain=mock(FilterChain.class);
        filter("http://localhost:5173/nebulaedev/nwaa").doFilter(request("https://unregistered.example"),response,chain);
        assertEquals(403,response.getStatus());assertEquals("UTF-8",response.getCharacterEncoding());
        assertEquals("来源未登记",json.readTree(response.getContentAsByteArray()).path("msg").asText());
        assertTrue(response.getContentAsString(StandardCharsets.UTF_8).contains("来源未登记"));
        assertNull(response.getHeader("Access-Control-Allow-Origin"));verifyNoInteractions(chain);
    }
    @Test void theConfiguredPublicOriginContinuesThroughSessionAuthentication()throws Exception{
        MockHttpServletRequest request=request("http://localhost:5173");MockHttpServletResponse response=new MockHttpServletResponse();FilterChain chain=mock(FilterChain.class);
        filter("http://localhost:5173/nebulaedev/nwaa").doFilter(request,response,chain);
        verify(chain).doFilter(request,response);assertEquals("http://localhost:5173",response.getHeader("Access-Control-Allow-Origin"));
        assertNull(response.getHeader("Access-Control-Allow-Credentials"));
    }
    @Test void originlessRequestsAndPublicMetadataStillReachTheirExistingHandlers()throws Exception{
        MockHttpServletRequest request=request(null);MockHttpServletResponse response=new MockHttpServletResponse();FilterChain chain=mock(FilterChain.class);
        filter("").doFilter(request,response,chain);verify(chain).doFilter(request,response);
        MockHttpServletRequest metadata=new MockHttpServletRequest("GET","/nwaa/api/workbench-services/wb/oauth-protected-resource");metadata.setContextPath("/nwaa");metadata.addHeader("Origin","https://client.example");
        response=new MockHttpServletResponse();filter("").doFilter(metadata,response,chain);verify(chain).doFilter(metadata,response);
        assertEquals("*",response.getHeader("Access-Control-Allow-Origin"));
    }
}
