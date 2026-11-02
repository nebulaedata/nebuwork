package cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
@RestController
public class ServiceProtocolController {
    private final ServiceProtocol protocol;
    public ServiceProtocolController(ServiceProtocol protocol){this.protocol=protocol;}
    @PostMapping("/internal/workbench-services/protocol") public Object execute(@RequestHeader("Authorization")String authorization,@RequestHeader("X-Service-Token")String token,@RequestBody JsonNode body){protocol.authenticate(authorization);return protocol.execute(token,body);}
}
