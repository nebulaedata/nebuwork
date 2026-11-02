package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController @RequestMapping("/api/knowledge-mcp")
public class KnowledgeCreationController {
    private final KnowledgeCreationService service;
    public KnowledgeCreationController(KnowledgeCreationService service){this.service=service;}
    private String actor(HttpServletRequest r){return RequestIdentity.actor(r);}
    @GetMapping("/creation-templates") public Object available(HttpServletRequest r){return ok(service.templates(actor(r),null));}
    @GetMapping("/connections/{id}/creation-templates") public Object templates(@PathVariable String id,HttpServletRequest r){return ok(service.templates(actor(r),id));}
    @GetMapping("/creation-templates/{id}") public Object template(@PathVariable String id,HttpServletRequest r){return ok(service.templateDetail(actor(r),id));}
    @GetMapping("/connections/{id}/creation-resources") public Object resources(@PathVariable String id,HttpServletRequest r){return ok(service.resources(actor(r),id));}
    @PostMapping("/connections/{id}/creation-templates/validate") public Object validate(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return ok(service.validateTemplate(actor(r),id,body));}
    @PostMapping("/connections/{id}/creation-templates") public Object add(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return ok(service.saveTemplate(actor(r),id,null,body));}
    @PostMapping("/connections/{id}/creation-templates/{template}") public Object save(@PathVariable String id,@PathVariable String template,@RequestBody JsonNode body,HttpServletRequest r){return ok(service.saveTemplate(actor(r),id,template,body));}
    @PostMapping("/creation-jobs") public Object create(@RequestBody JsonNode body,HttpServletRequest r){return ok(service.submit(actor(r),body));}
    @GetMapping("/creation-jobs") public Object jobs(HttpServletRequest r){return ok(service.jobs(actor(r)));}
    @GetMapping("/creation-jobs/{id}") public Object job(@PathVariable String id,HttpServletRequest r){return ok(service.job(actor(r),id));}
    @PostMapping("/creation-jobs/{id}/confirm") public Object confirm(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return ok(service.confirm(actor(r),id,body));}
    @PostMapping("/creation-jobs/{id}/retry") public Object retry(@PathVariable String id,HttpServletRequest r){return ok(service.retry(actor(r),id,false));}
    @PostMapping("/creation-jobs/{id}/recover") public Object recover(@PathVariable String id,HttpServletRequest r){return ok(service.retry(actor(r),id,true));}
}
