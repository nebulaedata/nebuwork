package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import javax.servlet.http.HttpServletRequest;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;

@RestController
@RequestMapping("/api/knowledge-mcp")
public class KnowledgeManagementController {
    private final KnowledgeService knowledge;private final KnowledgeManagement management;
    public KnowledgeManagementController(KnowledgeService knowledge,KnowledgeManagement management){this.knowledge=knowledge;this.management=management;}
    private String actor(HttpServletRequest r){return RequestIdentity.actor(r);}
    @GetMapping("/settings") public Object settings(HttpServletRequest r){return ok(knowledge.settings(actor(r)));}
    @GetMapping("/connections/{id}/discover") public Object discover(@PathVariable String id,HttpServletRequest r){return ok(knowledge.discover(actor(r),id));}
    @PostMapping("/connections/{id}/assign") public Object assign(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return ok(knowledge.assign(actor(r),id,body));}
    @PostMapping("/connections/{id}/manage") public Object manage(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){return ok(management.manage(actor(r),id,body));}
    @GetMapping("/operations") public Object operations(HttpServletRequest r){return ok(management.listOperations(actor(r)));}
    @PostMapping("/operations/{id}/recover") public Object recover(@PathVariable String id,HttpServletRequest r){return ok(management.recover(actor(r),id));}
    @GetMapping("/operations/{id}/progress") public Object progress(@PathVariable String id,HttpServletRequest r){return ok(management.progress(actor(r),id));}
    @PostMapping("/operations/{id}/errors") public ResponseEntity<byte[]> errors(@PathVariable String id,HttpServletRequest r){return ResponseEntity.ok().header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff").header("Content-Disposition","attachment; filename=faq-errors.csv").contentType(MediaType.APPLICATION_OCTET_STREAM).body(management.failureReport(actor(r),id).bytes);}
    @PostMapping(value="/connections/{id}/upload",consumes=MediaType.MULTIPART_FORM_DATA_VALUE)
    public Object upload(@PathVariable String id,@RequestParam String collectionId,@RequestParam String requestKey,@RequestParam("file") MultipartFile file,@RequestParam String fileName,@RequestParam(required=false) String relativePath,HttpServletRequest r){return ok(management.upload(actor(r),id,collectionId,requestKey,file,fileName,relativePath));}
    @PostMapping("/connections/{id}/download") public ResponseEntity<byte[]> download(@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){
        fields(body,"collectionId","documentId","format");KnowledgeRestClient.Binary result=management.download(actor(r),id,text(body,"collectionId",8192,true),text(body,"documentId",8192,false),body.path("format").asText("json"));
        return ResponseEntity.ok().header("Cache-Control","no-store").header("X-Content-Type-Options","nosniff").header("Content-Disposition","attachment; filename=knowledge-export").contentType(MediaType.APPLICATION_OCTET_STREAM).body(result.bytes);
    }
}
