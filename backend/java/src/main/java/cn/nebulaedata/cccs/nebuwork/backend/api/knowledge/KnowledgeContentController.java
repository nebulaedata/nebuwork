package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;

@RestController @RequestMapping("/api")
public class KnowledgeContentController {
    private final KnowledgeContent content;
    public KnowledgeContentController(KnowledgeContent content){this.content=content;}
    @PostMapping("/knowledge-mcp/connections/{id}/{action:preview|media}")
    public ResponseEntity<byte[]> catalog(@PathVariable String id,@PathVariable String action,@RequestBody JsonNode body,HttpServletRequest r){return response(content.catalog(RequestIdentity.actor(r),id,text(body,"collectionId",8192,true),body,"media".equals(action)));}
    @PostMapping("/knowledge-scopes/{kind}/{id}/references/{reference}/{action:preview|media}")
    public ResponseEntity<byte[]> reference(@PathVariable String kind,@PathVariable String id,@PathVariable String reference,@PathVariable String action,@RequestBody JsonNode body,HttpServletRequest r){return response(content.reference(RequestIdentity.actor(r),kind,id,reference,body,"media".equals(action)));}
    public static ResponseEntity<byte[]> response(KnowledgeRestClient.Binary binary){
        MediaType type;try{type=MediaType.parseMediaType(binary.contentType);}catch(Exception e){type=MediaType.APPLICATION_OCTET_STREAM;}
        // Only fetched as a Blob; never execute upstream HTML in the app origin.
        return ResponseEntity.ok().contentType(type).header("Cache-Control","private, no-store").header("X-Content-Type-Options","nosniff").header("Content-Disposition","attachment; filename=knowledge-source").body(binary.bytes);
    }
}
