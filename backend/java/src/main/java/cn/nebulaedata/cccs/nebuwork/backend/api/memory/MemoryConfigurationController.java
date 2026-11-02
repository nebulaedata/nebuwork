package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController
@RequestMapping("/api/memory/settings")
public class MemoryConfigurationController {
    private final MemoryConfigurationService service;
    public MemoryConfigurationController(MemoryConfigurationService service) { this.service=service; }
    @GetMapping public Object read(HttpServletRequest r) { return ok(service.read(RequestIdentity.actor(r))); }
    @PostMapping public Object save(@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r) {
        return ok(service.save(RequestIdentity.actor(r),body,key));
    }
    @PostMapping("/test") public Object test(@RequestBody JsonNode body,HttpServletRequest r) {
        return ok(service.test(RequestIdentity.actor(r),body));
    }
}
