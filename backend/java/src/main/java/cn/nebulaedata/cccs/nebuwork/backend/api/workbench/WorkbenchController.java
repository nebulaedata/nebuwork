package cn.nebulaedata.cccs.nebuwork.backend.api.workbench;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentTasks;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentUsage;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import java.util.Map;
import javax.servlet.http.HttpServletRequest;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController
@RequestMapping("/api")
public class WorkbenchController {
    private final WorkbenchService service;
    private final AgentTasks tasks;
    private final AgentUsage usage;
    public WorkbenchController(WorkbenchService service,AgentTasks tasks,AgentUsage usage) { this.service=service;this.tasks=tasks;this.usage=usage; }
    private String actor(HttpServletRequest r) { return RequestIdentity.actor(r); }
    @GetMapping("/workbenches") public Object list(HttpServletRequest r) { java.util.List<Map<String,Object>> rows=service.list(actor(r));usage.workbenches(actor(r),rows);return ok(rows); }
    @PostMapping("/workbenches") public Object create(@RequestBody JsonNode p,@RequestHeader(value="Idempotency-Key",required=false) String key,HttpServletRequest r) { return ok(service.create(actor(r),p,key)); }
    @GetMapping("/workbenches/{id}") public Object get(@PathVariable String id,HttpServletRequest r) { Map<String,Object> row=service.get(actor(r),id);usage.workbenches(actor(r),java.util.Collections.singletonList(row));return ok(row); }
    @PostMapping("/workbenches/{id}") public Object update(@PathVariable String id,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.update(actor(r),id,p)); }
    @DeleteMapping("/workbenches/{id}") public Object delete(@PathVariable String id,@RequestParam long revision,HttpServletRequest r) { service.delete(actor(r),id,revision); return ok(null); }
    @GetMapping("/workbenches/{id}/config") public Object config(@PathVariable String id,HttpServletRequest r) { return ok(service.config(actor(r),id)); }
    @PostMapping("/workbenches/{id}/config") public Object config(@PathVariable String id,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.saveConfig(actor(r),id,p)); }
    @PostMapping("/workbenches/{id}/bindings/{kind}/{target}") public Object binding(@PathVariable String id,@PathVariable String kind,@PathVariable String target,@RequestBody JsonNode body,HttpServletRequest r) { return ok(service.bind(actor(r),id,kind,target,body.path("enabled").asBoolean(),body.path("revision").asLong(-1))); }
    @PostMapping("/workbenches/{id}/delete") public Object remove(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r) { service.delete(actor(r),id,body.path("revision").asLong(-1));return ok(null); }
    @PutMapping("/workbenches/{id}/bindings/{kind}/{target}") public Object bind(@PathVariable String id,@PathVariable String kind,@PathVariable String target,@RequestParam long revision,HttpServletRequest r) { return ok(service.bind(actor(r),id,kind,target,true,revision)); }
    @DeleteMapping("/workbenches/{id}/bindings/{kind}/{target}") public Object unbind(@PathVariable String id,@PathVariable String kind,@PathVariable String target,@RequestParam long revision,HttpServletRequest r) { return ok(service.bind(actor(r),id,kind,target,false,revision)); }
    @PostMapping("/workbenches/{id}/publish") public Object publish(@PathVariable String id,@RequestBody JsonNode p,HttpServletRequest r) {
        Map<String,Object> result=service.publish(actor(r),id,p);
        return ok(result);
    }
    @GetMapping("/workbenches/{id}/versions") public Object versions(@PathVariable String id,HttpServletRequest r) { return ok(service.versions(actor(r),id)); }
    @GetMapping("/workbenches/{id}/versions/{version}") public Object version(@PathVariable String id,@PathVariable String version,HttpServletRequest r) { return ok(service.version(actor(r),id,version)); }
    @GetMapping("/projects") public Object projects(@RequestParam(required=false) String workbenchId,HttpServletRequest r) { java.util.List<Map<String,Object>> result=service.projects(actor(r),workbenchId);usage.projects(actor(r),result);return ok(result); }
    @PostMapping("/projects") public Object createProject(@RequestBody JsonNode p,@RequestHeader(value="Idempotency-Key",required=false) String key,HttpServletRequest r) {
        return ok(service.createProject(actor(r),p,key));
    }
    @GetMapping("/projects/{id}") public Object project(@PathVariable String id,HttpServletRequest r) { Map<String,Object> detail=service.project(actor(r),id);JsonNode data=usage.load(actor(r),id);java.util.List<Map<String,Object>> list=usage.tasks(actor(r),data,id);detail.put("sessions",list);((Map<String,Object>)detail.get("project")).put("stats",usage.projectStats(data,id,list));detail.put("usage",usage.projectUsage(data,id));detail.put("files",tasks.artifacts(actor(r),id).path("items"));return ok(detail); }
    @PostMapping("/projects/{id}") public Object project(@PathVariable String id,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.updateProject(actor(r),id,p)); }
}
