package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController
@RequestMapping("/api")
public class ModelProviderController {
    private final ModelProviderService service;
    public ModelProviderController(ModelProviderService service) { this.service=service; }
    @GetMapping("/model-providers") public Object list(HttpServletRequest r) { return ok(service.list(RequestIdentity.actor(r))); }
    @PostMapping("/model-providers") public Object create(@RequestBody JsonNode body,HttpServletRequest r) { return ok(service.create(RequestIdentity.actor(r),body)); }
    @PostMapping("/model-providers/models") public Object models(@RequestBody JsonNode body,HttpServletRequest r) { RequestIdentity.actor(r); return ok(service.discover(body)); }
    @PostMapping("/model-providers/test") public Object test(@RequestBody JsonNode body,HttpServletRequest r) { RequestIdentity.actor(r); return ok(service.testDraft(body)); }
    @PostMapping("/model-providers/{id}/test") public Object testSaved(@PathVariable String id,HttpServletRequest r) { return ok(service.testSaved(RequestIdentity.actor(r),id)); }
    @DeleteMapping("/model-providers/{id}") public Object delete(@PathVariable String id,HttpServletRequest r) { service.delete(RequestIdentity.actor(r),id); return ok(null); }
    @GetMapping("/model-settings") public Object settings(HttpServletRequest r) { return ok(service.settings(RequestIdentity.actor(r))); }
    // Browser saves use POST to match the deployed gateway's allowed methods; retain PATCH for existing clients.
    @RequestMapping(value="/model-settings",method={RequestMethod.POST,RequestMethod.PATCH})
    public Object settings(@RequestBody JsonNode body,HttpServletRequest r) { return ok(service.updateSettings(RequestIdentity.actor(r),body)); }
}
