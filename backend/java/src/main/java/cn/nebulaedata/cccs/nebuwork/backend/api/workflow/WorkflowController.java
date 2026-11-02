package cn.nebulaedata.cccs.nebuwork.backend.api.workflow;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;
import javax.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController
@RequestMapping("/api")
public class WorkflowController {
    private final WorkflowService service;private final WorkflowSettings settings;
    public WorkflowController(WorkflowService service,WorkflowSettings settings) { this.service=service;this.settings=settings; }
    @GetMapping("/workflow/settings") public Object settings(HttpServletRequest r) { return ok(settings.read(RequestIdentity.actor(r))); }
    @PostMapping("/workflow/settings") public Object saveSettings(@RequestBody JsonNode p,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r) { return ok(settings.save(RequestIdentity.actor(r),p,key)); }
    @PostMapping("/workflow/settings/test") public Object testSettings(@RequestBody JsonNode p,HttpServletRequest r) { return ok(settings.test(RequestIdentity.actor(r),p)); }
    @GetMapping("/workflows") public Object list(HttpServletRequest r) { return ok(service.list(RequestIdentity.actor(r))); }
    @PostMapping("/workflows") public Object create(@RequestBody JsonNode p,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r) { return ok(service.create(RequestIdentity.actor(r),p,key)); }
    @GetMapping("/workflows/{id}") public Object get(@PathVariable String id,HttpServletRequest r) { return ok(service.get(RequestIdentity.actor(r),id)); }
    @PostMapping("/workflows/{id}/retry") public Object retry(@PathVariable String id,HttpServletRequest r) { return ok(service.retry(RequestIdentity.actor(r),id,false)); }
    @PostMapping("/workflows/{id}/definition") public Object definition(@PathVariable String id,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.definition(RequestIdentity.actor(r),id,p)); }
    @PostMapping("/workflows/{id}/validate") public Object validate(@PathVariable String id,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.validate(RequestIdentity.actor(r),id,p)); }
    @GetMapping("/workflows/{id}/source") public Object source(@PathVariable String id,@RequestParam String path,HttpServletRequest r) { return ok(service.source(RequestIdentity.actor(r),id,path,null)); }
    @PostMapping("/workflows/{id}/source") public Object saveSource(@PathVariable String id,@RequestParam String path,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.source(RequestIdentity.actor(r),id,path,p)); }
    @GetMapping("/workflows/{id}/revisions") public Object revisions(@PathVariable String id,@RequestParam String path,HttpServletRequest r) { return ok(service.revisions(RequestIdentity.actor(r),id,path)); }
    @PostMapping("/workflows/{id}/restore") public Object restore(@PathVariable String id,@RequestParam String path,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.restore(RequestIdentity.actor(r),id,path,p)); }
    @PostMapping("/workflows/{id}/archive") public Object archive(@PathVariable String id,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.archive(RequestIdentity.actor(r),id,p)); }
    @GetMapping("/workflows/{id}/tasks") public Object tasks(@PathVariable String id,HttpServletRequest r) { return ok(service.tasks(RequestIdentity.actor(r),id)); }
    @PostMapping("/workflows/{id}/tasks") public Object run(@PathVariable String id,@RequestBody JsonNode p,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r) { return ok(service.createTask(RequestIdentity.actor(r),id,p,key)); }
    @GetMapping("/workflow-tasks/{id}") public Object task(@PathVariable String id,HttpServletRequest r) { return ok(service.task(RequestIdentity.actor(r),id)); }
    @PostMapping("/workflow-tasks/{id}/retry") public Object retryTask(@PathVariable String id,HttpServletRequest r) { return ok(service.retry(RequestIdentity.actor(r),id,true)); }
    @PostMapping("/workflow-tasks/{id}/actions/{action}") public Object control(@PathVariable String id,@PathVariable String action,@RequestBody JsonNode p,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r) { return ok(service.control(RequestIdentity.actor(r),id,action,p,key)); }
    @PostMapping("/workflow-tasks/{id}/preview") public Object preview(@PathVariable String id,@RequestBody JsonNode p,HttpServletRequest r) { return ok(service.preview(RequestIdentity.actor(r),id,p)); }
    @GetMapping("/workflow-tasks/{id}/events") public Object events(@PathVariable String id,@RequestParam(defaultValue="0") long after,HttpServletRequest r) { return ok(service.events(RequestIdentity.actor(r),id,after)); }
    @GetMapping("/workflow-tasks/{id}/logs") public Object logs(@PathVariable String id,@RequestParam String step,@RequestParam int attempt,HttpServletRequest r) { return ok(service.logs(RequestIdentity.actor(r),id,step,attempt)); }
    @GetMapping("/workflows/{id}/artifacts") public Object artifacts(@PathVariable String id,HttpServletRequest r) { return ok(service.artifacts(RequestIdentity.actor(r),id)); }
    @GetMapping("/workflows/{id}/artifacts/{artifact}/content") public Object content(@PathVariable String id,@PathVariable String artifact,HttpServletRequest r) { return ok(service.content(RequestIdentity.actor(r),id,artifact)); }
    @GetMapping("/workflows/{id}/artifacts/{artifact}/download") public ResponseEntity<StreamingResponseBody> download(@PathVariable String id,@PathVariable String artifact,HttpServletRequest r) {
        WorkflowService.Download file=service.download(RequestIdentity.actor(r),id,artifact);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_OCTET_STREAM).header(HttpHeaders.CONTENT_DISPOSITION,ContentDisposition.attachment().filename(file.filename,StandardCharsets.UTF_8).build().toString()).body(file::write);
    }
}
