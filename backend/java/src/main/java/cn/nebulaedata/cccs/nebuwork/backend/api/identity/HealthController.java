package cn.nebulaedata.cccs.nebuwork.backend.api.identity;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.*;

@RestController
public class HealthController {
    @GetMapping("/api/health")
    public Map<String,Object> health() {
        return ok(map("service", "nebuwork-backend-api", "expertManagement", true, "executionAvailable", false));
    }
}
