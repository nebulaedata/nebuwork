package cn.nebulaedata.cccs.nebuwork.backend.api.preview;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeContent;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import javax.servlet.http.HttpServletResponse;
import java.io.*;
import java.util.*;

/** The browser supplies resource identities only; credentials and URLs never enter a source. */
@Service public class PreviewSources {
    private final AgentTasks tasks;private final AgentClient engine;private final KnowledgeContent knowledge;private final KnowledgeEvidence evidence;private final ObjectMapper json;
    public PreviewSources(AgentTasks tasks,AgentClient engine,KnowledgeContent knowledge,KnowledgeEvidence evidence,ObjectMapper json){this.tasks=tasks;this.engine=engine;this.knowledge=knowledge;this.evidence=evidence;this.json=json;}
    public ObjectNode validate(JsonNode source){
        if(!source.isObject())throw new ApiException(422,"请选择文件来源");Set<String> allowed=new HashSet<>(Arrays.asList("kind","projectId","artifactId","version","scopeKind","scopeId","referenceId","connectionId","collectionId","documentId","taskId","evidenceId","expectedHash","sourceRefId","fileVersionId","parseVersionId"));source.fieldNames().forEachRemaining(k->{if(!allowed.contains(k))throw new ApiException(422,"文件来源只接受资源标识");});
        String kind=source.path("kind").asText();if(!Arrays.asList("artifact","knowledge","evidence").contains(kind))throw new ApiException(422,"文件来源无效");if("artifact".equals(kind)&&(!source.path("version").isIntegralNumber()||source.path("version").asInt()<1))throw new ApiException(422,"请选择固定文件版本");return ((ObjectNode)source).deepCopy();
    }
    private ObjectNode normalized(String owner,JsonNode source){
        if(!"evidence".equals(source.path("kind").asText()))return (ObjectNode)source.deepCopy();
        JsonNode saved=json.valueToTree(evidence.read(owner,source.path("taskId").asText(),source.path("evidenceId").asText())),nav=saved.path("navigation");ObjectNode next=json.createObjectNode();next.put("kind","knowledge");next.put("documentId",saved.path("citation").path("documentId").asText());
        if(nav.has("connectionId")){next.put("scopeKind","catalog");next.set("connectionId",nav.get("connectionId"));next.set("collectionId",nav.get("collectionId"));}else{next.set("scopeKind",nav.path("scopeKind"));next.set("scopeId",nav.path("scopeId"));next.set("referenceId",nav.path("id"));}
        for(String key:Arrays.asList("sourceRefId","fileVersionId","parseVersionId"))if(saved.path("citation").hasNonNull(key))next.set(key,saved.path("citation").get(key));next.put("expectedHash",source.path("expectedHash").asText(saved.path("sourceHash").asText()));return next;
    }
    public JsonNode metadata(String owner,JsonNode source){
        ObjectNode s=normalized(owner,source);JsonNode metadata;
        if("artifact".equals(s.path("kind").asText())){String project=s.path("projectId").asText();tasks.project(owner,project,false);metadata=engine.get(owner,project,"/v1/artifacts/"+AgentClient.segment(s.path("artifactId").asText())+"?version="+s.path("version").asInt());if(!project.equals(metadata.path("projectId").asText()))throw new ApiException(404,"文件不属于当前项目");}
        else metadata=knowledge.largeMetadata(owner,s);
        if(metadata.path("size").asLong(-1)>2147483648L)throw new ApiException(413,"文件超过 2048 MiB");String expected=s.path("expectedHash").asText(),actual=metadata.path("sha256").asText(metadata.path("sourceHash").asText());if(!expected.isEmpty()&&!expected.equals(actual))throw new ApiException(409,"原文件版本已变化，请重新打开来源");return metadata;
    }
    public void stream(String owner,JsonNode source,String range,HttpServletResponse response)throws IOException{
        metadata(owner,source);ObjectNode s=normalized(owner,source);
        if("artifact".equals(s.path("kind").asText()))engine.fileStream(owner,s.path("projectId").asText(),"/v1/artifacts/"+AgentClient.segment(s.path("artifactId").asText())+"/content?version="+s.path("version").asInt(),range,response);
        else knowledge.largeStream(owner,s,range,response);
    }
}
