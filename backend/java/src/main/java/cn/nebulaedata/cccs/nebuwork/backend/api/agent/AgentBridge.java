package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.extensionmarket.ExtensionMarket;
import cn.nebulaedata.cccs.nebuwork.backend.api.extensionmarket.ExtensionRuntime;
import cn.nebulaedata.cccs.nebuwork.backend.api.expert.ExpertMapper;
import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeService;
import cn.nebulaedata.cccs.nebuwork.backend.api.memory.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.workflow.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.workbench.WorkbenchMapper;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Trusted HTTP context boundary. Every callback verifies the engine's own run identity. */
@Service
public class AgentBridge {
    @org.springframework.beans.factory.annotation.Autowired(required=false) private ExtensionMarket market;
    @org.springframework.beans.factory.annotation.Autowired private cn.nebulaedata.cccs.nebuwork.backend.api.database.DatabaseRuntime databases;
    @org.springframework.beans.factory.annotation.Autowired private cn.nebulaedata.cccs.nebuwork.backend.api.platformmcp.PlatformMcpService platformMcp;
    @org.springframework.beans.factory.annotation.Autowired private cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice.ServiceOperations serviceOperations;
    private final AgentSettings settings;private final AgentClient engine;private final AgentStore db;private final AgentTasks tasks;
    private final RuntimeResources resources;private final AgentModels models;private final WorkbenchMapper projects;private final ExpertMapper experts;
    private final KnowledgeEvidence evidence;private final KnowledgeService knowledge;private final WorkflowService workflows;private final WorkflowSettings workflowSettings;
    private final MemoryService memory;private final MemoryScopes memoryScopes;private final MemorySettings memorySettings;private final ObjectMapper json;private final TransactionTemplate tx;
    public AgentBridge(AgentSettings settings,AgentClient engine,AgentStore db,AgentTasks tasks,RuntimeResources resources,AgentModels models,WorkbenchMapper projects,ExpertMapper experts,KnowledgeService knowledge,WorkflowService workflows,WorkflowSettings workflowSettings,MemoryService memory,MemoryScopes memoryScopes,MemorySettings memorySettings,ObjectMapper json,PlatformTransactionManager manager,KnowledgeEvidence evidence){this.evidence=evidence;this.settings=settings;this.engine=engine;this.db=db;this.tasks=tasks;this.resources=resources;this.models=models;this.projects=projects;this.experts=experts;this.knowledge=knowledge;this.workflows=workflows;this.workflowSettings=workflowSettings;this.memory=memory;this.memoryScopes=memoryScopes;this.memorySettings=memorySettings;this.json=json;this.tx=new TransactionTemplate(manager);}
    private JsonNode run(JsonNode request){String owner=text(request,"ownerId",128,true),project=text(request,"projectId",128,true);if(!settings.tenant().equals(request.path("tenantId").asText()))throw new ApiException(403,"业务命名空间不匹配");tasks.project(owner,project,true);JsonNode run=engine.get(owner,project,"/v1/runs/"+AgentClient.segment(text(request,"runId",128,true)));if(!owner.equals(run.path("ownerId").asText())||!project.equals(run.path("projectId").asText())||!request.path("sessionId").asText().equals(run.path("sessionId").asText())||TERMINAL.contains(run.path("status").asText()))throw new ApiException(403,"执行身份无效或执行已结束");if(request.hasNonNull("manifestHash")&&!request.path("manifestHash").equals(run.path("manifestHash")))throw new ApiException(403,"运行快照不匹配");return run;}
    private Map<String,Object> task(JsonNode run){JsonNode root=run;if(run.hasNonNull("parentRunId"))root=engine.get(run.path("ownerId").asText(),run.path("projectId").asText(),"/v1/runs/"+AgentClient.segment(run.path("parentRunId").asText()));Map<String,Object> task=db.session(root.path("sessionId").asText());if(task==null||!root.path("ownerId").asText().equals(task.get("owner_id")))throw new ApiException(404,"业务任务不存在");return tasks.owned(root.path("ownerId").asText(),str(task,"id"));}
    private ObjectNode document(String owner,String kind,String target,ArrayNode versions){Map<String,Object> active=db.active(owner,kind,target);if(active==null)return RuntimeResources.empty(json);versions.add(json.valueToTree(map("id",active.get("bundle_id"),"version",active.get("bundle_version"),"hash",active.get("content_hash"))));return (ObjectNode)decode(json,active.get("document_json"));}
    private void merge(ObjectNode target,JsonNode source){
        ExtensionMarket.removeShadowed(target,source);
        for(String field:Arrays.asList("instructions","files","skills","mcp","requiredCapabilities")){
            ArrayNode output=target.withArray(field);
            for(JsonNode row:source.path(field)){
                String key="files".equals(field)?"path":"id";
                if(Arrays.asList("files","skills","mcp").contains(field))for(int i=output.size()-1;i>=0;i--)if(output.get(i).path(key).asText().equals(row.path(key).asText()))output.remove(i);
                if(!"requiredCapabilities".equals(field)||!output.toString().contains("\""+row.asText()+"\""))output.add(row.deepCopy());
            }
        }
        if(source.hasNonNull("modelProviderId"))target.set("modelProviderId",source.get("modelProviderId"));
        if(source.path("model").isObject())source.path("model").fields().forEachRemaining(e->target.with("model").set(e.getKey(),e.getValue()));
    }
    private List<Map<String,Object>> memoryScopes(String owner,Map<String,Object> task,Map<String,Object> project){List<Map<String,Object>> scopes=new ArrayList<>();for(String kind:Arrays.asList("user","task","project","workbench")){String id="user".equals(kind)?"self":"task".equals(kind)?str(task,"id"):"project".equals(kind)?str(project,"id"):str(project,"workbench_id");scopes.add(memoryScopes.authorize(owner,kind,id,false));}return scopes;}
    private ArrayNode knowledgeReferences(String owner,String kind,String target){
        ArrayNode out=json.createArrayNode();for(Map<String,Object> ref:knowledge.references(owner,kind,target))if(Boolean.TRUE.equals(ref.get("enabled")))out.add(json.valueToTree(map("id",ref.get("id"),"name",ref.get("name"),"scopeKind",kind,"scopeId",target)));return out;
    }
    private ArrayNode referenceIds(JsonNode references){ArrayNode ids=json.createArrayNode();for(JsonNode ref:references)ids.add(ref.path("id").asText());return ids;}
    public Object context(JsonNode request){
        JsonNode run=run(request);Map<String,Object> task=task(run);String owner=str(task,"owner_id"),projectId=str(task,"project_id");if(!str(task,"id").equals(request.path("taskId").asText()))throw new ApiException(403,"任务身份不匹配");Map<String,Object> project=tasks.project(owner,projectId,true);
        if(serviceOperations!=null&&!run.hasNonNull("parentRunId")){
            ObjectNode serviceManifest=json.valueToTree(map("schemaVersion",1,"tenantId",settings.tenant(),"ownerId",owner,"projectId",projectId,"taskId",task.get("id"),"resolvedAt",Instant.now().toString(),"bundleVersions",Collections.emptyList(),"businessTools",AgentToolCatalog.tools(json,true,false,false),"sessionGrants",Collections.emptyList(),"memory",map("status","disabled","facts",Collections.emptyList(),"problems",Collections.emptyList()),"image",settings.image(),"permissionProfile","full_access"));
            if(serviceOperations.applyManifest(str(task,"id"),serviceManifest)){serviceManifest.set("businessTools",AgentToolCatalog.tools(json,!serviceManifest.path("knowledgeRefs").isEmpty(),false,false));serviceManifest.withArray("businessTools").addAll(serviceOperations.tools(true));databases.addTools(serviceManifest);return serviceManifest;}
        }
        JsonNode business=decode(json,project.get("snapshot_json"));ArrayNode versions=json.createArrayNode();ObjectNode runtime=RuntimeResources.empty(json);
        if(db.active(owner,"workbench",str(project,"workbench_id"))==null)throw new ApiException(422,"工作台尚未发布运行资源");
        ObjectNode workbenchRuntime=document(owner,"workbench",str(project,"workbench_id"),versions),projectRuntime=document(owner,"project",projectId,versions);
        merge(runtime,workbenchRuntime);
        boolean workflow=workflowSettings.current().enabled,mem=memorySettings.enabled();
        ArrayNode projectKnowledge=knowledgeReferences(owner,"project",projectId),allKnowledge=projectKnowledge.deepCopy();
        ArrayNode availableExperts=json.createArrayNode();for(JsonNode expertId:business.path("config").path("agentIds")){
            String expert=expertId.asText();Map<String,Object> definition=experts.visibleExpert(owner,expert);if(definition==null)continue;Map<String,Object> active=db.active(owner,"expert",expert);if(active==null)continue;
            ObjectNode own=document(owner,"expert",expert,versions);StringBuilder instructions=new StringBuilder();for(JsonNode instruction:own.path("instructions"))instructions.append(instruction.path("content").asText()).append('\n');
            ObjectNode effective=ExtensionRuntime.compose(json,workbenchRuntime,own,projectRuntime);
            ArrayNode skillIds=json.createArrayNode();for(JsonNode skill:effective.path("skills"))skillIds.add(skill.path("id").asText());
            ArrayNode expertKnowledge=knowledgeReferences(owner,"expert",expert),childKnowledge=projectKnowledge.deepCopy();childKnowledge.addAll(expertKnowledge);allKnowledge.addAll(expertKnowledge);
            ObjectNode item=json.valueToTree(map("id",expert,"name",definition.get("name"),"instructions",instructions.toString(),"skillIds",skillIds,"runtime",map("instructions",own.path("instructions"),"files",effective.path("files"),"skills",effective.path("skills"),"mcp",effective.path("mcp"),"knowledgeRefs",referenceIds(childKnowledge),"knowledgeReferences",childKnowledge,"businessTools",AgentToolCatalog.tools(json,!childKnowledge.isEmpty(),workflow,mem))));if(own.hasNonNull("modelProviderId"))item.set("model",models.binding(owner,own));availableExperts.add(item);
        }
        ObjectNode override=(ObjectNode)decode(json,task.get("context_json"));if(request.path("input").path("context").isObject())request.path("input").path("context").fields().forEachRemaining(e->override.set(e.getKey(),e.getValue()));
        String mainExpert=override.path("expertId").asText(business.path("config").path("defaultAgentId").asText(""));if(!mainExpert.isEmpty()){JsonNode selected=null;for(JsonNode expert:availableExperts)if(mainExpert.equals(expert.path("id").asText()))selected=expert;if(selected==null)throw new ApiException(422,"所选专家尚未发布运行资源或已撤销授权");merge(runtime,selected.path("runtime"));if(selected.has("model"))runtime.put("modelProviderId",selected.path("model").path("providerId").asText());}
        merge(runtime,projectRuntime);
        for(String field:Arrays.asList("modelProviderId","model"))if(override.has(field))runtime.set(field,override.get(field));
        ArrayNode instructions=runtime.withArray("instructions");instructions.insert(0,json.valueToTree(map("source","workbench-business","path","BUSINESS.md","scope","","content",business.path("config").path("systemPrompt").asText("")+"\n业务定义："+business.path("config").path("bizDef").asText(""),"revision",str(project,"ontology_version_id"))));
        if(project.get("parameters_json")!=null)instructions.add(json.valueToTree(map("source","project-parameters","path","PARAMETERS.md","scope","","content",encode(json,decode(json,project.get("parameters_json"))),"revision",str(project,"revision"))));
        if(override.hasNonNull("instructions"))instructions.add(json.valueToTree(map("source","task","path","TASK.md","scope","","content",text(override,"instructions",24000,false),"revision",fingerprint(override))));
        for(JsonNode required:override.path("requiredSkillIds")){boolean found=false;for(JsonNode skill:runtime.path("skills"))if(required.asText().equals(skill.path("id").asText())){((ObjectNode)skill).put("required",true);found=true;}if(!found)throw new ApiException(422,"任务要求的技能未发布："+required.asText());}
        ArrayNode refs=referenceIds(allKnowledge);
        for(JsonNode required:runtime.path("requiredCapabilities")){String cap=required.asText();if((cap.equals("knowledge")&&refs.isEmpty())||(cap.equals("workflow")&&!workflow)||(cap.equals("memory")&&!mem))throw new ApiException(422,"必需业务能力尚未配置："+cap);}
        Map<String,Object> recall;try{recall=mem?memory.search(owner,memoryScopes(owner,task,project),request.path("input").path("content").asText("")):memory.recallResult("disabled",Collections.emptyList(),Collections.emptyList());}catch(Exception e){recall=memory.recallResult("unavailable",Collections.emptyList(),Collections.singletonList(map("reason","memory_service_unavailable")));}
        for(JsonNode required:runtime.path("requiredCapabilities"))if(required.asText().equals("memory")&&!Arrays.asList("ready","empty").contains(recall.get("status")))throw new ApiException(503,"本轮必需的记忆召回不可用");
        ObjectNode manifest=json.valueToTree(map("schemaVersion",1,"primaryExpertId",mainExpert.isEmpty()?null:mainExpert,"tenantId",settings.tenant(),"ownerId",owner,"projectId",projectId,"taskId",task.get("id"),"resolvedAt",Instant.now().toString(),"bundleVersions",versions,"instructions",instructions,"files",runtime.path("files"),"skills",runtime.path("skills"),"mcp",runtime.path("mcp"),"model",models.binding(owner,runtime),"experts",availableExperts,"businessTools",AgentToolCatalog.tools(json,!refs.isEmpty(),workflow,mem),"knowledgeRefs",refs,"knowledgeReferences",allKnowledge,"sessionGrants",override.path("sessionGrants").isArray()?override.path("sessionGrants"):json.createArrayNode(),"memory",map("status",recall.get("status"),"facts",recall.getOrDefault("results",Collections.emptyList()),"problems",recall.getOrDefault("problems",Collections.emptyList())),"image",settings.image(),"permissionProfile","full_access"));if(platformMcp!=null){JsonNode systemMcp=platformMcp.snapshot(owner,projectId);if(systemMcp!=null)manifest.set("platformMcp",systemMcp);}
        databases.capture(owner,projectId,mainExpert,manifest);if(serviceOperations!=null&&!run.hasNonNull("parentRunId")){serviceOperations.applyManifest(str(task,"id"),manifest);manifest.withArray("businessTools").addAll(serviceOperations.tools(manifest.has("service")));}return manifest;
    }
    public Object credentials(JsonNode request){JsonNode run=run(request),manifest=run.path("manifest");if(serviceOperations!=null)serviceOperations.authorizeRun(task(run),run);if(manifest.has("service")&&"model".equals(request.path("kind").asText())&&!models.matchesEndpoint(run.path("ownerId").asText(),manifest.path("model")))throw new ApiException(403,"服务模型连接地址已改变，请重新发布服务");String owner=run.path("ownerId").asText(),ref=text(request,"credentialRef",128,true);if("model".equals(request.path("kind").asText())&&ref.equals(manifest.path("model").path("credentialRef").asText()))return models.credential(owner,ref);for(JsonNode server:manifest.path("mcp"))if(ref.equals(server.path("credentialRef").asText())){if(ref.startsWith(ExtensionMarket.AUTH_PREFIX)){if(market==null)throw new ApiException(503,"托管扩展认证不可用");return market.credential(request,run,server);}return resources.credential(owner,ref);}throw new ApiException(403,"凭据未包含在本轮运行快照");}
    public Object authorize(JsonNode request){JsonNode run=run(request);Map<String,Object> sourceTask=task(run);if(serviceOperations!=null)serviceOperations.authorizeRun(sourceTask,run);String kind=request.path("kind").asText(),resource=request.path("resourceId").asText();String owner=run.path("ownerId").asText();boolean allowed=!kind.equals("model")||models.allowed(owner,resource);if(kind.equals("mcp")){allowed=resource.startsWith("mcp__nebuwork__")&&platformMcp!=null&&platformMcp.allowed(request,resource.substring("mcp__nebuwork__".length()));for(JsonNode server:run.path("manifest").path("mcp"))if(resource.startsWith("mcp__"+server.path("id").asText()+"__")||resource.equals(server.path("id").asText())){String ref=server.path("credentialRef").asText();if(ref.startsWith(ExtensionMarket.AUTH_PREFIX)){if(market==null)allowed=false;else{market.check(run,server);allowed=true;}}else allowed=!server.hasNonNull("credentialRef")||resources.credentialExists(owner,ref);}}for(JsonNode instruction:run.path("manifest").path("instructions")){String source=instruction.path("source").asText();if(source.startsWith("expert:")&&experts.visibleExpert(owner,source.substring(7))==null)allowed=false;}if(kind.equals("expert"))allowed=experts.visibleExpert(owner,resource)!=null;return map("allowed",allowed);}
    public Object execute(JsonNode request){JsonNode run=run(request);Map<String,Object> task=task(run);String capability=text(request,"capability",32,true),operation=text(request,"operation",64,true),call=text(request,"callId",255,true),owner=run.path("ownerId").asText(),runId=run.path("id").asText();
        if(serviceOperations!=null)serviceOperations.authorizeRun(task,run);
        JsonNode declaration=null;for(JsonNode tool:run.path("manifest").path("businessTools"))if(capability.equals(tool.path("capability").asText())&&operation.equals(tool.path("operation").asText()))declaration=tool;if(declaration==null)throw new ApiException(403,"本轮未声明该业务能力");
        String digest=fingerprint(request.path("arguments"));boolean repeatable=!"reconcile".equals(declaration.path("replay").asText());
        Map<String,Object> prior=tx.execute(status->{db.update("INSERT INTO nw_agent_call(run_id,call_id,owner_id,request_hash,state) VALUES(?,?,?,?,'new') ON DUPLICATE KEY UPDATE run_id=run_id",runId,call,owner,hash(capability+":"+operation+":"+digest));Map<String,Object> saved=db.one("SELECT * FROM nw_agent_call WHERE run_id=? AND call_id=? FOR UPDATE",runId,call);if(!hash(capability+":"+operation+":"+digest).equals(saved.get("request_hash")))throw new ApiException(409,"业务工具调用编号冲突");if("started".equals(saved.get("state"))&&!repeatable)throw new ApiException(409,"上次外部操作结果需要核对");if(!"completed".equals(saved.get("state")))db.update("UPDATE nw_agent_call SET state='started' WHERE run_id=? AND call_id=?",runId,call);return saved;});
        String knowledgeKind="project",knowledgeScope=str(task,"project_id"),knowledgeRef="";
        if("knowledge".equals(capability)){
            knowledgeRef=text(request.path("arguments"),"referenceId",128,true);boolean included=false;for(JsonNode id:run.path("manifest").path("knowledgeRefs"))if(knowledgeRef.equals(id.asText()))included=true;if(!included)throw new ApiException(403,"知识库不属于本轮范围");
            for(JsonNode source:run.path("manifest").path("knowledgeReferences"))if(knowledgeRef.equals(source.path("id").asText())){knowledgeKind=source.path("scopeKind").asText();knowledgeScope=source.path("scopeId").asText();break;}
            evidence.authorize(owner,str(task,"project_id"),knowledgeKind,knowledgeScope,knowledgeRef);
        }
        if("database".equals(capability))databases.authorizeArguments(run,operation,request.path("arguments"));
        if("completed".equals(prior.get("state")))return decode(json,prior.get("result_json"));
        Object remoteResult=dispatch(owner,task,run,capability,operation,request.path("arguments"),"agent-"+hash(runId+":"+call));
        final String scopeKind=knowledgeKind,scopeId=knowledgeScope,referenceId=knowledgeRef;
        return tx.execute(status->{
            Map<String,Object> current=db.one("SELECT * FROM nw_agent_call WHERE run_id=? AND call_id=? FOR UPDATE",runId,call);
            if("completed".equals(current.get("state")))return decode(json,current.get("result_json"));
            Object result=remoteResult;
            if("knowledge".equals(capability))result=evidence.record(owner,str(task,"id"),runId,call,scopeKind,scopeId,referenceId,json.valueToTree(remoteResult));
            db.update("UPDATE nw_agent_call SET state='completed',result_json=?,updated_at=CURRENT_TIMESTAMP(6) WHERE run_id=? AND call_id=?",encode(json,result),runId,call);return result;
        });
    }
    private Object dispatch(String owner,Map<String,Object> task,JsonNode run,String capability,String operation,JsonNode args,String key){String project=str(task,"project_id");
        if("database".equals(capability))return databases.tool(owner,task,run,operation,args,key);
        if("service".equals(capability))return serviceOperations.agentTool(owner,task,run,operation,args);
        if("knowledge".equals(capability)){
            String ref=text(args,"referenceId",128,true);boolean allowed=false;for(JsonNode id:run.path("manifest").path("knowledgeRefs"))if(ref.equals(id.asText()))allowed=true;if(!allowed)throw new ApiException(403,"知识库不属于本轮范围");
            String kind="project",target=project;for(JsonNode source:run.path("manifest").path("knowledgeReferences"))if(ref.equals(source.path("id").asText())){kind=source.path("scopeKind").asText();target=source.path("scopeId").asText();break;}
            if("expert".equals(kind)){
                boolean bound=false;for(JsonNode id:decode(json,tasks.project(owner,project,false).get("snapshot_json")).path("config").path("agentIds"))if(target.equals(id.asText()))bound=true;
                if(!bound||experts.visibleExpert(owner,target)==null)throw new ApiException(403,"专家知识库授权已撤销");
            }else if(!"project".equals(kind)||!project.equals(target))throw new ApiException(403,"知识库来源不属于本项目");
            ObjectNode input=args.deepCopy();input.remove("referenceId");input.put("requireEnabled",true);if("gallery".equals(operation))input.put("isEnabled",true);if("wiki.search".equals(operation)||"wiki.page".equals(operation)){input.put("contentKind","wiki");operation="wiki.search".equals(operation)?"search":"document";}return knowledge.readReference(owner,kind,target,ref,operation,input);
        }
        if("workflow".equals(capability)){switch(operation){case "list":return workflows.list(owner);case "definition":return workflows.get(owner,text(args,"workflowId",128,true));case "start":return workflows.createTask(owner,text(args,"workflowId",128,true),json.valueToTree(map("input",args.path("input"))),key);case "status":return workflows.task(owner,text(args,"taskId",128,true));case "control":return workflows.control(owner,text(args,"taskId",128,true),text(args,"action",32,true),args.path("options"),key);case "artifacts":return workflows.artifacts(owner,text(args,"workflowId",128,true));case "import_artifact":{WorkflowService.Download file=workflows.download(owner,text(args,"workflowId",128,true),text(args,"artifactId",128,true));ByteArrayOutputStream bytes=new ByteArrayOutputStream(){@Override public synchronized void write(byte[] b,int off,int len){if(count+len>20*1024*1024)throw new ApiException(413,"工作流成果超过当前导入上限 20 MiB");super.write(b,off,len);}};file.write(bytes);return engine.post(owner,project,"/v1/projects/"+AgentClient.segment(project)+"/artifacts",map("name",file.filename,"contentBase64",Base64.getEncoder().encodeToString(bytes.toByteArray()),"mediaType","application/octet-stream","sessionId",run.path("sessionId").asText(),"source",map("kind","workflow","workflowId",args.path("workflowId").asText(),"artifactId",args.path("artifactId").asText())),key);}}}
        if("memory".equals(capability)){List<Map<String,Object>> scopes=memoryScopes(owner,task,tasks.project(owner,project,false));if("search".equals(operation))return memory.search(owner,scopes,text(args,"query",4000,true));if("propose".equals(operation)){String kind=text(args,"kind",16,true),target=text(args,"scopeId",128,true);if(scopes.stream().noneMatch(s->kind.equals(s.get("kind"))&&target.equals(s.get("scopeId"))))throw new ApiException(403,"记忆范围未授权");memoryScopes.authorize(owner,kind,target,true);String entry=hash(key).substring(0,32);return tx.execute(status->{Map<String,Object> prior=db.one("SELECT id FROM nw_memory_entry WHERE id=?",entry);if(prior!=null)return memory.detail(owner,entry);return memory.createEntry(owner,kind,target,entry,text(args,"title",300,true),text(args,"content",50000,true),json.valueToTree(map("type","agent_proposal","runId",run.path("id").asText(),"taskId",task.get("id"),"projectId",project,"requiresReview",true)),"draft",false,run.path("id").asText());});}}
        throw new ApiException(422,"不支持的业务操作");
    }
    public Object reconcile(JsonNode request){JsonNode run=run(request);Map<String,Object> call=db.one("SELECT * FROM nw_agent_call WHERE run_id=? AND call_id=? AND owner_id=?",run.path("id").asText(),text(request,"callId",255,true),run.path("ownerId").asText());if(call==null)return map("status","not_started");if(!"completed".equals(call.get("state")))return map("status","unknown");evidence.authorizeResult(run.path("ownerId").asText(),str(task(run),"id"),decode(json,call.get("result_json")));return map("status","completed","result",map("content",Collections.singletonList(map("type","text","text",encode(json,decode(json,call.get("result_json"))))),"details",map()));}
}
