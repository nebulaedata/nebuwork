package cn.nebulaedata.cccs.nebuwork.backend.api.workbench;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.expert.ExpertMapper;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.RuntimeResources;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentTasks;
import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeService;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

@Service
public class WorkbenchService {
    private final WorkbenchMapper db;
    private final ExpertMapper catalog;
    private final ObjectMapper json;
    private final RuntimeResources resources;
    private final AgentTasks tasks;
    private final KnowledgeService knowledge;
    private static final String[] TEXT_FIELDS={"bizName","domain","bizDef","wikiMd","applicabilityMd","exclusionsMd","systemPrompt"};
    private static final Set<String> ICONS=new HashSet<>(Arrays.asList("package","file-check","bar-chart-3","activity","terminal","wrench","file-text","briefcase","layers","book-open"));
    public WorkbenchService(WorkbenchMapper db,ExpertMapper catalog,ObjectMapper json,RuntimeResources resources,AgentTasks tasks,KnowledgeService knowledge) {
        this.db=db; this.catalog=catalog; this.json=json; this.resources=resources;this.tasks=tasks; this.knowledge=knowledge;
    }
    private String id(String kind) { return kind+"-"+UUID.randomUUID().toString().replace("-",""); }
    private long number(Map<String,Object> row,String key) { return ((Number)row.get(key)).longValue(); }
    private String string(Map<String,Object> row,String key) { return Objects.toString(cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.str(row,key),""); }
    private Object time(Object v) { return v instanceof Timestamp?((Timestamp)v).toInstant().toString():v; }
    private String encode(Object v) { try { return json.writeValueAsString(v); } catch(Exception e) { throw new IllegalStateException(e); } }
    private JsonNode decode(String v) { return cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.decode(json,v); }
    private ObjectNode object(JsonNode v) { if(v==null||!v.isObject()) throw new ApiException(422,"请求必须为 JSON 对象"); return (ObjectNode)v; }
    private String text(JsonNode v,String field,int limit,boolean required) {
        JsonNode n=v.get(field);
        if(n!=null&&!n.isNull()&&!n.isTextual()) throw new ApiException(422,field+" 必须为文本");
        String result=n==null||n.isNull()?"":n.asText().trim();
        if(result.length()>limit||(required&&result.isEmpty())) throw new ApiException(422,field+" 不能为空或超过长度限制 "+limit);
        return result;
    }
    private void fields(JsonNode body,String... names) {
        object(body); Set<String> allowed=new HashSet<>(Arrays.asList(names));
        body.fieldNames().forEachRemaining(k->{ if(!allowed.contains(k)) throw new ApiException(422,"不支持的字段："+k); });
    }
    private long revision(JsonNode body) {
        JsonNode value=body.path("revision");
        if(!value.isIntegralNumber()||!value.canConvertToLong()||value.asLong()<1) throw new ApiException(422,"缺少有效 revision");
        return value.asLong();
    }
    private void sameRevision(Map<String,Object> row,long revision) { if(number(row,"revision")!=revision) throw new ApiException(409,"配置已被修改，请重新加载后再保存"); }
    private void changed(int n) { if(n!=1) throw new ApiException(409,"配置已被修改，请重新加载后再保存"); }
    private Map<String,Object> required(Map<String,Object> row,String name) { if(row==null) throw new ApiException(404,name+"不存在"); return row; }
    private Map<String,Object> owned(String owner,String id) { return required(db.workbench(owner,id),"工作台"); }
    private Map<String,Object> lock(String owner,String id) { return required(db.lockWorkbench(owner,id),"工作台"); }
    private String key(String key) {
        if(key==null||!key.matches("[A-Za-z0-9._:-]{1,128}")) throw new ApiException(422,"请提供有效的 Idempotency-Key"); return key;
    }
    private String hash(String content) {
        try { StringBuilder b=new StringBuilder(); for(byte v:MessageDigest.getInstance("SHA-256").digest(content.getBytes(StandardCharsets.UTF_8))) b.append(String.format("%02x",v&255)); return b.toString(); }
        catch(Exception e) { throw new IllegalStateException(e); }
    }
    private void audit(String actor,String type,String target,String action,Object value) {
        catalog.audit(map("id",id("audit"),"actor",actor,"type",type,"object",target,"action",action,"change",encode(value)));
    }
    private ObjectNode emptyDraft() {
        ObjectNode d=json.createObjectNode(); for(String f:TEXT_FIELDS) d.put(f,"");
        d.putArray("entities"); d.putArray("relations"); d.putNull("defaultAgentId"); return d;
    }
    private ObjectNode draft(String id) {
        return object(decode(db.draft(id)));
    }
    private Map<String,Object> metadata(JsonNode body,JsonNode defaults) {
        String name=body.has("name")?text(body,"name",160,true):text(defaults,"name",160,true);
        String desc=body.has("desc")?text(body,"desc",2000,false):defaults.path("desc").asText("");
        String icon=body.has("icon")?text(body,"icon",64,true):defaults.path("icon").asText("package");
        String color=body.has("color")?text(body,"color",9,true):defaults.path("color").asText("#6C63F0");
        if(!ICONS.contains(icon)) throw new ApiException(422,"请选择支持的工作台图标");
        if(!color.matches("#[0-9a-fA-F]{6}")) throw new ApiException(422,"颜色必须为六位十六进制色值");
        return map("name",name,"desc",desc,"icon",icon,"color",color);
    }
    private Map<String,Object> workbenchView(Map<String,Object> row) {
        String id=string(row,"id"); Object published=row.get("published_revision");JsonNode source=draft(id);
        return map("id",id,"name",row.get("name"),"desc",row.get("description"),"icon",row.get("icon"),"color",row.get("color"),
            "projectIds",db.projectIds(id),"stats",map("running",null,"tokenToday",null),
            "revision",row.get("revision"),"activeVersionId",row.get("active_version_id"),"activeVersion",row.get("active_version"),
            "runtime",resources.view(string(row,"owner_id"),"workbench",id),
            "publishStatus",published==null?"unpublished":((Number)published).longValue()==number(row,"revision")?"published":"draft",
            "createdAt",time(row.get("created_at")),"updatedAt",time(row.get("updated_at")));
    }
    @Transactional(readOnly=true)
    public List<Map<String,Object>> list(String owner) { List<Map<String,Object>> out=new ArrayList<>(); for(Map<String,Object> row:db.workbenches(owner)) out.add(workbenchView(row)); return out; }
    @Transactional(readOnly=true)
    public Map<String,Object> get(String owner,String id) { return workbenchView(owned(owner,id)); }
    @Transactional(isolation=Isolation.READ_COMMITTED)
    public Map<String,Object> create(String owner,JsonNode body,String requestKey) {
        fields(body,"name","desc","icon","color"); key(requestKey);
        Map<String,Object> p=metadata(body,json.createObjectNode());
        String fingerprint=hash(encode(p)),candidate=id("wb");
        Map<String,Object> prior=db.createdWorkbench(owner,requestKey);
        if(prior!=null) {
            if(!fingerprint.equals(prior.get("create_request_hash")))throw new ApiException(409,"创建请求编号已用于不同内容，请使用新的请求编号");
            if(prior.get("deleted_at")!=null)throw new ApiException(409,"该创建请求对应的工作台已删除，请重新创建");
            return get(owner,string(prior,"id"));
        }
        p.putAll(map("id",candidate,"owner",owner,"key",requestKey,"hash",fingerprint)); db.insertWorkbench(p);
        Map<String,Object> row=db.createdWorkbench(owner,requestKey);
        if(!fingerprint.equals(row.get("create_request_hash"))) throw new ApiException(409,"创建请求编号已用于不同内容，请使用新的请求编号");
        if(row.get("deleted_at")!=null) throw new ApiException(409,"该创建请求对应的工作台已删除，请重新创建");
        String actual=string(row,"id");
        if(candidate.equals(actual)) { db.insertDraft(actual,encode(emptyDraft())); audit(owner,"workbench",actual,"create",map("name",p.get("name"))); }
        return get(owner,actual);
    }
    @Transactional
    public Map<String,Object> update(String owner,String id,JsonNode body) {
        fields(body,"name","desc","icon","color","revision"); Map<String,Object> row=lock(owner,id); long revision=revision(body); sameRevision(row,revision);
        Map<String,Object> p=metadata(body,json.valueToTree(workbenchView(owned(owner,id))));
        p.putAll(map("id",id,"owner",owner,"revision",revision)); changed(db.updateWorkbench(p));
        audit(owner,"workbench",id,"update",p); return get(owner,id);
    }
    private List<Map<String,Object>> agentViews(List<String> ids) {
        List<Map<String,Object>> out=new ArrayList<>();
        for(String id:ids) { Map<String,Object> a=required(catalog.expert(id),"引用的专家");
            out.add(map("id",id,"name",a.get("name"),"role",a.get("role_label"),"initials",a.get("initials"),"color",a.get("color"),"revision",a.get("revision"))); }
        return out;
    }
    private List<Map<String,Object>> caseViews(List<String> ids) {
        List<Map<String,Object>> out=new ArrayList<>();
        for(String id:ids) { Map<String,Object> t=required(catalog.template(id),"引用的案例模板"); out.add(map("id",id,"name",t.get("name"),"scene",t.get("scene"),"desc",t.get("description"),"color",t.get("color"))); }
        return out;
    }
    @Transactional(readOnly=true)
    public Map<String,Object> config(String owner,String id) {
        Map<String,Object> wb=get(owner,id); ObjectNode d=draft(id);
        List<String> agents=db.agents(id),cases=db.cases(id);
        d.set("agentIds",json.valueToTree(agents)); d.set("tplIds",json.valueToTree(cases)); d.set("kbRefs",json.valueToTree(knowledge.referenceIds(owner,"workbench",id)));
        d.put("revision",((Number)wb.get("revision")).longValue());
        return map("workbench",wb,"config",d,"agents",agentViews(agents),"templates",caseViews(cases),"knowledgeBases",knowledge.references(owner,"workbench",id));
    }
    private ObjectNode validateDraft(ObjectNode d,List<String> agents,boolean publishing) {
        for(String field:TEXT_FIELDS) {
            String checked=text(d,field,field.equals("bizName")||field.equals("domain")?240:24000,publishing&&Arrays.asList("bizName","domain","bizDef").contains(field));
            d.put(field,field.equals("bizName")||field.equals("domain")?checked:d.path(field).asText(""));
        }
        Set<String> entityIds=new HashSet<>(),relationIds=new HashSet<>();
        for(String field:Arrays.asList("entities","relations")) {
            JsonNode rows=d.path(field); if(!rows.isArray()||rows.size()>200) throw new ApiException(422,field+" 必须为最多 200 项的数组");
            for(JsonNode item:rows) {
                if(field.equals("entities")) fields(item,"id","name","description"); else fields(item,"id","name","description","sourceEntityId","targetEntityId");
                String stableId=text(item,"id",64,true); if(!stableId.matches("[A-Za-z0-9_-]+")) throw new ApiException(422,"实体或关系 ID 格式不正确");
                if(!(field.equals("entities")?entityIds:relationIds).add(stableId)) throw new ApiException(422,"实体或关系 ID 重复");
                ObjectNode row=(ObjectNode)item; row.put("id",stableId).put("name",text(item,"name",160,true)).put("description",text(item,"description",2000,false));
            }
        }
        for(JsonNode relation:d.path("relations")) {
            for(String field:Arrays.asList("sourceEntityId","targetEntityId")) {
                String target=text(relation,field,64,true); if(!entityIds.contains(target)) throw new ApiException(422,"关系只能引用当前本体内的实体"); ((ObjectNode)relation).put(field,target);
            }
        }
        String selected=text(d,"defaultAgentId",64,false);
        if(!selected.isEmpty()&&!agents.contains(selected)) throw new ApiException(422,"默认专家必须是当前工作台已绑定的专家");
        if(selected.isEmpty()) d.putNull("defaultAgentId"); else d.put("defaultAgentId",selected);
        if(encode(d).getBytes(StandardCharsets.UTF_8).length>2*1024*1024) throw new ApiException(422,"配置不能超过 2 MiB");
        return d;
    }
    @Transactional
    public Map<String,Object> saveConfig(String owner,String id,JsonNode body) {
        fields(body,"revision","bizName","domain","bizDef","wikiMd","applicabilityMd","exclusionsMd","systemPrompt","entities","relations","defaultAgentId");
        Map<String,Object> row=lock(owner,id); long revision=revision(body); sameRevision(row,revision); ObjectNode next=draft(id);
        body.fields().forEachRemaining(entry->{ if(!entry.getKey().equals("revision")) next.set(entry.getKey(),entry.getValue().deepCopy()); });
        validateDraft(next,db.agents(id),false); db.updateDraft(id,encode(next)); changed(db.touch(owner,id,revision));
        audit(owner,"workbench",id,"save_draft",map("revision",revision+1,"contentHash",hash(encode(next)))); return config(owner,id);
    }
    @Transactional(isolation=Isolation.READ_COMMITTED)
    public Map<String,Object> bind(String owner,String id,String kind,String target,boolean enabled,long revision) {
        Map<String,Object> row=lock(owner,id); sameRevision(row,revision);
        if(!Arrays.asList("agents","tpls").contains(kind)) throw new ApiException(422,"此接口只支持专家和案例引用，知识库请使用独立配置接口");
        boolean agent=kind.equals("agents"); List<String> current=agent?db.agents(id):db.cases(id);
        if(enabled) {
            if(agent) { required(catalog.lockExpert(target),"专家");required(catalog.visibleExpert(owner,target),"专家，请先添加到我的专家"); }
            else required(catalog.template(target),"案例模板");
        }
        if(current.contains(target)!=enabled) {
            if(enabled) { if(agent) db.bindAgent(id,target,db.nextAgentOrder(id)); else db.bindCase(id,target,db.nextCaseOrder(id)); }
            else if(agent) { db.unbindAgent(id,target); ObjectNode d=draft(id); if(target.equals(d.path("defaultAgentId").asText())) { d.putNull("defaultAgentId"); db.updateDraft(id,encode(d)); } }
            else db.unbindCase(id,target);
            changed(db.touch(owner,id,revision)); audit(owner,"workbench",id,enabled?"bind":"unbind",map("kind",kind,"targetId",target));
        }
        return config(owner,id);
    }
    private Map<String,Object> versionView(Map<String,Object> row,boolean full) {
        Map<String,Object> v=map("id",row.get("id"),"workbenchId",row.get("workbench_id"),"version",row.get("version_number"),"sourceRevision",row.get("source_revision"),
            "contentHash",row.get("content_hash"),"publishedBy",row.get("published_by"),"publishedAt",time(row.get("published_at")));
        if(full) v.put("snapshot",decode(string(row,"snapshot_json"))); return v;
    }
    @Transactional(readOnly=true)
    public List<Map<String,Object>> versions(String owner,String id) { owned(owner,id); List<Map<String,Object>> out=new ArrayList<>(); for(Map<String,Object> row:db.versions(id)) out.add(versionView(row,false)); return out; }
    @Transactional(readOnly=true)
    public Map<String,Object> version(String owner,String id,String version) { owned(owner,id); return versionView(required(db.version(id,version),"发布版本"),true); }
    @Transactional
    public Map<String,Object> publish(String owner,String id,JsonNode body) {
        fields(body,"revision"); Map<String,Object> row=lock(owner,id); long revision=revision(body); sameRevision(row,revision);
        Map<String,Object> existing=db.versionForRevision(id,revision);
        if(existing==null) {
            List<String> agents=db.agents(id),cases=db.cases(id); ObjectNode d=validateDraft(draft(id),agents,true);
            resources.ensurePublished(owner,id);
            List<Map<String,Object>> knowledgeRefs=knowledge.publicationReferences(owner,id);
            List<String> knowledgeIds=new ArrayList<>();for(Map<String,Object> ref:knowledgeRefs)knowledgeIds.add(ref.get("id").toString());
            d.set("agentIds",json.valueToTree(agents)); d.set("tplIds",json.valueToTree(cases)); d.set("kbRefs",json.valueToTree(knowledgeIds));
            Map<String,Object> snapshot=map("schemaVersion",1,"workbench",map("id",id,"name",row.get("name"),"desc",row.get("description"),"icon",row.get("icon"),"color",row.get("color")),
                "config",d,"agents",agentViews(agents),"templates",caseViews(cases),"knowledgeBases",knowledgeRefs);
            String encoded=encode(snapshot),version=id("ont");
            int number=db.nextVersion(id);
            db.insertVersion(map("id",version,"workbench",id,"number",number,"revision",revision,"snapshot",encoded,"hash",hash(encoded),"actor",owner));
            knowledge.pinPublication(owner,version,knowledgeRefs);
            db.activate(id,version);
            audit(owner,"workbench",id,"publish_requested",map("versionId",version,"sourceRevision",revision,"contentHash",hash(encoded)));
            existing=db.version(id,version);
        }
        return map("workbench",get(owner,id),"version",versionView(existing,true));
    }
    @Transactional
    public void delete(String owner,String id,long revision) {
        Map<String,Object> row=lock(owner,id); sameRevision(row,revision);
        if(!db.projectIds(id).isEmpty()) throw new ApiException(409,"工作台已有项目，不能删除（包括暂停和已归档项目）");
        // Keep immutable history/mappings for recovery and audit; ownership lookups hide this tombstone.
        knowledge.removeWorkbenchDraft(owner,id);
        db.deleteWorkbench(id); db.deleteAgents(id); db.deleteCases(id); db.deleteDraft(id);
        audit(owner,"workbench",id,"delete",map("name",row.get("name")));
    }
    private Map<String,Object> projectView(Map<String,Object> row) {
        JsonNode snapshot=decode(string(row,"snapshot_json"));
        return map("id",row.get("id"),"name",row.get("name"),"desc",row.get("description"),"workbenchId",row.get("workbench_id"),"workbenchName",row.get("workbench_name"),
            "status",row.get("status"),"revision",row.get("revision"),"createdAt",time(row.get("created_at")),"updatedAt",time(row.get("updated_at")),
            "parameters",row.get("parameters_json")==null?json.createObjectNode():decode(string(row,"parameters_json")),"ontologyVersionId",row.get("ontology_version_id"),"ontologyVersion",row.get("version_number"),"agentIds",snapshot.path("config").path("agentIds"),"agents",snapshot.path("agents"),
            "stats",map("tasks",null,"tokens",null,"cost",null),"runtime",map("engine","nebu-agent-engine","state","ready"),"capabilities",map("execution",true,"resources",true));
    }
    @Transactional(readOnly=true)
    public List<Map<String,Object>> projects(String owner,String workbench) {
        if(workbench!=null) owned(owner,workbench);
        List<Map<String,Object>> out=new ArrayList<>(); for(Map<String,Object> row:db.projects(owner,workbench)) out.add(projectView(row)); return out;
    }
    @Transactional
    public Map<String,Object> createProject(String owner,JsonNode body,String requestKey) {
        fields(body,"name","desc","workbenchId","parameters"); key(requestKey);
        Map<String,Object> p=map("workbench",text(body,"workbenchId",64,true),"name",text(body,"name",160,true),"desc",text(body,"desc",2000,false));
        if(body.has("parameters")&&!body.path("parameters").isObject())throw new ApiException(422,"parameters 必须为对象");p.put("parameters",body.path("parameters").isObject()?body.path("parameters"):json.createObjectNode());
        String fingerprint=hash(encode(p)),candidate=id("project"),workbench=p.get("workbench").toString();
        Map<String,Object> wb=lock(owner,workbench);
        Map<String,Object> prior=db.createdProject(owner,requestKey);
        if(prior!=null) {
            if(!fingerprint.equals(prior.get("create_request_hash")))throw new ApiException(409,"创建请求编号已用于不同内容，请使用新的请求编号");
            return projectView(required(db.project(owner,string(prior,"id")),"项目"));
        }
        // Serialize with publish/delete; a project always pins the active version read under this lock.
        if(wb.get("active_version_id")==null) throw new ApiException(409,"请先发布工作台配置，再创建项目");
        p.putAll(map("id",candidate,"owner",owner,"version",wb.get("active_version_id"),"key",requestKey,"hash",fingerprint)); db.insertProject(p);
        Map<String,Object> row=db.createdProject(owner,requestKey);
        if(!fingerprint.equals(row.get("create_request_hash"))) throw new ApiException(409,"创建请求编号已用于不同内容，请使用新的请求编号");
        String actual=string(row,"id");
        if(candidate.equals(actual)) {
            db.parameters(actual,encode(p.get("parameters")));
            audit(owner,"project",actual,"create",map("name",p.get("name"),"workbenchId",workbench,"ontologyVersionId",p.get("version")));
        }
        return projectView(required(db.project(owner,actual),"项目"));
    }
    @Transactional(readOnly=true)
    public Map<String,Object> project(String owner,String id) {
        Map<String,Object> row=required(db.project(owner,id),"项目"),out=map("project",projectView(row),"workbench",get(owner,string(row,"workbench_id")),
            "workbenchVersion",versionView(required(db.version(string(row,"workbench_id"),string(row,"ontology_version_id")),"发布版本"),true));
        for(String key:Arrays.asList("sessions","files")) out.put(key,Collections.emptyList());
        out.put("knowledgeBases",knowledge.references(owner,"project",id));
        out.put("usage",map("series",Collections.emptyList(),"days",Collections.emptyList(),"totalTokens",null,"cost",null,"avgPerTask",null,"successRate",null));
        out.put("capabilities",map("execution",true,"resources",true)); return out;
    }
    @Transactional
    public Map<String,Object> updateProject(String owner,String id,JsonNode body) {
        fields(body,"name","desc","status","revision"); Map<String,Object> row=required(db.project(owner,id),"项目");
        lock(owner,string(row,"workbench_id"));row=required(db.project(owner,id),"项目");long revision=revision(body); sameRevision(row,revision);
        String name=body.has("name")?text(body,"name",160,true):string(row,"name"),desc=body.has("desc")?text(body,"desc",2000,false):string(row,"description");
        String status=body.has("status")?text(body,"status",16,true):string(row,"status");
        if(!Arrays.asList("active","paused","archived").contains(status)) throw new ApiException(422,"项目状态不正确");
        db.lockProjectForTasks(owner,id);
        if("archived".equals(status)&&tasks.hasActive(owner,id))throw new ApiException(409,"项目仍有未结束的任务，请先停止或等待完成再归档");
        changed(db.updateProject(map("id",id,"owner",owner,"revision",revision,"name",name,"desc",desc,"status",status)));
        Map<String,Object> saved=required(db.project(owner,id),"项目");
        audit(owner,"project",id,"update",map("name",name,"status",status,"revision",revision+1)); return projectView(saved);
    }
}
