package cn.nebulaedata.cccs.nebuwork.backend.api.agent;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
@RestController @RequestMapping("/internal/agent")
public class AgentBridgeController {
    private final AgentBridge bridge;
    public AgentBridgeController(AgentBridge bridge){this.bridge=bridge;}
    @PostMapping("/context") public Object context(@RequestBody JsonNode body){return bridge.context(body);}
    @PostMapping("/credentials") public Object credentials(@RequestBody JsonNode body){return bridge.credentials(body);}
    @PostMapping("/authorize") public Object authorize(@RequestBody JsonNode body){return bridge.authorize(body);}
    @PostMapping("/tools/execute") public Object execute(@RequestBody JsonNode body){return bridge.execute(body);}
    @PostMapping("/tools/reconcile") public Object reconcile(@RequestBody JsonNode body){return bridge.reconcile(body);}
}
