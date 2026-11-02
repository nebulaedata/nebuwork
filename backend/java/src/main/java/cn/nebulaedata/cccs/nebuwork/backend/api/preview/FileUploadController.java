package cn.nebulaedata.cccs.nebuwork.backend.api.preview;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.core.env.Environment;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.*;
import java.io.*;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;
@RestController @RequestMapping("/api/projects/{project}/artifact-uploads")
public class FileUploadController {
    private final AgentTasks tasks;private final AgentClient engine;private final Environment env;
    public FileUploadController(AgentTasks tasks,AgentClient engine,Environment env){this.tasks=tasks;this.engine=engine;this.env=env;}
    private String owner(HttpServletRequest r,String project){if(!env.getProperty("nebu.files.enabled",Boolean.class,false))throw new ApiException(503,"大文件功能尚未启用");String owner=RequestIdentity.actor(r);tasks.project(owner,project,true);return owner;}
    private JsonNode session(String owner,String project,String upload){return engine.get(owner,project,"/v1/file-uploads/"+AgentClient.segment(upload));}
    @PostMapping public Object create(@PathVariable String project,@RequestBody JsonNode body,@RequestHeader("Idempotency-Key")String key,HttpServletRequest r){
        String owner=owner(r,project);if(!body.isObject())throw new ApiException(422,"上传参数无效");Set<String> allowed=new HashSet<>(Arrays.asList("name","size","mediaType","taskId"));body.fieldNames().forEachRemaining(field->{if(!allowed.contains(field))throw new ApiException(422,"未知上传参数");});
        if(!body.path("size").isIntegralNumber()||body.path("size").asLong()<0||body.path("size").asLong()>2147483648L)throw new ApiException(413,"单个文件最大 2048 MiB");
        ObjectNode input=((ObjectNode)body).deepCopy();String taskId=input.path("taskId").asText();input.remove("taskId");if(!taskId.isEmpty()){Map<String,Object> task=tasks.owned(owner,taskId);if(!project.equals(task.get("project_id")))throw new ApiException(404,"任务不属于当前项目");input.put("sessionId",task.get("session_id").toString());}input.put("purpose","artifact");return ok(engine.post(owner,project,"/v1/projects/"+AgentClient.segment(project)+"/file-uploads",input,key));
    }
    @GetMapping("/{id}")public Object status(@PathVariable String project,@PathVariable String id,HttpServletRequest r){return ok(session(owner(r,project),project,id));}
    @PostMapping(value="/{id}/parts/{number}",consumes="application/octet-stream")public Object part(@PathVariable String project,@PathVariable String id,@PathVariable int number,@RequestHeader("X-Part-Sha256")String digest,HttpServletRequest r)throws IOException{String owner=owner(r,project);JsonNode upload=session(owner,project,id);long size=upload.path("size").asLong(),partSize=upload.path("partSize").asLong(),offset=(number-1L)*partSize;if(number<1||offset>size||partSize<=0)throw new ApiException(422,"分块编号无效");long length=Math.min(partSize,size-offset);if(r.getContentLengthLong()>=0&&r.getContentLengthLong()!=length)throw new ApiException(422,"分块长度无效");return ok(engine.filePart(owner,project,id,number,digest,r.getInputStream(),length));}
    @PostMapping("/{id}/{action:complete|cancel}")public Object action(@PathVariable String project,@PathVariable String id,@PathVariable String action,HttpServletRequest r){String owner=owner(r,project);session(owner,project,id);return ok(engine.post(owner,project,"/v1/file-uploads/"+AgentClient.segment(id)+"/"+action,Collections.emptyMap(),"file-"+id+"-"+action));}
}
