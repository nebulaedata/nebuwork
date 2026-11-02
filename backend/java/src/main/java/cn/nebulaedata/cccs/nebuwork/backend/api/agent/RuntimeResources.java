package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.expert.ExpertMapper;
import cn.nebulaedata.cccs.nebuwork.backend.api.workbench.WorkbenchMapper;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import java.io.IOException;
import java.util.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.extensionmarket.ExtensionMarket;
import org.springframework.beans.factory.annotation.Autowired;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;

@Service
public class RuntimeResources {
    @Autowired(required=false) private ExtensionMarket market;
    private final AgentStore store;private final WorkbenchMapper workbenches;private final ExpertMapper experts;
    private final AgentClient engine;private final AgentModels models;private final ObjectMapper json;private final ModelSecretCipher cipher;
    public RuntimeResources(AgentStore store,WorkbenchMapper workbenches,ExpertMapper experts,AgentClient engine,AgentModels models,ObjectMapper json,ModelSecretCipher cipher){this.store=store;this.workbenches=workbenches;this.experts=experts;this.engine=engine;this.models=models;this.json=json;this.cipher=cipher;}
    public void authorize(String owner,String kind,String target){
        AgentClient.segment(target);Map<String,Object> row;
        if("workbench".equals(kind))row=workbenches.workbench(owner,target);
        else if("project".equals(kind))row=workbenches.project(owner,target);
        else if("expert".equals(kind))row=experts.visibleExpert(owner,target);
        else throw new ApiException(422,"不支持的运行资源范围");
        if(row==null)throw new ApiException(404,"资源范围不存在或没有访问权限");
    }
    public static ObjectNode empty(ObjectMapper json){ObjectNode doc=json.createObjectNode();for(String name:Arrays.asList("instructions","files","skills","mcp","requiredCapabilities","extensionRefs"))doc.putArray(name);doc.putObject("model");doc.putNull("modelProviderId");return doc;}
    public Object view(String owner,String kind,String target){authorize(owner,kind,target);Map<String,Object> draft=store.draft(owner,kind,target),active=store.active(owner,kind,target);JsonNode document=draft==null?empty(json):decode(json,draft.get("document_json"));return map("scopeKind",kind,"scopeId",target,"revision",draft==null?0:draft.get("revision"),"document",document,"extensions",market==null?map("enabled",false,"items",Collections.emptyList()):market.runtimeView(owner,kind,target,document),"publishedExtensionRefs",active==null?json.createArrayNode():decode(json,active.get("document_json")).path("extensionRefs"),"published",active==null?null:map("id",active.get("id"),"revision",active.get("source_revision"),"bundleId",active.get("bundle_id"),"bundleVersion",active.get("bundle_version"),"hash",active.get("content_hash")));}
    public String path(String input){String path=input.replace('\\','/');if(path.isEmpty()||path.startsWith("/")||path.matches("^[A-Za-z]:.*")||Arrays.stream(path.split("/",-1)).anyMatch(p->p.isEmpty()||p.equals(".")||p.equals(".."))||path.chars().anyMatch(c->c<32))throw new ApiException(422,"资源路径必须位于资源包内");return path.replaceAll("(?i)(^|/)agent\\.md$","$1AGENTS.md");}
    private ObjectNode validate(JsonNode raw){
        if(!raw.isObject()||raw.toString().length()>2*1024*1024)throw new ApiException(422,"运行资源必须是有效的 JSON 对象且小于 2 MiB");
        ObjectNode doc=raw.deepCopy();Set<String> fields=new HashSet<>(Arrays.asList("instructions","files","skills","mcp","model","modelProviderId","requiredCapabilities","extensionRefs"));doc.fieldNames().forEachRemaining(k->{if(!fields.contains(k))throw new ApiException(422,"不支持的运行资源字段："+k);});
        for(String name:Arrays.asList("instructions","files","skills","mcp","requiredCapabilities","extensionRefs"))if(!doc.has(name))doc.putArray(name);else if(!doc.path(name).isArray())throw new ApiException(422,name+" 必须是数组");
        Set<String> paths=new HashSet<>();for(JsonNode file:doc.path("files")){String normalized=path(file.path("path").asText());if(!paths.add(normalized.toLowerCase(Locale.ROOT)))throw new ApiException(422,"存在冲突的资源文件路径");((ObjectNode)file).put("path",normalized);}
        for(JsonNode skill:doc.path("skills")){String directory=path(skill.path("directory").asText());if(!paths.contains((directory+"/SKILL.md").toLowerCase(Locale.ROOT)))throw new ApiException(422,"技能缺少 SKILL.md："+directory);for(JsonNode file:skill.path("requiredFiles"))if(!paths.contains((directory+"/"+path(file.asText())).toLowerCase(Locale.ROOT)))throw new ApiException(422,"技能缺少必需资源："+file.asText());}
        for(JsonNode server:doc.path("mcp")){if("nebuwork".equalsIgnoreCase(server.path("id").asText()))throw new ApiException(422,"nebuwork 是系统 MCP 的保留标识");for(String secret:Arrays.asList("env","headers","apiKey","token","password"))if(server.has(secret))throw new ApiException(422,"MCP 凭据请使用 credentialRef 引用加密凭据");}
        return doc;
    }
    @Transactional public Object save(String owner,String kind,String target,JsonNode body){
        authorize(owner,kind,target);long expected=body.path("revision").asLong(-1);ObjectNode document=validate(body.path("document"));
        if(market!=null)market.validateRefs(owner,kind,target,document);else if(!document.path("extensionRefs").isEmpty())throw new ApiException(503,"扩展市场不可用");
        Map<String,Object> old=store.one("SELECT * FROM nw_agent_resource WHERE owner_id=? AND scope_kind=? AND scope_id=? FOR UPDATE",owner,kind,target);
        if(old==null){if(expected!=0)throw new ApiException(409,"运行资源已变化，请重新加载");store.update("INSERT INTO nw_agent_resource(owner_id,scope_kind,scope_id,document_json) VALUES(?,?,?,?)",owner,kind,target,document.toString());}
        else {if(number(old,"revision")!=expected)throw new ApiException(409,"运行资源已变化，请重新加载");store.update("UPDATE nw_agent_resource SET document_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE owner_id=? AND scope_kind=? AND scope_id=?",document.toString(),owner,kind,target);}
        return view(owner,kind,target);
    }
    @Transactional public Object publish(String owner,String kind,String target,long revision){
        authorize(owner,kind,target);Map<String,Object> draft=store.one("SELECT * FROM nw_agent_resource WHERE owner_id=? AND scope_kind=? AND scope_id=? FOR UPDATE",owner,kind,target);
        if(draft==null||number(draft,"revision")!=revision)throw new ApiException(409,"请先保存当前运行资源草稿");
        Map<String,Object> existing=store.one("SELECT * FROM nw_agent_resource_version WHERE owner_id=? AND scope_kind=? AND scope_id=? AND source_revision=?",owner,kind,target,revision);
        if(existing==null){ObjectNode document=validate(decode(json,draft.get("document_json")));if(market!=null){market.validateRefs(owner,kind,target,document);document=market.expand(owner,kind,target,document);}else if(!document.path("extensionRefs").isEmpty())throw new ApiException(503,"扩展市场不可用");
            if("expert".equals(kind)){Map<String,Object> expert=experts.visibleExpert(owner,target);StringBuilder instruction=new StringBuilder(Objects.toString(expert.get("role_label"),"")).append('\n').append(Objects.toString(expert.get("tagline"),""));for(Map<String,Object> rule:experts.rules(target))if(bool(rule.get("enabled")))instruction.append("\n").append(rule.get("name")).append(": ").append(rule.get("content"));document.withArray("instructions").add(json.valueToTree(map("source","expert:"+target,"path","EXPERT.md","scope","","content",instruction.toString(),"revision",String.valueOf(expert.get("revision")))));if(!document.hasNonNull("modelProviderId")&&expert.get("model_provider_id")!=null)document.put("modelProviderId",str(expert,"model_provider_id"));}
            if("expert".equals(kind))appendExpertMaterials(owner,target,revision,document);
            models.binding(owner,document);
            String bundle="nw-"+hash(owner+":"+kind+":"+target).substring(0,40),version=Long.toString(revision);ObjectNode payload=json.createObjectNode().put("id",bundle).put("version",version).put("name",kind+":"+target);
            for(String field:Arrays.asList("instructions","files","skills","mcp"))payload.set(field,document.path(field));
            JsonNode published=engine.post(owner,null,"/v1/runtime-bundles",payload,"publish:"+bundle+":"+version);String id="rv-"+hash(bundle+":"+version).substring(0,40);
            store.update("INSERT INTO nw_agent_resource_version(id,owner_id,scope_kind,scope_id,source_revision,bundle_id,bundle_version,document_json,content_hash) VALUES(?,?,?,?,?,?,?,?,?)",id,owner,kind,target,revision,bundle,version,document.toString(),published.path("hash").asText());
            store.update("UPDATE nw_agent_resource SET active_version_id=? WHERE owner_id=? AND scope_kind=? AND scope_id=?",id,owner,kind,target);
        }return view(owner,kind,target);
    }
    private void appendExpertMaterials(String owner,String expert,long revision,ObjectNode document) {
        for(Map<String,Object> sop:experts.sops(expert)) {
            String sopId=str(sop,"id");StringBuilder content=new StringBuilder(str(sop,"name")).append("\n").append(str(sop,"description")).append("\n").append(decode(json,sop.get("definition_json")));
            for(Map<String,Object> material:experts.materials(sopId)) {
                String artifact=str(material,"artifact_id");if(artifact.isEmpty()){content.append("\n尚未上传的参考素材：").append(str(material,"display_name"));continue;}
                String sourceOwner=str(material,"artifact_owner_id"),project="expert-"+expert;int version=(int)number(material,"artifact_version");
                JsonNode metadata=engine.get(sourceOwner,project,"/v1/artifacts/"+AgentClient.segment(artifact)+"?version="+version);
                ObjectNode resource=json.createObjectNode();
                if(owner.equals(sourceOwner)){for(String field:Arrays.asList("objectKey","sha256","size","mediaType"))resource.set(field,metadata.path(field));}
                else {byte[] bytes=engine.contentBytes(sourceOwner,project,artifact,version);resource=engine.post(owner,null,"/v1/objects",map("contentBase64",Base64.getEncoder().encodeToString(bytes),"mediaType",metadata.path("mediaType").asText("application/octet-stream")),"sop-copy:"+hash(owner+":"+artifact+":"+version)).deepCopy();}
                String filePath=path("sops/"+sopId+"/"+str(material,"id")+"/"+str(material,"display_name"));resource.put("path",filePath);document.withArray("files").add(resource);content.append("\n参考素材：").append(filePath).append(" (artifact ").append(artifact).append(" v").append(version).append(")");
            }
            document.withArray("instructions").add(json.valueToTree(map("source","expert:"+expert,"path","SOP-"+sopId+".md","scope","","revision",String.valueOf(sop.get("revision")),"content",content.toString())));
        }
    }
    /** Workbench ontology and runtime resources have independent publication histories. */
    public void ensurePublished(String owner,String workbench){Map<String,Object> draft=store.draft(owner,"workbench",workbench);if(draft==null){save(owner,"workbench",workbench,json.valueToTree(map("revision",0,"document",empty(json))));draft=store.draft(owner,"workbench",workbench);}publish(owner,"workbench",workbench,number(draft,"revision"));}
    public Object upload(String owner,String kind,String target,String path,MultipartFile file,String requestKey)throws IOException{authorize(owner,kind,target);if(file.getSize()>20*1024*1024)throw new ApiException(413,"单个运行资源不能超过 20 MiB");ObjectNode resource=engine.post(owner,null,"/v1/objects",map("contentBase64",Base64.getEncoder().encodeToString(file.getBytes()),"mediaType",Objects.toString(file.getContentType(),"application/octet-stream")),requestKey).deepCopy();resource.put("path",path(path));return resource;}
    public List<Map<String,Object>> credentials(String owner){return store.rows("SELECT id,label,revision,created_at FROM nw_agent_credential WHERE owner_id=? ORDER BY created_at",owner);}
    @Transactional public Object saveCredential(String owner,JsonNode body){String id=body.hasNonNull("id")?text(body,"id",128,true):"mcp:"+UUID.randomUUID().toString();String label=text(body,"label",240,true);JsonNode secret=body.path("secret");if(!secret.isObject()||secret.toString().length()>32000)throw new ApiException(422,"凭据必须是有效 JSON 对象");if(body.hasNonNull("id")){Map<String,Object> previous=store.one("SELECT * FROM nw_agent_credential WHERE owner_id=? AND id=? FOR UPDATE",owner,id);if(previous==null)throw new ApiException(404,"凭据不存在");revision(previous,body);store.update("UPDATE nw_agent_credential SET label=?,secret_ciphertext=?,revision=revision+1 WHERE id=? AND owner_id=?",label,cipher.encrypt(owner,id,secret.toString()),id,owner);}else store.update("INSERT INTO nw_agent_credential(id,owner_id,label,secret_ciphertext) VALUES(?,?,?,?)",id,owner,label,cipher.encrypt(owner,id,secret.toString()));return map("id",id,"label",label,"revision",body.hasNonNull("id")?body.path("revision").asLong()+1:1);}
    public boolean credentialExists(String owner,String ref){return store.one("SELECT id FROM nw_agent_credential WHERE owner_id=? AND id=?",owner,ref)!=null;}
    public Object revokeCredential(String owner,String ref){store.update("DELETE FROM nw_agent_credential WHERE owner_id=? AND id=?",owner,ref);return map("revoked",true);}
    public JsonNode credential(String owner,String reference){Map<String,Object> row=store.one("SELECT * FROM nw_agent_credential WHERE owner_id=? AND id=?",owner,reference);if(row==null)throw new ApiException(403,"MCP 凭据已撤销");return decode(json,cipher.decrypt(owner,reference,str(row,"secret_ciphertext")));}
}
