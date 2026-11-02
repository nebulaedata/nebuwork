package cn.nebulaedata.cccs.nebuwork.backend.api.platformmcp;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
@RestController
public class PlatformMcpInternalController {
    private final PlatformMcpService service;
    public PlatformMcpInternalController(PlatformMcpService service){this.service=service;}
    @PostMapping("/internal/agent/platform-mcp/grants") public Object grant(@RequestBody JsonNode body){return service.grant(body);}
    @PostMapping("/internal/agent/platform-mcp/reconcile") public Object reconcileAgent(@RequestBody JsonNode body){return service.reconcileAgent(body);}
    @PostMapping("/internal/agent/platform-mcp/authorize") public Object authorizeAgent(@RequestBody JsonNode body){return service.authorizeAgent(body);}
    private PlatformMcpService.Context context(HttpServletRequest r){String expected="Bearer "+service.serviceKey,provided=r.getHeader("Authorization");if(service.serviceKey.length()<32||provided==null||!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),provided.getBytes(StandardCharsets.UTF_8)))throw new ApiException(401,"需要系统 MCP 服务身份");return service.authenticate(r.getHeader("X-Platform-Mcp-Grant"));}
    @PostMapping("/internal/platform-mcp/context") public Object catalog(HttpServletRequest r){return service.connection(context(r));}
    @PostMapping("/internal/platform-mcp/execute") public Object execute(@RequestBody JsonNode body,HttpServletRequest r){PlatformMcpService.Context c=context(r);return service.execute(c,body.path("name").asText(),body.path("arguments"),body.path("callId").asText());}
    @PostMapping("/internal/platform-mcp/reconcile") public Object reconcile(@RequestBody JsonNode body,HttpServletRequest r){return service.reconcileCall(context(r),body.path("callId").asText(),body.path("name").asText());}
    @PostMapping("/internal/platform-mcp/resources/read") public Object read(@RequestBody JsonNode body,HttpServletRequest r){PlatformMcpService.Context c=context(r);c.requireTool("nw_resource_read");return service.dispatch.readResource(c,body.path("uri").asText(),body);}
}
