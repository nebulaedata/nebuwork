package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import javax.servlet.http.HttpServletRequest;
import java.io.IOException;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController @RequestMapping("/api")
public class RuntimeResourceController {
    private final RuntimeResources resources;private final AgentRequests requests;
    public RuntimeResourceController(RuntimeResources resources,AgentRequests requests){this.resources=resources;this.requests=requests;}
    @GetMapping("/runtime-resources/{kind}/{id}") public Object get(@PathVariable String kind,@PathVariable String id,HttpServletRequest r){return ok(resources.view(RequestIdentity.actor(r),kind,id));}
    @PostMapping("/runtime-resources/{kind}/{id}") public Object save(@PathVariable String kind,@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=RequestIdentity.actor(r);resources.authorize(owner,kind,id);return ok(requests.once(owner,"resource:"+kind+":"+id,key,body,()->resources.save(owner,kind,id,body)));}
    @PostMapping("/runtime-resources/{kind}/{id}/publish") public Object publish(@PathVariable String kind,@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=RequestIdentity.actor(r);resources.authorize(owner,kind,id);return ok(requests.once(owner,"publish:"+kind+":"+id,key,body,()->resources.publish(owner,kind,id,body.path("revision").asLong(-1))));}
    @PostMapping("/runtime-resources/{kind}/{id}/files") public Object upload(@PathVariable String kind,@PathVariable String id,@RequestParam String path,@RequestParam("file") MultipartFile file,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r)throws IOException{return ok(resources.upload(RequestIdentity.actor(r),kind,id,path,file,key));}
    @GetMapping("/runtime-credentials") public Object credentials(HttpServletRequest r){return ok(resources.credentials(RequestIdentity.actor(r)));}
    @PostMapping("/runtime-credentials/{id}/revoke") public Object revoke(@PathVariable String id,HttpServletRequest r){return ok(resources.revokeCredential(RequestIdentity.actor(r),id));}
    @PostMapping("/runtime-credentials") public Object credential(@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=RequestIdentity.actor(r);return ok(requests.once(owner,"credential",key,body,()->resources.saveCredential(owner,body)));}
}
