package cn.nebulaedata.cccs.nebuwork.backend.api.platformmcp;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentRequests;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;
@RestController @RequestMapping("/api")
public class PlatformMcpController {
    private final PlatformMcpService service; private final AgentRequests requests;
    public PlatformMcpController(PlatformMcpService service,AgentRequests requests){this.service=service;this.requests=requests;}
    @GetMapping("/platform-mcp/catalog") public Object catalog(HttpServletRequest r){RequestIdentity.actor(r);return ok(service.catalog());}
    @GetMapping("/workbenches/{id}/platform-mcp-policy") public Object get(@PathVariable String id,HttpServletRequest r){return ok(service.policy(RequestIdentity.actor(r),id));}
    private Object write(String id,String action,JsonNode body,HttpServletRequest r){String owner=RequestIdentity.actor(r);service.ownedWorkbench(owner,id);String key=r.getHeader("Idempotency-Key");return ok(key==null?service.policyWrite(owner,id,action,body):requests.once(owner,"platform-mcp:"+id+":"+action,key,body,()->service.policyWrite(owner,id,action,body)));}
    @PostMapping("/workbenches/{id}/platform-mcp-policy") public Object save(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return write(id,"save",body,r);}
    @PostMapping("/workbenches/{id}/platform-mcp-policy/{action:publish|revoke}") public Object change(@PathVariable String id,@PathVariable String action,@RequestBody JsonNode body,HttpServletRequest r){return write(id,action,body,r);}
    @GetMapping("/platform-mcp/operations") public Object operations(@RequestParam(defaultValue="50")int limit,@RequestParam(defaultValue="0")int offset,HttpServletRequest r){return ok(service.operations(RequestIdentity.actor(r),limit,offset));}
    @GetMapping("/platform-mcp/operations/{id}") public Object operation(@PathVariable String id,HttpServletRequest r){return ok(service.userOperation(RequestIdentity.actor(r),id));}
}
