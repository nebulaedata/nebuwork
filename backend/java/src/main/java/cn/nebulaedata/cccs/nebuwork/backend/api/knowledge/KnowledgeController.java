package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;

@RestController
@RequestMapping("/api")
public class KnowledgeController {
    private final KnowledgeService service;private final ObjectMapper json;
    public KnowledgeController(KnowledgeService service,ObjectMapper json){this.service=service;this.json=json;}
    private String actor(HttpServletRequest r){return RequestIdentity.actor(r);}
    @GetMapping("/knowledge-mcp/drivers") public Object drivers(HttpServletRequest r){actor(r);return ok(service.drivers());}
    @GetMapping("/knowledge-mcp/targets") public Object targets(@RequestParam String kind,HttpServletRequest r){return ok(service.targets(actor(r),kind));}
    @GetMapping("/knowledge-mcp/connections") public Object list(@RequestParam(defaultValue="user") String kind,@RequestParam(defaultValue="") String scopeId,HttpServletRequest r){return ok(service.connections(actor(r),kind,scopeId));}
    @PostMapping("/knowledge-mcp/connections") public Object create(@RequestBody JsonNode body,HttpServletRequest r){return ok(service.createConnection(actor(r),body));}
    @PostMapping("/knowledge-mcp/connections/test") public Object testDraft(@RequestBody JsonNode body,HttpServletRequest r){return ok(service.testDraft(actor(r),body));}
    @PostMapping("/knowledge-mcp/connections/{id}") public Object update(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return ok(service.updateConnection(actor(r),id,body));}
    @DeleteMapping("/knowledge-mcp/connections/{id}") public Object delete(@PathVariable String id,@RequestParam long revision,HttpServletRequest r){service.deleteConnection(actor(r),id,revision);return ok(null);}
    @PostMapping("/knowledge-mcp/connections/{id}/test") public Object test(@PathVariable String id,HttpServletRequest r){return ok(service.testConnection(actor(r),id));}
    @GetMapping("/knowledge-mcp/connections/{id}/collections") public Object collections(@PathVariable String id,@RequestParam(defaultValue="false") boolean includeDocumentCounts,HttpServletRequest r){return ok(service.collections(actor(r),id,includeDocumentCounts));}
    @GetMapping("/knowledge-mcp/connections/{id}/references") public Object usages(@PathVariable String id,HttpServletRequest r){return ok(service.usages(actor(r),id));}
    @PostMapping("/knowledge-mcp/connections/{id}/read") public Object catalog(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){
        fields(body,"collectionId","operation","query","topK","documentId","contentKind","page","pageSize","chunkId","mode","nodeId","limit","searchIn","sortBy","sortOrder","isEnabled","documentIds","attrFilters","attrRules","parent_id","folder_id","sourceRefId","fileVersionId","parseVersionId");
        return ok(service.readCatalog(actor(r),id,text(body,"collectionId",8192,true),operation(body),arguments(body)));
    }
    @GetMapping("/knowledge-scopes/{kind}/{id}") public Object scope(@PathVariable String kind,@PathVariable String id,HttpServletRequest r){return ok(service.configuration(actor(r),kind,id));}
    @PostMapping("/knowledge-scopes/{kind}/{id}/references") public Object bind(@PathVariable String kind,@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return ok(service.bind(actor(r),kind,id,body));}
    @PostMapping("/knowledge-scopes/{kind}/{id}/connections") public Object local(@PathVariable String kind,@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return ok(service.createLocal(actor(r),kind,id,body));}
    @DeleteMapping("/knowledge-scopes/{kind}/{id}/references/{reference}") public Object unbind(@PathVariable String kind,@PathVariable String id,@PathVariable String reference,@RequestParam long revision,HttpServletRequest r){return ok(service.unbind(actor(r),kind,id,reference,revision));}
    @PostMapping("/knowledge-scopes/{kind}/{id}/references/{reference}/read") public Object read(@PathVariable String kind,@PathVariable String id,@PathVariable String reference,@RequestBody JsonNode body,HttpServletRequest r){
        fields(body,"operation","query","topK","documentId","contentKind","page","pageSize","chunkId","mode","nodeId","limit","searchIn","sortBy","sortOrder","isEnabled","documentIds","attrFilters","attrRules","parent_id","folder_id","sourceRefId","fileVersionId","parseVersionId");
        return ok(service.readReference(actor(r),kind,id,reference,operation(body),arguments(body)));
    }
    private String operation(JsonNode body){
        String op=text(body,"operation",16,true);
        if(!java.util.Arrays.asList("documents","document","search","answer","capabilities","chunk","graph","gallery","wiki.folders","wiki.graph","wiki.stats","source").contains(op))throw new cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException(422,"不支持的知识库操作");
        return op;
    }
    private JsonNode arguments(JsonNode body){ObjectNode out=json.createObjectNode();for(String key:new String[]{"query","topK","documentId","contentKind","page","pageSize","chunkId","mode","nodeId","limit","searchIn","sortBy","sortOrder","isEnabled","documentIds","attrFilters","attrRules","parent_id","folder_id","sourceRefId","fileVersionId","parseVersionId"})if(body.has(key))out.set(key,body.get(key));return out;}
}
