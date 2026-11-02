package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import javax.servlet.http.*;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.Map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController @RequestMapping("/api")
public class DatabaseController {
    final DatabaseService service;final AgentRequests requests;final ObjectMapper json;
    public DatabaseController(DatabaseService service,AgentRequests requests,ObjectMapper json){this.service=service;this.requests=requests;this.json=json;}
    String actor(HttpServletRequest r){return RequestIdentity.actor(r);}
    @GetMapping("/database-scopes/{kind}/{id}/databases") public Object scope(@PathVariable String kind,@PathVariable String id,HttpServletRequest r){return ok(service.scope(actor(r),kind,id));}
    @PostMapping("/database-scopes/{kind}/{id}/databases") public Object create(@PathVariable String kind,@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=actor(r);service.scopes.authorize(owner,kind,id);return ok(requests.once(owner,"database-create:"+kind+":"+id,key,body,()->service.create(owner,kind,id,body,key,null)));}
    @GetMapping("/databases/{id}") public Object view(@PathVariable String id,HttpServletRequest r){return ok(service.view(actor(r),id));}
    @PostMapping("/databases/{id}/config") public Object save(@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=actor(r);service.owned(owner,id);return ok(requests.once(owner,"database-config:"+id,key,body,()->service.save(owner,id,body)));}
    @PostMapping("/databases/{id}/{action:enable|disable|remove}") public Object change(@PathVariable String id,@PathVariable String action,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=actor(r);service.owned(owner,id);return ok(requests.once(owner,"database-"+action+":"+id,key,body,()->service.change(owner,id,action,body)));}
    @PostMapping("/databases/{id}/test") public Object test(@PathVariable String id,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){String owner=actor(r);service.owned(owner,id);return ok(requests.once(owner,"database-test:"+id,key,json.createObjectNode(),()->service.test(owner,id)));}
    @PostMapping("/databases/{id}/imports/upload") public Object upload(@PathVariable String id,@RequestParam("file") MultipartFile file,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r)throws IOException{String owner=actor(r);service.owned(owner,id);return ok(service.files.stage(owner,id,file,key));}
    @PostMapping("/databases/{id}/imports/preview") public Object preview(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return ok(service.preview(actor(r),id,body));}
    @GetMapping("/databases/{id}/operations") public Object history(@PathVariable String id,@RequestParam(defaultValue="0")int offset,HttpServletRequest r){return ok(service.history(actor(r),id,offset));}
    @PostMapping("/databases/{id}/operations") public Object submit(@PathVariable String id,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key") String key,HttpServletRequest r){return ok(service.submit(actor(r),id,body,key,null));}
    @GetMapping("/databases/{id}/operations/{operation}") public Object operation(@PathVariable String id,@PathVariable String operation,HttpServletRequest r){return ok(service.operation(actor(r),id,operation));}
    @PostMapping("/databases/{id}/operations/{operation}/cancel") public Object cancel(@PathVariable String id,@PathVariable String operation,HttpServletRequest r){return ok(service.cancel(actor(r),id,operation));}
    @PostMapping("/databases/{id}/operations/{operation}/reconcile") public Object reconcile(@PathVariable String id,@PathVariable String operation,HttpServletRequest r){return ok(service.reconcileExport(actor(r),id,operation));}
    @GetMapping("/databases/{id}/download") public void download(@PathVariable String id,HttpServletRequest r,HttpServletResponse response)throws IOException{Map<String,Object> row=service.owned(actor(r),id);byte[] bytes=service.download(actor(r),id);response.setContentType("application/vnd.sqlite3");response.setHeader("Content-Disposition","attachment; filename*=UTF-8''"+URLEncoder.encode(row.get("name")+".sqlite","UTF-8").replace("+","%20"));response.setHeader("X-Content-Type-Options","nosniff");response.setContentLengthLong(bytes.length);response.getOutputStream().write(bytes);}
    @GetMapping("/databases/{id}/operations/{operation}/download") public void export(@PathVariable String id,@PathVariable String operation,HttpServletRequest r,HttpServletResponse response)throws IOException{JsonNode op=json.valueToTree(service.operation(actor(r),id,operation));if(!op.path("state").asText().equals("completed")||!op.path("result").has("artifact"))throw new ApiException(409,"导出尚未完成");JsonNode artifact=op.path("result").path("artifact");service.engine.content(actor(r),op.path("result").path("projectId").asText(),artifact.path("id").asText(),artifact.path("version").asInt(),null,null,response);}
}
