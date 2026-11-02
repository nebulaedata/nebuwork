package cn.nebulaedata.cccs.nebuwork.backend.api.extensionmarket;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentRequests;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import javax.servlet.http.HttpServletRequest;
import java.io.IOException;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController @RequestMapping("/api/market")
public class ExtensionMarketController {
    private final ExtensionMarket market;private final AgentRequests requests;
    public ExtensionMarketController(ExtensionMarket market,AgentRequests requests){this.market=market;this.requests=requests;}
    @GetMapping("/extensions") public Object list(@RequestParam(defaultValue="") String q,@RequestParam(defaultValue="") String kind,@RequestParam(defaultValue="0") int offset,@RequestParam(defaultValue="24") int limit,@RequestParam(defaultValue="false") boolean manage,HttpServletRequest r){return ok(market.list(RequestIdentity.actor(r),q,kind,Math.max(0,offset),Math.min(100,Math.max(1,limit)),manage));}
    @GetMapping("/settings") public Object settings(HttpServletRequest r){return ok(market.settings(RequestIdentity.actor(r)));}
    @GetMapping("/targets") public Object targets(HttpServletRequest r){return ok(market.targets(RequestIdentity.actor(r)));}
    @GetMapping("/extensions/{id}") public Object detail(@PathVariable String id,HttpServletRequest r){return ok(market.detail(RequestIdentity.actor(r),id));}
    @PostMapping("/extensions") public Object create(@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=RequestIdentity.actor(r);market.requireAdmin(owner);return ok(requests.once(owner,"market-create",key,body,()->market.create(owner,body)));}
    @PostMapping("/extensions/{id}/draft") public Object save(@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=RequestIdentity.actor(r);market.requireAdmin(owner);return ok(requests.once(owner,"market-save:"+id,key,body,()->market.save(owner,id,body)));}
    @PostMapping("/extensions/{id}/auth") public Object auth(@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=RequestIdentity.actor(r);market.requireAdmin(owner);return ok(requests.once(owner,"market-auth:"+id,key,body,()->market.auth(owner,id,body)));}
    @PostMapping("/extensions/{id}/publish") public Object publish(@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=RequestIdentity.actor(r);market.requireAdmin(owner);return ok(requests.once(owner,"market-publish:"+id,key,body,()->market.publish(owner,id,body)));}
    @PostMapping("/extensions/{id}/withdraw") public Object withdraw(@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=RequestIdentity.actor(r);market.requireAdmin(owner);return ok(requests.once(owner,"market-listing:"+id,key,body,()->market.listing(owner,id,body,false)));}
    @PostMapping("/extensions/{id}/restore") public Object restore(@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=RequestIdentity.actor(r);market.requireAdmin(owner);return ok(requests.once(owner,"market-listing:"+id,key,body,()->market.listing(owner,id,body,true)));}
    @PostMapping("/extensions/{id}/files") public Object upload(@PathVariable String id,@RequestParam String path,@RequestParam MultipartFile file,@RequestParam long revision,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r)throws IOException{return ok(market.upload(RequestIdentity.actor(r),id,path,file,key,revision));}
    @PostMapping("/extensions/{id}/install") public Object install(@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(market.install(RequestIdentity.actor(r),id,body,key));}
    @GetMapping("/operations/{id}") public Object operation(@PathVariable String id,HttpServletRequest r){return ok(market.operation(RequestIdentity.actor(r),id));}
    @GetMapping("/operations") public Object operations(HttpServletRequest r){return ok(market.operations(RequestIdentity.actor(r)));}
    @GetMapping("/installations") public Object installations(@RequestParam String targetKind,@RequestParam String targetId,HttpServletRequest r){return ok(market.targetInstallations(RequestIdentity.actor(r),targetKind,targetId));}
    @PostMapping("/installations/{id}/remove") public Object remove(@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=RequestIdentity.actor(r);return ok(requests.once(owner,"market-remove:"+id,key,body,()->market.remove(owner,id,body)));}
    @PostMapping("/extensions/{id}/upgrade") public Object upgrade(@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(market.install(RequestIdentity.actor(r),id,body,key));}
    @PostMapping("/operations/{id}/retry") public Object retry(@PathVariable String id,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=RequestIdentity.actor(r);market.operation(owner,id);return ok(requests.once(owner,"market-retry:"+id,key,java.util.Collections.singletonMap("operationId",id),()->market.retry(owner,id)));}
}
