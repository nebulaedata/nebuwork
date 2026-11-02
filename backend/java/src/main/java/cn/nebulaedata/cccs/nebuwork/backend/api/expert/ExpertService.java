package cn.nebulaedata.cccs.nebuwork.backend.api.expert;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelProviderService;
import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeService;
import cn.nebulaedata.cccs.nebuwork.backend.api.workflow.WorkflowService;
import cn.nebulaedata.cccs.nebuwork.backend.api.workflow.WorkflowSettings;
import org.springframework.beans.factory.annotation.Autowired;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentClient;
import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentUsage;
import javax.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;


import org.springframework.web.multipart.MultipartFile;
import java.io.*;


import java.sql.Timestamp;
import java.time.*;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Configuration drafts only. No execution or fabricated metrics. */
@Service
public class ExpertService {
    private final ExpertMapper db;
    private final ModelProviderService models;
    private final KnowledgeService knowledge;
    private final ObjectMapper json;
    private final AgentClient engine;
    private final AgentUsage usage;
    @Autowired(required=false) private cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentStore runtimeStore;
    private WorkflowService workflows;
    private WorkflowSettings workflowSettings;
    @Autowired public void useWorkflow(WorkflowService workflows,WorkflowSettings settings) { this.workflows=workflows;this.workflowSettings=settings; }
    public ExpertService(ExpertMapper db,ModelProviderService models,KnowledgeService knowledge,ObjectMapper json,AgentClient engine,AgentUsage usage) {
        this.db=db; this.models=models; this.knowledge=knowledge; this.json=json; this.engine=engine;this.usage=usage;
    }
    public static String id(String prefix) { return prefix+"-"+UUID.randomUUID().toString().replace("-",""); }
    private Map<String,Object> required(Map<String,Object> row,String kind) {
        if(row==null) throw new ApiException(404,kind+"不存在"); return row;
    }
    private String str(Map<String,Object> row,String key) { return Objects.toString(row.get(key),""); }
    private long number(Map<String,Object> row,String key) {
        Object v=row.get(key); return v==null?0:((Number)v).longValue();
    }
    private ObjectNode object(JsonNode n) {
        if(n==null || !n.isObject()) throw new ApiException(422,"配置必须是 JSON 对象"); return (ObjectNode)n;
    }
    private String text(JsonNode p,String key,int max,boolean mandatory) {
        JsonNode v=p.get(key);
        if(v!=null&&!v.isNull()&&!v.isTextual()) throw new ApiException(422,key+" 必须是文本");
        String s=v==null||v.isNull()?"":v.asText().trim();
        if((mandatory&&s.isEmpty())||s.length()>max) throw new ApiException(422,key+" 不能为空或超过长度限制 "+max);
        return s;
    }
    private long revision(JsonNode p) {
        if(!p.has("revision") || !p.get("revision").isIntegralNumber() || !p.get("revision").canConvertToLong() || p.get("revision").asLong()<1)
            throw new ApiException(422,"缺少有效 revision");
        return p.get("revision").asLong();
    }
    private void changed(int count) { if(count!=1) throw new ApiException(409,"配置已被其他操作修改，请重新加载后再保存"); }
    private String serialized(Object value) {
        try { return json.writeValueAsString(value); } catch(Exception e) { throw new IllegalStateException(e); }
    }
    private ObjectNode parsed(Object value) {
        try { return object(json.readTree(value.toString())); } catch(Exception e) { throw new IllegalStateException("Invalid stored configuration",e); }
    }
    private String time(Object value) {
        if(value instanceof Timestamp) return ((Timestamp)value).toInstant().toString();
        return value==null?"":value.toString();
    }
    private String color(JsonNode p) {
        String v=p.path("color").asText("#6C63F0");
        if(!v.matches("#[0-9a-fA-F]{6}")) throw new ApiException(422,"颜色格式不正确"); return v;
    }
    private void audit(String actor,String type,String object,String action,Object change) {
        db.audit(map("id",id("audit"),"actor",actor,"type",type,"object",object,"action",action,"change",serialized(change)));
    }
    public void assertVisible(String expert,String actor) { required(db.visibleExpert(actor,expert),"专家"); }
    private Map<String,Object> lockExpert(String expert,String actor) {
        Map<String,Object> row=required(db.lockExpert(expert),"专家");assertVisible(expert,actor);return row;
    }
    private boolean removed(Map<String,Object> membership) {
        Object value=membership==null?null:membership.get("removed");
        return Boolean.TRUE.equals(value)||(value instanceof Number&&((Number)value).intValue()!=0);
    }
    private long membershipRevision(Map<String,Object> membership) { return membership==null?0:number(membership,"revision"); }
    private Map<String,Object> visibleProfile(Map<String,Object> row,String actor) {
        Map<String,Object> result=profile(row);result.put("membershipRevision",membershipRevision(db.membership(actor,str(row,"id"))));
        result.put("kbIds",knowledge.referenceIds(actor,"expert",str(row,"id")));return result;
    }
    public Map<String,Object> profile(Map<String,Object> row) {
        String expert=str(row,"id"); List<String> steps=new ArrayList<>(),plugins=new ArrayList<>();
        for(Map<String,Object> s:db.sops(expert)) {
            ObjectNode d=parsed(s.get("definition_json"));
            for(JsonNode n:d.path("process".equals(s.get("kind"))?"steps":"nodes")) steps.add(n.path("t").asText());
        }
        for(String ext:db.extensionIds(expert)) plugins.add(str(required(db.extension(ext),"扩展"),"name"));
        return map("id",expert,"name",row.get("name"),"role",row.get("role_label"),"tagline",row.get("tagline"),
            "model",row.get("model_name"),"modelProviderId",row.get("model_provider_id"),"initials",row.get("initials"),"color",row.get("color"),
            "revision",number(row,"revision"),"sourceMarketId",row.get("source_market_id"),"level",1,"xp",0,"sop",steps,"kbIds",Collections.emptyList(),"plugins",plugins,
            "stats",usage.unavailable());
    }
    @Transactional(readOnly=true)
    public List<Map<String,Object>> list(String actor) {
        List<Map<String,Object>> result=new ArrayList<>(); for(Map<String,Object> row:db.visibleExperts(actor)) result.add(visibleProfile(row,actor)); usage.expertProfiles(actor,result);return result;
    }
    @Transactional(readOnly=true)
    public Map<String,Object> detail(String expert,String actor) {
        return detail(expert,actor,0);
    }
    @Transactional(readOnly=true)
    public Map<String,Object> detail(String expert,String actor,int offset) {
        Map<String,Object> a=visibleProfile(required(db.visibleExpert(actor,expert),"专家"),actor);
        List<Map<String,Object>> ext=new ArrayList<>(),tpl=new ArrayList<>();
        Set<String> extIds=new HashSet<>(db.extensionIds(expert)),tplIds=new HashSet<>(db.templateIds(expert));
        for(Map<String,Object> x:extensions()) if(extIds.contains(x.get("id"))) ext.add(x);
        for(Map<String,Object> x:templates()) if(tplIds.contains(x.get("id"))) tpl.add(x);
        Map<String,Object> activity=usage.expert(actor,expert,offset);a.put("stats",activity.get("stats"));
        Map<String,Object> result=map("agent",a,"sopSets",sops(expert,actor),"ruleSets",ruleSets(expert),"rules",rules(expert),
            "extensions",ext,"templates",tpl,"knowledgeBases",knowledge.references(actor,"expert",expert),
            "growth",Collections.emptyList());
        if(runtimeStore!=null){Map<String,Object> runtime=runtimeStore.draft(actor,"expert",expert);JsonNode document=runtime==null?json.createObjectNode():cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.decode(json,runtime.get("document_json"));result.put("runtimeExtensionCount",document.path("skills").size()+document.path("mcp").size()+document.path("extensionRefs").size());}
        result.putAll(activity);return result;
    }
    @Transactional
    public Map<String,Object> create(JsonNode payload,String actor) {
        ObjectNode p=object(payload).deepCopy();
        String provider=text(p,"modelProviderId",64,true);
        Map<String,Object> selected=models.selectForExpert(actor,provider);
        // The verified provider determines the display name; client-supplied names/owners are not trusted.
        p.put("modelProviderId",provider).put("model",selected.get("model").toString());
        p.retain("name","role","tagline","color","model","modelProviderId");
        return createInternal(p,actor,null);
    }
    @Transactional
    public Map<String,Object> update(String expert,JsonNode payload,String actor) {
        ObjectNode p=object(payload);long expected=revision(p);
        Set<String> allowed=new HashSet<>(Arrays.asList("revision","name","role","tagline","modelProviderId"));
        p.fieldNames().forEachRemaining(field->{if(!allowed.contains(field))throw new ApiException(422,"不支持的专家设置字段");});
        if(p.size()<2)throw new ApiException(422,"没有需要保存的专家设置");
        // Keep model-settings -> expert lock order consistent with provider deletion.
        Map<String,Object> selected=p.has("modelProviderId")?models.selectForExpert(actor,text(p,"modelProviderId",64,true)):null;
        Map<String,Object> row=lockExpert(expert,actor);if(number(row,"revision")!=expected)changed(0);
        String name=p.has("name")?text(p,"name",160,true):str(row,"name");
        String role=p.has("role")?text(p,"role",240,false):str(row,"role_label");
        changed(db.updateExpert(map("id",expert,"revision",expected,"name",name,"role",role.isEmpty()?"通用专家":role,
            "tagline",p.has("tagline")?text(p,"tagline",2000,false):str(row,"tagline"),
            "model",selected==null?row.get("model_name"):selected.get("model"),"modelProviderId",selected==null?row.get("model_provider_id"):selected.get("id"),
            "initials",new String(Character.toChars(name.codePointAt(0))))));
        audit(actor,"expert",expert,"update",map("before",map("name",row.get("name"),"role",row.get("role_label"),"tagline",row.get("tagline"),"modelProviderId",row.get("model_provider_id")),"patch",p));
        return visibleProfile(db.expert(expert),actor);
    }
    private Map<String,Object> createInternal(ObjectNode p,String actor,String source) {
        String name=text(p,"name",160,true),model=text(p,"model",255,true),role=text(p,"role",240,false),expert=id("agent");
        db.insertExpert(map("id",expert,"name",name,"role",role.isEmpty()?"通用专家":role,
            "tagline",text(p,"tagline",2000,false),"model",model,"modelProviderId",p.hasNonNull("modelProviderId")?p.get("modelProviderId").asText():null,
            "initials",new String(Character.toChars(name.codePointAt(0))),"color",color(p),"source",source));
        audit(actor,"expert",expert,"create",p); return visibleProfile(db.expert(expert),actor);
    }
    public List<Map<String,Object>> sops(String expert) {
        required(db.expert(expert),"专家"); List<Map<String,Object>> result=new ArrayList<>();
        for(Map<String,Object> row:db.sops(expert)) result.add(sopDto(row)); return result;
    }
    public List<Map<String,Object>> sops(String expert,String actor) {
        List<Map<String,Object>> result=sops(expert);
        if(workflows!=null)for(Map<String,Object> sop:result)if("workflow".equals(sop.get("kind")))sop.put("workflow",workflows.forSop(actor,sop.get("id").toString()));
        return result;
    }
    private Map<String,Object> actorSop(String expert,String sop,String actor) {
        Map<String,Object> result=sopDto(required(db.sop(expert,sop),"SOP"));
        if(workflows!=null&&"workflow".equals(result.get("kind")))result.put("workflow",workflows.forSop(actor,sop));return result;
    }
    @Transactional public Object createWorkflowSop(String expert,JsonNode payload,String actor,String requestKey) {
        assertVisible(expert,actor);Map<String,Object> request=workflowSettings.reserve(actor,requestKey,"sop-create:"+expert,payload);
        if(request.get("result_json")!=null)return workflowSettings.decode(request.get("result_json"));
        Map<String,Object> sop=createSop(expert,payload,actor);String sopId=sop.get("id").toString();
        Map<String,Object> workflow=workflows.insert(actor,text(payload,"name",160,true),text(payload,"desc",2000,false));
        workflows.link(actor,sopId,workflow.get("id").toString());Object result=actorSop(expert,sopId,actor);workflowSettings.finish(actor,requestKey,result);return result;
    }
    @Transactional public Object createSopWorkflow(String expert,String sop,JsonNode payload,String actor,String requestKey) {
        lockExpert(expert,actor);Map<String,Object> row=required(db.sop(expert,sop),"SOP");
        if(!"workflow".equals(row.get("kind")))throw new ApiException(422,"仅工作流 SOP 可以新建真实工作流");
        Map<String,Object> request=workflowSettings.reserve(actor,requestKey,"sop-workflow:"+sop,payload);
        if(request.get("result_json")!=null)return workflowSettings.decode(request.get("result_json"));
        if(number(row,"revision")!=revision(payload))changed(0);
        if(workflows.forSop(actor,sop)==null) {
            Map<String,Object> workflow=workflows.insert(actor,str(row,"name"),str(row,"description"));workflows.link(actor,sop,workflow.get("id").toString());
        }
        Object result=actorSop(expert,sop,actor);workflowSettings.finish(actor,requestKey,result);return result;
    }
    private Map<String,Object> sopDto(Map<String,Object> row) {
        String kind=str(row,"kind"),sop=str(row,"id"); ObjectNode d=parsed(row.get("definition_json"));
        if("workflow".equals(kind)&&!d.has("edges")) d.set("edges",sequentialEdges(d.path("nodes")));
        List<Map<String,Object>> refs=new ArrayList<>();
        if("process".equals(kind)) {
            ArrayNode names=json.createArrayNode();
            for(Map<String,Object> m:db.materials(sop)) {
                names.add(str(m,"display_name"));
                refs.add(map("id",m.get("id"),"name",m.get("display_name"),"status",m.get("artifact_id")!=null?"available":"missing","size",m.get("byte_size")));
            }
            d.set("materials",names);
        }
        return map("id",sop,"name",row.get("name"),"kind",kind,"desc",row.get("description"),
            "updatedAt",time(row.get("updated_at")),"revision",number(row,"revision"),"process".equals(kind)?"proc":"wf",d,"materialRefs",refs);
    }
    private ArrayNode sequentialEdges(JsonNode nodes) {
        ArrayNode edges=json.createArrayNode();
        for(int i=1;i<nodes.size();i++) edges.addObject().put("id","legacy-edge-"+i)
            .put("source",nodes.get(i-1).path("id").asText()).put("target",nodes.get(i).path("id").asText());
        return edges;
    }
    private void validateEdges(ObjectNode definition,Set<String> nodes) {
        if(!definition.has("edges")) definition.set("edges",sequentialEdges(definition.path("nodes")));
        JsonNode edges=definition.path("edges"); Set<String> ids=new HashSet<>(),pairs=new HashSet<>();
        if(!edges.isArray()||edges.size()>1000) throw new ApiException(422,"连线必须是数组且不超过 1000 条");
        for(JsonNode value:edges) {
            ObjectNode edge=object(value);
            String edgeId=text(edge,"id",64,true),source=text(edge,"source",64,true),target=text(edge,"target",64,true);
            if(!edgeId.matches("[a-zA-Z0-9_-]+")||!ids.add(edgeId)) throw new ApiException(422,"连线 ID 无效或重复");
            if(!nodes.contains(source)||!nodes.contains(target)) throw new ApiException(422,"连线引用的节点不存在");
            if(source.equals(target)) throw new ApiException(422,"不能连接节点自身");
            if(!pairs.add(source+":"+target)) throw new ApiException(422,"不能重复连接相同节点");
            edge.put("id",edgeId); edge.put("source",source); edge.put("target",target); edge.retain("id","source","target");
        }
    }
    private ObjectNode definition(String kind,JsonNode incoming) {
        ObjectNode d=object(incoming).deepCopy(); Set<String> ids=new HashSet<>();
        JsonNode nodes=d.path("workflow".equals(kind)?"nodes":"steps");
        if(!nodes.isArray()||nodes.size()>200) throw new ApiException(422,"步骤或节点必须是数组且不超过 200 项");
        for(JsonNode n:nodes) {
            ObjectNode node=object(n); node.put("t",text(node,"t",160,true)); node.put("d",text(node,"d",8000,false));
            String nodeId=node.has("id")?text(node,"id",64,true):id("node");
            if(!nodeId.matches("[a-zA-Z0-9_-]+")||!ids.add(nodeId)) throw new ApiException(422,"节点 ID 无效或重复"); node.put("id",nodeId);
            for(String coord:Arrays.asList("x","y")) if(node.has(coord)) {
                double value=node.path(coord).asDouble(-1);
                if(!node.get(coord).isNumber()||!Double.isFinite(value)||value<0||value>100000) throw new ApiException(422,"节点坐标不正确");
            }
            if(node.has("sys")) node.put("sys",text(node,"sys",240,false));
            if(node.has("rpa")&&!node.get("rpa").isBoolean()) throw new ApiException(422,"rpa 必须为布尔值");
        }
        if("workflow".equals(kind)) {
            for(String key:Arrays.asList("source","rules","input","output")) d.put(key,text(d,key,16000,false));
            validateEdges(d,ids);
            d.retain("nodes","edges","source","rules","input","output");
        } else {
            for(String key:Arrays.asList("source","rules","input","output")) if(d.has(key)) d.put(key,text(d,key,16000,false));
            JsonNode specs=d.path("specRefs");
            if(!specs.isArray()||specs.size()>200) throw new ApiException(422,"规范引用格式不正确");
            for(JsonNode spec:specs) if(!spec.isTextual()||spec.asText().trim().isEmpty()||spec.asText().length()>500) throw new ApiException(422,"规范名称格式不正确");
            d.remove("materials"); d.retain("steps","specRefs","source","rules","input","output");
        }
        if(serialized(d).length()>500000) throw new ApiException(422,"SOP 配置过大"); return d;
    }
    @Transactional
    public Map<String,Object> createSop(String expert,JsonNode payload,String actor) {
        lockExpert(expert,actor); ObjectNode p=object(payload); String kind=text(p,"kind",16,true);
        if(!Arrays.asList("workflow","process").contains(kind)) throw new ApiException(422,"SOP 类型不正确");
        ObjectNode d=json.createObjectNode();
        if("workflow".equals(kind)) { d.putArray("nodes"); d.putArray("edges"); for(String k:Arrays.asList("source","rules","input","output")) d.put(k,""); }
        else { d.putArray("steps"); d.putArray("specRefs"); }
        String key="workflow".equals(kind)?"wf":"proc"; if(p.has(key)) d=definition(kind,p.get(key));
        String sop=id("sop");
        db.insertSop(map("id",sop,"expert",expert,"name",text(p,"name",160,true),"kind",kind,"description",text(p,"desc",2000,false),"definition",serialized(d),"sort",db.sops(expert).size()));
        db.touchExpert(expert); audit(actor,"sop",sop,"create",p); return sopDto(db.sop(expert,sop));
    }
    @Transactional
    public Map<String,Object> updateSop(String expert,String sop,JsonNode payload,String actor) {
        lockExpert(expert,actor); Map<String,Object> row=required(db.sop(expert,sop),"SOP"); ObjectNode p=object(payload); String kind=str(row,"kind");
        if(p.has("kind")&&!kind.equals(p.path("kind").asText())) throw new ApiException(422,"不能修改 SOP 形态");
        String key="workflow".equals(kind)?"wf":"proc"; ObjectNode d=parsed(row.get("definition_json"));
        if(p.has(key)) {
            ObjectNode incoming=object(p.get(key)).deepCopy();
            if("process".equals(kind)) for(String field:Arrays.asList("source","rules","input","output")) {
                if(!incoming.has(field)&&d.has(field)) incoming.set(field,d.get(field));
            }
            // Older clients omit edges. Preserve the saved graph, dropping only links to removed nodes.
            if("workflow".equals(kind)&&!incoming.has("edges")) {
                JsonNode previous=d.has("edges")?d.path("edges"):sequentialEdges(d.path("nodes"));
                Set<String> remaining=new HashSet<>(); for(JsonNode node:incoming.path("nodes")) remaining.add(node.path("id").asText());
                ArrayNode retained=incoming.putArray("edges");
                for(JsonNode edge:previous) if(remaining.contains(edge.path("source").asText())&&remaining.contains(edge.path("target").asText())) retained.add(edge.deepCopy());
            }
            d=definition(kind,incoming);
        }
        changed(db.updateSop(map("id",sop,"expert",expert,"name",p.has("name")?text(p,"name",160,true):row.get("name"),
            "description",p.has("desc")?text(p,"desc",2000,false):row.get("description"),"definition",serialized(d),"revision",revision(p))));
        db.touchExpert(expert); audit(actor,"sop",sop,"update",map("before",sopDto(row),"patch",p)); return actorSop(expert,sop,actor);
    }
    @Transactional
    public void deleteSop(String expert,String sop,long revision,String actor) {
        lockExpert(expert,actor); Map<String,Object> row=required(db.sop(expert,sop),"SOP"); if(number(row,"revision")!=revision) changed(0);
        Map<String,Object> before=sopDto(row); if(workflows!=null)workflows.unlinkSop(sop);db.deleteMaterials(sop); changed(db.deleteSop(expert,sop,revision));
        db.touchExpert(expert); audit(actor,"sop",sop,"delete",before);
        // File bytes retained: unlinking must not destroy other references.
    }
    public List<Map<String,Object>> ruleSets(String expert) {
        required(db.expert(expert),"专家"); List<Map<String,Object>> result=new ArrayList<>();
        for(Map<String,Object> r:db.ruleSets(expert)) result.add(map("id",r.get("id"),"name",r.get("name"),"desc",r.get("description"),"revision",number(r,"revision"))); return result;
    }
    @Transactional
    public Map<String,Object> createRuleSet(String expert,JsonNode payload,String actor) {
        lockExpert(expert,actor); ObjectNode p=object(payload); String name=text(p,"name",160,true);
        if(db.ruleSetByName(expert,name)!=null) throw new ApiException(409,"规则集已存在"); String set=id("rs");
        db.insertRuleSet(map("id",set,"expert",expert,"name",name,"description",text(p,"desc",2000,false)));
        db.touchExpert(expert); audit(actor,"rule_set",set,"create",p); return map("id",set,"name",name,"desc",text(p,"desc",2000,false),"revision",1);
    }
    private String resolveRuleSet(String expert,ObjectNode p,String actor) {
        if(p.hasNonNull("ruleSetId")) return str(required(db.ruleSet(expert,text(p,"ruleSetId",64,true)),"规则集"),"id");
        String scene=text(p,"scene",160,true); Map<String,Object> set=db.ruleSetByName(expert,scene); if(set!=null) return str(set,"id");
        String id=id("rs"); db.insertRuleSet(map("id",id,"expert",expert,"name",scene,"description","")); audit(actor,"rule_set",id,"create",map("name",scene)); return id;
    }
    private Map<String,Object> ruleDto(Map<String,Object> r) {
        Object enabled=r.get("enabled");
        return map("id",r.get("id"),"ruleSetId",r.get("rule_set_id"),"name",r.get("name"),"scene",r.get("scene"),"content",r.get("content"),
            "enabled",Boolean.TRUE.equals(enabled)||(enabled instanceof Number&&((Number)enabled).intValue()!=0),
            "revision",number(r,"revision"),"hits",0,"updatedAt",time(r.get("updated_at")));
    }
    public List<Map<String,Object>> rules(String expert) {
        required(db.expert(expert),"专家"); List<Map<String,Object>> result=new ArrayList<>();
        for(Map<String,Object> r:db.rules(expert)) result.add(ruleDto(r)); return result;
    }
    @Transactional
    public Map<String,Object> saveRule(String expert,String rule,JsonNode payload,String actor) {
        lockExpert(expert,actor); ObjectNode p=object(payload); Map<String,Object> before=rule==null?null:required(db.rule(expert,rule),"规则");
        if(p.has("enabled")&&!p.get("enabled").isBoolean()) throw new ApiException(422,"enabled 必须为布尔值");
        String set=(p.has("ruleSetId")||p.has("scene")||before==null)?resolveRuleSet(expert,p,actor):str(before,"rule_set_id"),ruleId=rule==null?id("rule"):rule;
        Map<String,Object> values=map("id",ruleId,"expert",expert,"ruleSetId",set,
            "name",p.has("name")||before==null?text(p,"name",160,true):before.get("name"),
            "content",p.has("content")||before==null?text(p,"content",50000,true):before.get("content"),
            "enabled",p.has("enabled")?p.path("enabled").asBoolean():before==null||Boolean.TRUE.equals(ruleDto(before).get("enabled")));
        if(before==null) db.insertRule(values); else { values.put("revision",revision(p)); changed(db.updateRule(values)); }
        db.touchExpert(expert); audit(actor,"rule",ruleId,before==null?"create":"update",map("before",before==null?null:ruleDto(before),"patch",p)); return ruleDto(db.rule(expert,ruleId));
    }
    @Transactional
    public void deleteRule(String expert,String rule,long revision,String actor) {
        lockExpert(expert,actor); Map<String,Object> before=required(db.rule(expert,rule),"规则"); changed(db.deleteRule(expert,rule,revision));
        db.touchExpert(expert); audit(actor,"rule",rule,"delete",ruleDto(before));
    }
    public List<Map<String,Object>> extensions() {
        List<Map<String,Object>> result=new ArrayList<>();
        for(Map<String,Object> r:db.extensions()) result.add(map("id",r.get("id"),"name",r.get("name"),"kind",r.get("kind"),"desc",r.get("description"),"version",r.get("version_label"),"color",r.get("color"),"installs",0,"bindings",number(r,"bindings"),"installed",false,"status","historical_reference")); return result;
    }
    public List<Map<String,Object>> templates() {
        List<Map<String,Object>> result=new ArrayList<>();
        for(Map<String,Object> r:db.templates()) result.add(map("id",r.get("id"),"name",r.get("name"),"scene",r.get("scene"),"desc",r.get("description"),"color",r.get("color"),"uses",0,"agents",r.get("agent_count"),"bindings",number(r,"bindings"))); return result;
    }
    @Transactional
    public Map<String,Object> binding(String expert,String target,boolean extension,boolean bind,String actor) {
        if(extension)throw new ApiException(409,"旧扩展绑定仅为历史引用，请通过扩展市场安装到运行资源草稿");
        lockExpert(expert,actor); required(extension?db.extension(target):db.template(target),extension?"扩展":"模板");
        boolean exists=(extension?db.extensionIds(expert):db.templateIds(expert)).contains(target);
        if(bind!=exists) {
            if(extension) { if(bind) db.bindExtension(expert,target); else db.unbindExtension(expert,target); }
            else { if(bind) db.bindTemplate(expert,target); else db.unbindTemplate(expert,target); }
            db.touchExpert(expert); audit(actor,extension?"expert_extension":"expert_case",expert,bind?"bind":"unbind",map("targetId",target));
        }
        return detail(expert,actor);
    }
    @Transactional(readOnly=true)
    public List<Map<String,Object>> marketExperts(String actor) {
        List<Map<String,Object>> result=new ArrayList<>();
        for(Map<String,Object> r:db.marketExperts()) {
            Map<String,Object> hired=db.hired(str(r,"id")),membership=hired==null?null:db.membership(actor,str(hired,"id"));
            if(removed(membership))hired=null;
            result.add(map("id",r.get("id"),"name",r.get("name"),"role",r.get("role_label"),"tagline",r.get("tagline"),
                "color",r.get("color"),"model",r.get("model_name"),"installs",0,"rating",null,"hiredAgentId",hired==null?null:hired.get("id"),
                "hiredAgentRevision",hired==null?null:hired.get("revision"),"hiredMembershipRevision",membershipRevision(membership)));
        } return result;
    }
    @Transactional(isolation=Isolation.READ_COMMITTED)
    public Map<String,Object> hire(String market,String actor) {
        Map<String,Object> r=required(db.marketExpert(market),"市场专家"),existing=db.hired(market);
        if(existing!=null) {
            String expert=str(existing,"id");existing=required(db.lockExpert(expert),"专家");
            if(removed(db.membership(actor,expert))) {
                db.membershipState(actor,expert,false);audit(actor,"expert_membership",expert,"restore",map("marketId",market));
            }
            return visibleProfile(existing,actor);
        }
        ObjectNode p=json.createObjectNode(); p.put("name",str(r,"name")).put("role",str(r,"role_label")).put("tagline",str(r,"tagline")).put("color",str(r,"color")).put("model",str(r,"model_name"));
        return createInternal(p,actor,market);
    }
    @Transactional(isolation=Isolation.READ_COMMITTED)
    public Map<String,Object> remove(String expert,long revision,long membershipRevision,String actor) {
        if(revision<1||membershipRevision<0)throw new ApiException(422,"请提供有效的专家版本和列表状态版本");
        Map<String,Object> row=required(db.lockExpert(expert),"专家");
        String market=str(row,"source_market_id");
        // All expert definitions are shared; deleting a custom/preset expert is account-scoped too.
        String action=market.isEmpty()?"delete":"remove";
        Map<String,Object> membership=db.membership(actor,expert);long current=membershipRevision(membership);
        if(removed(membership)&&current==membershipRevision+1)return map("id",expert,"sourceMarketId",market.isEmpty()?null:market,"removed",true,"membershipRevision",current);
        if(current!=membershipRevision||removed(membership)||number(row,"revision")!=revision)
            throw new ApiException(409,"专家配置或列表状态已变化，请刷新后重试");
        List<String> references=db.referencingWorkbenches(actor,expert);
        if(!references.isEmpty())throw new ApiException(409,"请先在工作台解除该专家引用："+String.join("、",references));
        db.membershipState(actor,expert,true);
        audit(actor,"expert_membership",expert,action,map("marketId",market.isEmpty()?null:market,"membershipRevision",current+1));
        return map("id",expert,"sourceMarketId",market.isEmpty()?null:market,"removed",true,"membershipRevision",current+1);
    }
    @Transactional(rollbackFor=Exception.class)
    public Map<String,Object> upload(String expert,String sop,long revision,MultipartFile file,String actor) throws IOException {
        lockExpert(expert,actor); Map<String,Object> row=required(db.sop(expert,sop),"SOP");
        if(!"process".equals(row.get("kind"))) throw new ApiException(422,"仅标准流程支持参考素材");
        if(file.isEmpty()||file.getSize()>20*1024*1024) throw new ApiException(422,"文件为空或超过 20MB");
        String name=Objects.toString(file.getOriginalFilename(),"素材").replace('\\','/'); name=name.substring(name.lastIndexOf('/')+1).replaceAll("[\\p{Cntrl}]","");
        if(name.isEmpty()||name.length()>255) throw new ApiException(422,"文件名不正确");
        changed(db.touchSop(expert,sop,revision)); String material=id("mat"),project="expert-"+expert;
        JsonNode artifact=engine.post(actor,project,"/v1/projects/"+AgentClient.segment(project)+"/artifacts",map("name",name,"mediaType",Objects.toString(file.getContentType(),"application/octet-stream"),"contentBase64",Base64.getEncoder().encodeToString(file.getBytes())),"sop:"+sop+":"+revision);
        db.insertMaterial(map("id",material,"sop",sop,"name",name,"artifact",artifact.path("id").asText(),"version",artifact.path("version").asInt(),"owner",actor,"size",artifact.path("size").asLong(),"sha256",artifact.path("sha256").asText()));db.touchExpert(expert);
        audit(actor,"sop_material",material,"upload",map("sopId",sop,"artifactId",artifact.path("id").asText(),"name",name));return sopDto(db.sop(expert,sop));
    }

    @Transactional
    public Map<String,Object> removeMaterial(String expert,String sop,String material,long revision,String actor) {
        lockExpert(expert,actor); required(db.sop(expert,sop),"SOP"); Map<String,Object> before=required(db.material(sop,material),"素材");
        changed(db.touchSop(expert,sop,revision)); db.deleteMaterial(sop,material); db.touchExpert(expert);
        audit(actor,"sop_material",material,"unlink",map("sopId",sop,"name",before.get("display_name"),"artifactId",before.get("artifact_id"))); return sopDto(db.sop(expert,sop));
    }
    public void download(String expert,String sop,String material,String actor,HttpServletResponse response,String range,String etag)throws IOException {
        assertVisible(expert,actor);required(db.sop(expert,sop),"SOP");Map<String,Object> row=required(db.material(sop,material),"素材");
        if(row.get("artifact_id")==null)throw new ApiException(404,"该素材尚未上传文件");
        engine.content(str(row,"artifact_owner_id"),"expert-"+expert,str(row,"artifact_id"),(int)number(row,"artifact_version"),range,etag,response);
    }
}
