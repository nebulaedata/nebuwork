package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController
@RequestMapping("/api/memory")
public class MemoryController {
    private final MemoryService memory;
    private final MemoryRuntime runtime;
    public MemoryController(MemoryService memory,MemoryRuntime runtime) {this.memory=memory;this.runtime=runtime;}
    @GetMapping("/targets") public Object targets(HttpServletRequest r){return ok(memory.targets(RequestIdentity.actor(r)));}
    @GetMapping("/cleanup") public Object cleanup(HttpServletRequest r){return ok(memory.cleanup(RequestIdentity.actor(r)));}
    @GetMapping("/scopes/{kind}/{id}") public Object list(@PathVariable String kind,@PathVariable String id,@RequestParam(defaultValue="0") int offset,HttpServletRequest r){return ok(memory.list(RequestIdentity.actor(r),kind,id,offset));}
    @PostMapping("/scopes/{kind}/{id}/search") public Object search(@PathVariable String kind,@PathVariable String id,@RequestBody JsonNode b,HttpServletRequest r){return ok(memory.searchScope(RequestIdentity.actor(r),kind,id,b));}
    @PostMapping("/scopes/{kind}/{id}/entries") public Object create(@PathVariable String kind,@PathVariable String id,@RequestBody JsonNode b,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(memory.create(RequestIdentity.actor(r),kind,id,b,key));}
    @GetMapping("/entries/{id}") public Object detail(@PathVariable String id,HttpServletRequest r){return ok(memory.detail(RequestIdentity.actor(r),id));}
    @PostMapping("/entries/{id}") public Object edit(@PathVariable String id,@RequestBody JsonNode b,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(memory.change(RequestIdentity.actor(r),id,"edit",b,key));}
    @PostMapping("/entries/{id}/{action:approve|reject|disable|delete}") public Object change(@PathVariable String id,@PathVariable String action,@RequestBody JsonNode b,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(memory.change(RequestIdentity.actor(r),id,action,b,key));}
    @PostMapping("/entries/{id}/promote") public Object promote(@PathVariable String id,@RequestBody JsonNode b,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(memory.promote(RequestIdentity.actor(r),id,b,key));}
    @PostMapping("/entries/{id}/retry") public Object retry(@PathVariable String id,@RequestBody JsonNode b,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(memory.retry(RequestIdentity.actor(r),id,b,key));}
    @GetMapping("/tasks/{id}/context") public Object context(@PathVariable String id,HttpServletRequest r){return ok(runtime.history(RequestIdentity.actor(r),id));}
}
