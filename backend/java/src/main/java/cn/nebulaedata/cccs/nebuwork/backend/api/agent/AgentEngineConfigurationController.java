package cn.nebulaedata.cccs.nebuwork.backend.api.agent;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController
@RequestMapping("/api/agent-engine/settings")
public class AgentEngineConfigurationController {
    private final AgentEngineConfiguration settings;
    public AgentEngineConfigurationController(AgentEngineConfiguration settings){this.settings=settings;}
    @GetMapping public Object read(HttpServletRequest r){return ok(settings.read(RequestIdentity.actor(r)));}
    @PostMapping public Object save(@RequestBody JsonNode body,@RequestHeader("Idempotency-Key")String key,HttpServletRequest r){return ok(settings.save(RequestIdentity.actor(r),body,key));}
    @PostMapping("/test") public Object test(@RequestBody JsonNode body,HttpServletRequest r){return ok(settings.test(RequestIdentity.actor(r),body));}
    @GetMapping("/status") public Object status(HttpServletRequest r){return ok(settings.status(RequestIdentity.actor(r)));}
}
