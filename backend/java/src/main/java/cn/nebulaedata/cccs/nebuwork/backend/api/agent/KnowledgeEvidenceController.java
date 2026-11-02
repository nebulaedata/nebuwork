package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeContentController;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.HttpServletRequest;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import java.util.*;

@RestController @RequestMapping("/api/tasks/{task}/evidence/{id}")
public class KnowledgeEvidenceController {
    private static void fields(JsonNode body,String... fields){Set<String> allowed=new HashSet<>(Arrays.asList(fields));if(!body.isObject())throw new ApiException(422,"请求必须为对象");body.fieldNames().forEachRemaining(k->{if(!allowed.contains(k))throw new ApiException(422,"不支持的字段");});}
    private final KnowledgeEvidence evidence;
    public KnowledgeEvidenceController(KnowledgeEvidence evidence){this.evidence=evidence;}
    @GetMapping public Object read(@PathVariable String task,@PathVariable String id,HttpServletRequest r){return ok(evidence.read(RequestIdentity.actor(r),task,id));}
    @PostMapping("/read") public Object source(@PathVariable String task,@PathVariable String id,@RequestBody JsonNode body,HttpServletRequest r){fields(body,"page");return ok(evidence.source(RequestIdentity.actor(r),task,id,body));}
    @PostMapping("/{action:preview|media}") public ResponseEntity<byte[]> content(@PathVariable String task,@PathVariable String id,@PathVariable String action,@RequestBody JsonNode body,HttpServletRequest r){fields(body,"download");return KnowledgeContentController.response(evidence.binary(RequestIdentity.actor(r),task,id,"media".equals(action),body.path("download").asBoolean()));}
}
