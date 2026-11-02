package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.expert.ExpertMapper;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Service;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Durable source handles. Reading historical evidence still checks today's grants. */
@Service
public class KnowledgeEvidence {
    private final AgentStore db;private final AgentTasks tasks;private final KnowledgeService knowledge;private final KnowledgeContent content;private final ExpertMapper experts;private final ObjectMapper json;
    public KnowledgeEvidence(AgentStore db,AgentTasks tasks,KnowledgeService knowledge,KnowledgeContent content,ExpertMapper experts,ObjectMapper json){this.db=db;this.tasks=tasks;this.knowledge=knowledge;this.content=content;this.experts=experts;this.json=json;}
    public void authorize(String owner,String project,String kind,String scope,String reference){
        if("catalog".equals(kind)){JsonNode descriptor=catalogDescriptor(owner,scope,reference);knowledge.authorizeLibrary(owner,scope,descriptor.path("collectionId").asText(),false);return;}
        if("expert".equals(kind)){boolean bound=false;for(JsonNode id:decode(json,tasks.project(owner,project,false).get("snapshot_json")).path("config").path("agentIds"))if(scope.equals(id.asText()))bound=true;if(!bound||experts.visibleExpert(owner,scope)==null)throw new ApiException(403,"专家知识库授权已撤销");}
        else if(!"project".equals(kind)||!project.equals(scope))throw new ApiException(403,"知识库不属于当前项目");
        Map<String,Object> ref=knowledge.authorizedReference(owner,kind,scope,reference);if(!Boolean.TRUE.equals(ref.get("enabled")))throw new ApiException(403,"知识库授权已撤销或连接已停用");
    }
    public JsonNode record(String owner,String task,String run,String call,String kind,String scope,String reference,JsonNode response){
        ObjectNode result=(ObjectNode)response.deepCopy();
        result.set("knowledgeReference",json.valueToTree(map("id",reference,"scopeKind",kind,"scopeId",scope)));
        if(result.path("document").isObject()&&!result.has("citation")){
            JsonNode d=result.path("document");result.set("citation",json.valueToTree(map("collectionId",d.path("collectionId").asText(),"documentId",d.path("id").asText(),"title",d.path("title").asText(),"contentKind",d.path("contentKind").asText("document"),"sourceLocators",json.createArrayNode(),"version",d.path("version"))));
        }
        int[] ordinal={0};walk(result,owner,task,run,call,kind,scope,reference,ordinal);return result;
    }
    private void walk(JsonNode node,String owner,String task,String run,String call,String kind,String scope,String reference,int[] ordinal){
        if(node.isObject()&&node.path("citation").isObject()){
            ObjectNode c=(ObjectNode)node.path("citation");String id="ke_"+hash(owner+":"+task+":"+run+":"+call+":"+(ordinal[0]++)).substring(0,48);c.put("evidenceId",id);c.put("referenceId",reference);c.put("evidenceUrl","evidence://"+id);
            String sourceHash=node.path("document").path("sourceHash").asText(c.path("sourceHash").asText());if(sourceHash.isEmpty())for(JsonNode locator:c.path("sourceLocators"))if(!locator.path("source_hash").asText().isEmpty()){sourceHash=locator.path("source_hash").asText();break;}if(!sourceHash.isEmpty())c.put("sourceHash",sourceHash);
            String snippet=node.path("text").asText(node.path("document").path("extractedText").asText(node.path("chunk").path("content").asText(node.path("caption").asText())));if(snippet.length()>16000)snippet=snippet.substring(0,16000);
            Object snapshot=map("citation",c,"text",snippet,"imageId",node.path("sourceKind").asText().equals("image")?node.path("id").asText():"","sourceKind",node.path("sourceKind").asText(c.path("contentKind").asText("document")),"fileName",node.path("document").path("fileName").asText(),"fileType",node.path("document").path("fileType").asText(),"sourceHash",sourceHash);
            db.update("INSERT INTO nw_knowledge_evidence(id,owner_id,task_id,run_id,call_id,scope_kind,scope_id,reference_id,snapshot_json) VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id",id,owner,task,run,call,kind,scope,reference,encode(json,snapshot));
        }
        if(node.isContainerNode())for(JsonNode child:node)walk(child,owner,task,run,call,kind,scope,reference,ordinal);
    }
    public void authorizeResult(String owner,String task,JsonNode result){
        if(result.isObject()&&result.path("knowledgeReference").isObject()){JsonNode ref=result.path("knowledgeReference");authorize(owner,str(tasks.owned(owner,task),"project_id"),ref.path("scopeKind").asText(),ref.path("scopeId").asText(),ref.path("id").asText());}
        if(result.isObject()&&result.path("citation").hasNonNull("evidenceId"))owned(owner,task,result.path("citation").path("evidenceId").asText());
        if(result.isContainerNode())for(JsonNode child:result)authorizeResult(owner,task,child);
    }
    private Map<String,Object> owned(String owner,String task,String id){Map<String,Object> t=tasks.owned(owner,task),e=db.one("SELECT * FROM nw_knowledge_evidence WHERE id=? AND owner_id=? AND task_id=?",id,owner,task);if(e==null)throw new ApiException(404,"引用依据不存在");authorize(owner,str(t,"project_id"),str(e,"scope_kind"),str(e,"scope_id"),str(e,"reference_id"));return e;}
    public Object read(String owner,String task,String id){Map<String,Object> e=owned(owner,task,id);ObjectNode saved=(ObjectNode)decode(json,e.get("snapshot_json"));if("catalog".equals(e.get("scope_kind"))){JsonNode descriptor=catalogDescriptor(owner,str(e,"scope_id"),str(e,"reference_id"));saved.set("navigation",json.valueToTree(map("connectionId",str(e,"scope_id"),"collectionId",descriptor.path("collectionId").asText())));}else saved.set("navigation",json.valueToTree(map("scopeKind",str(e,"scope_kind"),"scopeId",str(e,"scope_id"),"id",str(e,"reference_id"))));return saved;}
    public JsonNode recordCatalog(String owner,String task,String run,String call,String connection,String handle,JsonNode response){return record(owner,task,run,call,"catalog",connection,handle,response);}
    private JsonNode catalogDescriptor(String owner,String connection,String handle){Map<String,Object> row=db.one("SELECT descriptor_json FROM nw_platform_mcp_resource WHERE owner_id=? AND id=?",owner,handle);if(row==null)throw new ApiException(404,"引用来源已失效");JsonNode d=decode(json,row.get("descriptor_json"));if(!"evidence_catalog".equals(d.path("type").asText())||!connection.equals(d.path("connectionId").asText()))throw new ApiException(403,"引用来源不匹配");return d;}
    public Object source(String owner,String task,String id,JsonNode body){Map<String,Object> e=owned(owner,task,id);ObjectNode input=json.createObjectNode();String kind=decode(json,e.get("snapshot_json")).path("citation").path("contentKind").asText("document");JsonNode citation=decode(json,e.get("snapshot_json")).path("citation");input.put("documentId",citation.path("documentId").asText());input.put("contentKind",kind);if(!citation.path("chunkId").asText().isEmpty())input.put("chunkId",citation.path("chunkId").asText());for(String key:Arrays.asList("sourceRefId","fileVersionId","parseVersionId"))if(citation.hasNonNull(key))input.set(key,citation.get(key));if(body.has("page"))input.set("page",body.get("page"));input.put("pageSize",20);String operation=input.has("chunkId")&&"document".equals(kind)?"chunk":"document";if("catalog".equals(e.get("scope_kind"))){JsonNode descriptor=catalogDescriptor(owner,str(e,"scope_id"),str(e,"reference_id"));return knowledge.readCatalog(owner,str(e,"scope_id"),descriptor.path("collectionId").asText(),operation,input);}return knowledge.readReference(owner,str(e,"scope_kind"),str(e,"scope_id"),str(e,"reference_id"),operation,input);}
    public KnowledgeRestClient.Binary binary(String owner,String task,String id,boolean media,boolean download){Map<String,Object> e=owned(owner,task,id);JsonNode saved=decode(json,e.get("snapshot_json")),c=saved.path("citation");ObjectNode input=json.createObjectNode();input.put("documentId",c.path("documentId").asText());input.put("download",download);for(String key:Arrays.asList("sourceRefId","fileVersionId","parseVersionId"))if(c.hasNonNull(key))input.set(key,c.get(key));if(media){input.put("chunkId",c.path("chunkId").asText());input.put("imageId",saved.path("imageId").asText());}if("catalog".equals(e.get("scope_kind"))){JsonNode descriptor=catalogDescriptor(owner,str(e,"scope_id"),str(e,"reference_id"));return content.catalog(owner,str(e,"scope_id"),descriptor.path("collectionId").asText(),input,media);}return content.reference(owner,str(e,"scope_kind"),str(e,"scope_id"),str(e,"reference_id"),input,media);}
}
