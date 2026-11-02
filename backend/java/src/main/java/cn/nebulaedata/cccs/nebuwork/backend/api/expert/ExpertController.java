package cn.nebulaedata.cccs.nebuwork.backend.api.expert;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import javax.servlet.http.HttpServletResponse;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import javax.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import java.util.Map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController
@RequestMapping("/api")
public class ExpertController {
    private final ExpertService service;
    private final ExpertAbilityService ability;
    public ExpertController(ExpertService service,ExpertAbilityService ability) { this.service=service;this.ability=ability; }
    @GetMapping("/agents") public Object list(HttpServletRequest r) { return ok(service.list(RequestIdentity.actor(r))); }
    @PostMapping("/agents") public Object create(@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.create(p,RequestIdentity.actor(r))); }
    @PostMapping("/agents/ability-completion") public Object completeAbility(@RequestBody JsonNode p,HttpServletRequest r) { return ok(ability.complete(p,RequestIdentity.actor(r))); }
    @GetMapping("/agents/{expert}") public Object detail(@PathVariable String expert,@RequestParam(defaultValue="0") int taskOffset,HttpServletRequest r) { if(taskOffset<0)throw new cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException(422,"任务分页位置无效");return ok(service.detail(expert,RequestIdentity.actor(r),taskOffset)); }
    @PostMapping("/agents/{expert}") public Object update(@PathVariable String expert,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.update(expert,p,RequestIdentity.actor(r))); }
    @DeleteMapping("/agents/{expert}") public Object remove(@PathVariable String expert,@RequestParam long revision,@RequestParam long membershipRevision,HttpServletRequest r) {
        return ok(service.remove(expert,revision,membershipRevision,RequestIdentity.actor(r)));
    }

    @GetMapping("/agents/{expert}/sop-sets") public Object sops(@PathVariable String expert,HttpServletRequest r) { service.assertVisible(expert,RequestIdentity.actor(r));return ok(service.sops(expert,RequestIdentity.actor(r))); }
    @PostMapping("/agents/{expert}/sop-sets") public Object createSop(@PathVariable String expert,@RequestBody JsonNode p,@RequestHeader(value="Idempotency-Key",required=false) String key,HttpServletRequest r) {
        String actor=RequestIdentity.actor(r);return ok("workflow".equals(p.path("kind").asText())?service.createWorkflowSop(expert,p,actor,key):service.createSop(expert,p,actor));
    }
    @PostMapping("/agents/{expert}/sop-sets/{sop}/workflow") public Object createWorkflow(@PathVariable String expert,@PathVariable String sop,@RequestBody JsonNode p,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r) { return ok(service.createSopWorkflow(expert,sop,p,RequestIdentity.actor(r),key)); }
    // POST supports browser saves through the gateway; PATCH remains compatible for existing clients.
    @RequestMapping(value="/agents/{expert}/sop-sets/{sop}",method={RequestMethod.POST,RequestMethod.PATCH}) public Object updateSop(@PathVariable String expert,@PathVariable String sop,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.updateSop(expert,sop,p,RequestIdentity.actor(r))); }
    @DeleteMapping("/agents/{expert}/sop-sets/{sop}") public Object deleteSop(@PathVariable String expert,@PathVariable String sop,@RequestParam long revision,HttpServletRequest r) { service.deleteSop(expert,sop,revision,RequestIdentity.actor(r)); return ok(null); }

    @GetMapping("/agents/{expert}/rule-sets") public Object ruleSets(@PathVariable String expert,HttpServletRequest r) { service.assertVisible(expert,RequestIdentity.actor(r));return ok(service.ruleSets(expert)); }
    @PostMapping("/agents/{expert}/rule-sets") public Object createRuleSet(@PathVariable String expert,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.createRuleSet(expert,p,RequestIdentity.actor(r))); }
    @GetMapping("/agents/{expert}/rules") public Object rules(@PathVariable String expert,HttpServletRequest r) { service.assertVisible(expert,RequestIdentity.actor(r));return ok(service.rules(expert)); }
    @PostMapping("/agents/{expert}/rules") public Object createRule(@PathVariable String expert,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.saveRule(expert,null,p,RequestIdentity.actor(r))); }
    @RequestMapping(value="/agents/{expert}/rules/{rule}",method={RequestMethod.POST,RequestMethod.PATCH}) public Object updateRule(@PathVariable String expert,@PathVariable String rule,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.saveRule(expert,rule,p,RequestIdentity.actor(r))); }
    @DeleteMapping("/agents/{expert}/rules/{rule}") public Object deleteRule(@PathVariable String expert,@PathVariable String rule,@RequestParam long revision,HttpServletRequest r) { service.deleteRule(expert,rule,revision,RequestIdentity.actor(r)); return ok(null); }

    @GetMapping("/plaza/extensions") public Object extensions() { return ok(service.extensions()); }
    @GetMapping("/plaza/templates") public Object templates() { return ok(service.templates()); }
    @GetMapping("/plaza/agents") public Object marketExperts(HttpServletRequest r) { return ok(service.marketExperts(RequestIdentity.actor(r))); }
    @PostMapping("/plaza/agents/{market}/hire") public Object hire(@PathVariable String market,HttpServletRequest r) { return ok(service.hire(market,RequestIdentity.actor(r))); }
    @PutMapping("/agents/{expert}/extensions/{target}") public Object bindExt(@PathVariable String expert,@PathVariable String target,HttpServletRequest r) { return ok(service.binding(expert,target,true,true,RequestIdentity.actor(r))); }
    @DeleteMapping("/agents/{expert}/extensions/{target}") public Object unbindExt(@PathVariable String expert,@PathVariable String target,HttpServletRequest r) { return ok(service.binding(expert,target,true,false,RequestIdentity.actor(r))); }
    @PutMapping("/agents/{expert}/tpls/{target}") public Object bindTpl(@PathVariable String expert,@PathVariable String target,HttpServletRequest r) { return ok(service.binding(expert,target,false,true,RequestIdentity.actor(r))); }
    @DeleteMapping("/agents/{expert}/tpls/{target}") public Object unbindTpl(@PathVariable String expert,@PathVariable String target,HttpServletRequest r) { return ok(service.binding(expert,target,false,false,RequestIdentity.actor(r))); }

    @PostMapping("/agents/{expert}/sop-sets/{sop}/materials")
    public Object upload(@PathVariable String expert,@PathVariable String sop,@RequestParam long revision,@RequestParam MultipartFile file,HttpServletRequest r) throws IOException {
        return ok(service.upload(expert,sop,revision,file,RequestIdentity.actor(r)));
    }
    @DeleteMapping("/agents/{expert}/sop-sets/{sop}/materials/{material}")
    public Object removeMaterial(@PathVariable String expert,@PathVariable String sop,@PathVariable String material,@RequestParam long revision,HttpServletRequest r) {
        return ok(service.removeMaterial(expert,sop,material,revision,RequestIdentity.actor(r)));
    }
    @GetMapping("/agents/{expert}/sop-sets/{sop}/materials/{material}/content")
    public void download(@PathVariable String expert,@PathVariable String sop,@PathVariable String material,HttpServletRequest r,HttpServletResponse response)throws IOException {
        service.download(expert,sop,material,RequestIdentity.actor(r),response,r.getHeader("Range"),r.getHeader("If-None-Match"));
    }
}
