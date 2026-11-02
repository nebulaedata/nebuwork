package cn.nebulaedata.cccs.nebuwork.backend.api.platformmcp;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.expert.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.memory.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.workbench.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.workflow.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;
import javax.servlet.http.HttpServletResponse;
import java.io.*;
import java.lang.reflect.Proxy;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;

/** Explicit adapters over existing services; browser authentication is never impersonated. */
@Component
public class PlatformMcpDispatch {
    final WorkbenchService wb;final ExpertService experts;final ExpertAbilityService ability;final RuntimeResources runtime;
    final AgentTasks tasks;final AgentUsage usage;final AgentClient engine;final AgentStore db;
    final WorkflowService workflows;final WorkflowSettings workflowSettings;final KnowledgeService knowledge;
    final KnowledgeManagement management;final KnowledgeCreationService creation;final KnowledgeContent content;final KnowledgeEvidence evidence;
    final MemoryService memory;final MemoryRuntime memoryRuntime;final MemorySettings memorySettings;final ModelProviderService models;final MemoryConfigurationService memoryConfig;final AgentEngineConfiguration engineSettings;final ObjectMapper json;
    public PlatformMcpDispatch(WorkbenchService wb,ExpertService experts,ExpertAbilityService ability,RuntimeResources runtime,AgentTasks tasks,AgentUsage usage,AgentClient engine,AgentStore db,WorkflowService workflows,WorkflowSettings workflowSettings,KnowledgeService knowledge,KnowledgeManagement management,KnowledgeCreationService creation,KnowledgeContent content,KnowledgeEvidence evidence,MemoryService memory,MemoryRuntime memoryRuntime,MemorySettings memorySettings,ModelProviderService models,MemoryConfigurationService memoryConfig,AgentEngineConfiguration engineSettings,ObjectMapper json){this.wb=wb;this.experts=experts;this.ability=ability;this.runtime=runtime;this.tasks=tasks;this.usage=usage;this.engine=engine;this.db=db;this.workflows=workflows;this.workflowSettings=workflowSettings;this.knowledge=knowledge;this.management=management;this.creation=creation;this.content=content;this.evidence=evidence;this.memory=memory;this.memoryRuntime=memoryRuntime;this.memorySettings=memorySettings;this.models=models;this.memoryConfig=memoryConfig;this.engineSettings=engineSettings;this.json=json;}
    String s(JsonNode a,String key){return a.path(key).asText("");}long rev(JsonNode a){return a.path("revision").asLong(-1);}ObjectNode data(JsonNode a){return a.path("data").isObject()?((ObjectNode)a.path("data")).deepCopy():json.createObjectNode();}
    String mode(JsonNode a){String v=s(a,"mode");if(!Arrays.asList("create","update").contains(v))throw new ApiException(422,"mode 仅支持 create/update");if(v.equals("update")&&s(a,"id").isEmpty())throw new ApiException(422,"更新必须指定 id");return v;}
    String taskProject(PlatformMcpService.Context c,String task){return str(tasks.owned(c.owner,task),"project_id");}
    public void authorize(PlatformMcpService.Context c,String name,JsonNode a){
        if(name.equals("nw_resource_read")){JsonNode resource=c.getOuter().resourceDescriptor(c,s(a,"uri"));resourceAuthorization(c,resource);if(!resource.path("type").asText().equals("json"))binary(c,resource);}
        if(c.run.hasNonNull("parentRunId")&&Arrays.asList("nw_task_run_get","nw_task_run_command","nw_task_expert_run_get","nw_task_context_get").contains(name)&&!c.runId.equals(s(a,"runId")))throw new ApiException(403,"专家只能访问或控制本次协作执行");
        if(a.hasNonNull("projectId")){tasks.project(c.owner,s(a,"projectId"),false);c.require("project",s(a,"projectId"));}
        if(a.hasNonNull("workbenchId"))c.require("workbench",s(a,"workbenchId"));
        if(a.hasNonNull("expertId")){experts.assertVisible(s(a,"expertId"),c.owner);c.require("expert",s(a,"expertId"));}
        if(a.hasNonNull("taskId"))c.require("project",taskProject(c,s(a,"taskId")));
        if(a.hasNonNull("workflowId"))c.require("workflow",s(a,"workflowId"));
        if(name.startsWith("nw_workbench_")&&a.hasNonNull("id"))c.require("workbench",s(a,"id"));
        if(name.startsWith("nw_project_")&&a.hasNonNull("id"))c.require("project",s(a,"id"));
        if(name.startsWith("nw_expert_")&&a.hasNonNull("id")){c.require("expert",s(a,"id"));experts.assertVisible(s(a,"id"),c.owner);}
        if(name.startsWith("nw_task_")&&a.hasNonNull("id"))c.require("project",taskProject(c,s(a,"id")));
        if(name.startsWith("nw_workflow_")&&!name.startsWith("nw_workflow_task_")&&!name.startsWith("nw_workflow_artifact_")&&a.hasNonNull("id"))c.require("workflow",s(a,"id"));
        if(name.startsWith("nw_workflow_task_")&&a.hasNonNull("id")){Map<String,Object> row=db.one("SELECT workflow_id FROM nw_workflow_task WHERE id=? AND owner_id=?",s(a,"id"),c.owner);if(row==null)throw new ApiException(404,"工作流运行不存在");c.require("workflow",str(row,"workflow_id"));}
        if(name.startsWith("nw_runtime_"))c.require(s(a,"kind"),s(a,"id"));
        if(a.hasNonNull("connectionId")&&a.hasNonNull("collectionId")){c.library(s(a,"connectionId"),s(a,"collectionId"));knowledge.authorizeLibrary(c.owner,s(a,"connectionId"),s(a,"collectionId"),c.getOuter().catalog.get(name).write&&!name.equals("nw_knowledge_reference_set"));}
        if(name.equals("nw_knowledge_scope_get")||name.equals("nw_knowledge_reference_set")||name.equals("nw_knowledge_target_list")){if(a.hasNonNull("id"))c.require(s(a,"kind"),s(a,"id"));}
        if(name.equals("nw_workbench_save")&&mode(a).equals("create")||name.equals("nw_expert_save")&&mode(a).equals("create")||name.equals("nw_workflow_create")||name.equals("nw_knowledge_library_create")||name.equals("nw_knowledge_creation_submit")||name.equals("nw_market_expert_add")){if(!c.accountScope())throw new ApiException(403,"创建账号级资源需要主执行的账号范围授权");}
        if(name.equals("nw_project_save")&&mode(a).equals("create")){c.require("workbench",data(a).path("workbenchId").asText());}
        if(name.equals("nw_memory_propose")&&a.path("data").hasNonNull("sourceEntryId")){String source=a.path("data").path("sourceEntryId").asText();Map<String,Object> row=db.one("SELECT s.kind,s.object_id FROM nw_memory_entry e JOIN nw_memory_scope s ON s.id=e.scope_id WHERE e.id=? AND s.owner_id=?",source,c.owner);if(row==null)throw new ApiException(404,"来源记忆不存在");memoryScope(c,str(row,"kind"),str(row,"object_id"));memory.detail(c.owner,source);}
        if(name.startsWith("nw_memory_")&&a.hasNonNull("kind"))memoryScope(c,s(a,"kind"),s(a,"id"));
        if(name.startsWith("nw_memory_")&&a.hasNonNull("id")&&!a.hasNonNull("kind")){Map<String,Object> row=db.one("SELECT s.kind,s.object_id FROM nw_memory_entry e JOIN nw_memory_scope s ON s.id=e.scope_id WHERE e.id=? AND s.owner_id=?",s(a,"id"),c.owner);if(row==null)throw new ApiException(404,"记忆不存在");memoryScope(c,str(row,"kind"),str(row,"object_id"));}
        if(name.startsWith("nw_knowledge_creation_job_")){if(!s(c.frozen,"scope").equals("account")||!s(c.current,"scope").equals("account")||c.run.hasNonNull("parentRunId"))throw new ApiException(403,"创建作业需要账号范围授权");}
        if(name.startsWith("nw_knowledge_operation_")&&a.hasNonNull("id")){Map<String,Object> op=db.one("SELECT connection_id,collection_id FROM nw_knowledge_operation WHERE id=? AND owner_id=?",s(a,"id"),c.owner);if(op==null)throw new ApiException(404,"知识操作不存在");c.library(str(op,"connection_id"),str(op,"collection_id"));knowledge.authorizeLibrary(c.owner,str(op,"connection_id"),str(op,"collection_id"),c.getOuter().catalog.get(name).write);}
    }
    void memoryScope(PlatformMcpService.Context c,String kind,String id){if(kind.equals("task")){if(!c.taskId.equals(id))throw new ApiException(403,"任务记忆需要当前任务范围");}else if(kind.equals("user")){if(!id.equals("self"))throw new ApiException(403,"用户记忆仅支持 self");}else c.require(kind,id);}
    Object page(Object input,JsonNode a){JsonNode value=json.valueToTree(input);if(!value.isArray())return input;int offset=a.path("offset").asInt(0),limit=Math.min(100,Math.max(1,a.path("limit").asInt(50)));ArrayNode out=json.createArrayNode();for(int i=offset;i<Math.min(value.size(),offset+limit);i++)out.add(value.get(i));return map("items",out,"nextOffset",offset+limit<value.size()?offset+limit:null,"hasMore",offset+limit<value.size());}
    Object filtered(PlatformMcpService.Context c,Object input,String kind,JsonNode a){ArrayNode out=json.createArrayNode();String q=s(a,"query").toLowerCase(Locale.ROOT);JsonNode source=json.valueToTree(input);if(!source.isArray())source=source.path("items");for(JsonNode row:source){if(c.allows(kind,row.path("id").asText())&&(q.isEmpty()||row.path("name").asText(row.path("title").asText()).toLowerCase(Locale.ROOT).contains(q)))out.add(row);}return page(out,a);}
    Object taskMetadata(Object input){JsonNode n=json.valueToTree(input);ObjectNode out=json.createObjectNode();if(n.has("task"))out.set("task",pick(n.path("task"),"id","projectId","sessionId","title","status","createdAt","updatedAt","usage"));if(n.has("session"))out.set("session",pick(n.path("session"),"id","status","createdAt","updatedAt"));for(String key:Arrays.asList("usage","cursor"))if(n.has(key))out.set(key,n.path(key));ArrayNode runs=out.putArray("runs");for(JsonNode r:n.path("runs"))runs.add(pick(r,"id","status","createdAt","updatedAt","usage","error"));return out;}
    JsonNode pick(JsonNode value,String...keys){ObjectNode out=json.createObjectNode();for(String key:keys)if(value.has(key))out.set(key,value.get(key));return out;}
    Object runMetadata(JsonNode run){ObjectNode result=(ObjectNode)pick(run,"id","sessionId","status","createdAt","updatedAt","usage","error","parentRunId");if(run.path("manifest").has("primaryExpertId"))result.set("primaryExpertId",run.path("manifest").path("primaryExpertId"));ArrayNode children=result.putArray("children");for(JsonNode child:run.path("children")){ObjectNode item=(ObjectNode)pick(child,"id","sessionId","status","createdAt","updatedAt","usage","error","parentRunId");if(child.path("manifest").has("primaryExpertId"))item.set("primaryExpertId",child.path("manifest").path("primaryExpertId"));children.add(item);}return result;}
    void transcript(PlatformMcpService.Context c,String task){if(c.taskId.equals(task)&&!c.run.hasNonNull("parentRunId"))return;throw new ApiException(403,"其他任务的会话内容请通过已有会话授权和 nw_session_read 读取");}
    boolean dataRead(String n){return n.endsWith("_list")||n.endsWith("_get");}
    public Object invoke(PlatformMcpService.Context c,String n,JsonNode a,String key){String o=c.owner,id=s(a,"id"),ex=s(a,"expertId"),project=s(a,"projectId"),workflow=s(a,"workflowId");ObjectNode d=data(a);
        switch(n){
        case "nw_identity_get":return map("ownerId",o,"projectId",c.projectId,"taskId",c.taskId,"runId",c.runId,"workbenchId",c.workbenchId,"dataScope",map("snapshot",s(c.frozen,"scope"),"current",s(c.current,"scope"),"expertExecution",c.run.hasNonNull("parentRunId")),"tools",grantedNames(c));
        case "nw_capabilities_get":return map("catalogVersion",PlatformMcpCatalog.VERSION,"tools",grantedNames(c),"knowledge",knowledge.settings(o),"workflow",workflowSettings.read(o),"memory",memoryConfig.read(o),"unimplemented",Arrays.asList("commander","intelligence","project_schedules","database_browser","im_channels","desktop_executor"));
        case "nw_operation_get":return c.getOuter().operation(c,id);
        case "nw_operation_reconcile":return c.getOuter().reconcile(c,id);
        case "nw_resource_read":return readResource(c,s(a,"uri"),a);
        case "nw_search":return search(c,a);
        case "nw_task_overview_get":return taskOverview(c,a);
        case "nw_usage_get":return usage(c,a);
        case "nw_workbench_list":return localList(c,"workbench",a);
        case "nw_workbench_get":{ObjectNode result=json.valueToTree(wb.get(o,id));if(result.has("projectIds")){JsonNode original=result.path("projectIds");ArrayNode ids=result.putArray("projectIds");for(JsonNode p:original)if(c.allows("project",p.asText()))ids.add(p);}return result;}
        case "nw_workbench_save":return mode(a).equals("create")?wb.create(o,d,key):wb.update(o,id,d);
        case "nw_workbench_delete":wb.delete(o,id,rev(a));return map("deleted",true);
        case "nw_workbench_config_get":return wb.config(o,id);
        case "nw_workbench_config_save":return wb.saveConfig(o,id,d);
        case "nw_workbench_binding_set":return wb.bind(o,id,s(a,"kind"),s(a,"targetId"),a.path("enabled").asBoolean(),rev(a));
        case "nw_workbench_publish":return wb.publish(o,id,json.valueToTree(map("revision",rev(a))));
        case "nw_workbench_version_list":return page(wb.versions(o,id),a);
        case "nw_workbench_version_get":return wb.version(o,id,s(a,"version"));
        case "nw_project_list":return localList(c,"project",a);
        case "nw_project_get":return wb.project(o,id);
        case "nw_project_save":return mode(a).equals("create")?wb.createProject(o,d,key):wb.updateProject(o,id,d);
        case "nw_runtime_get":return runtime.view(o,s(a,"kind"),id);
        case "nw_runtime_save":{JsonNode old=json.valueToTree(runtime.view(o,s(a,"kind"),id)).path("document");Set<String> allowed=new HashSet<>(Arrays.asList("instructions","skills","files","modelProviderId"));d.fieldNames().forEachRemaining(f->{if(!allowed.contains(f)&&!d.get(f).equals(old.path(f)))throw new ApiException(403,"系统工具不可修改运行资源保留字段："+f);});ObjectNode merged=old.deepCopy();d.fields().forEachRemaining(e->merged.set(e.getKey(),e.getValue()));if(d.has("files")){ArrayNode retained=merged.putArray("files");for(JsonNode ref:d.path("files")){JsonNode found=null;for(JsonNode file:old.path("files"))if(ref.path("path").equals(file.path("path")))found=file;if(found==null)throw new ApiException(403,"新文件必须使用受控文件添加工具");retained.add(found);}}return runtime.save(o,s(a,"kind"),id,json.valueToTree(map("revision",rev(a),"document",merged)));}
        case "nw_runtime_publish":return runtime.publish(o,s(a,"kind"),id,rev(a));
        case "nw_runtime_file_add":try{JsonNode current=json.valueToTree(runtime.view(o,s(a,"kind"),id));if(current.path("revision").asLong()!=rev(a))throw new ApiException(409,"运行资源已变化");JsonNode uploaded=json.valueToTree(runtime.upload(o,s(a,"kind"),id,s(a,"path"),file(c,a.path("file")),key));ObjectNode doc=current.path("document").deepCopy();ArrayNode files=doc.withArray("files");for(int i=files.size()-1;i>=0;i--)if(files.get(i).path("path").equals(uploaded.path("path")))files.remove(i);files.add(uploaded);return runtime.save(o,s(a,"kind"),id,json.valueToTree(map("revision",rev(a),"document",doc)));}catch(IOException e){throw new ApiException(502,"文件读取失败");}
        case "nw_expert_list":return localList(c,"expert",a);
        case "nw_expert_get":{ObjectNode detail=json.valueToTree(experts.detail(id,o,a.path("offset").asInt(0)));if(!s(c.frozen,"scope").equals("account")||!s(c.current,"scope").equals("account")){detail.remove(Arrays.asList("tasks","usage","stats","taskTotal","hasMore"));if(detail.path("agent").isObject())((ObjectNode)detail.path("agent")).remove("stats");}return detail;}
        case "nw_expert_save":return shared(mode(a).equals("create")?experts.create(d,o):experts.update(id,d,o));
        case "nw_expert_ability_complete":return ability.complete(d,o);
        case "nw_expert_remove":return experts.remove(id,rev(a),a.path("membershipRevision").asLong(-1),o);
        case "nw_expert_binding_set":if(!Arrays.asList("extensions","tpls").contains(s(a,"kind")))throw new ApiException(422,"无效引用类型");return shared(experts.binding(id,s(a,"targetId"),s(a,"kind").equals("extensions"),a.path("enabled").asBoolean(),o));
        case "nw_market_expert_list":return page(experts.marketExperts(o),a);
        case "nw_market_expert_add":return experts.hire(id,o);
        case "nw_sop_list":return page(experts.sops(ex,o),a);
        case "nw_sop_save":if(mode(a).equals("create"))return shared(d.path("kind").asText().equals("workflow")?experts.createWorkflowSop(ex,d,o,key):experts.createSop(ex,d,o));return shared(experts.updateSop(ex,id,d,o));
        case "nw_sop_delete":experts.deleteSop(ex,id,rev(a),o);return map("deleted",true,"definitionScope","shared");
        case "nw_sop_workflow_create":return experts.createSopWorkflow(ex,id,json.valueToTree(map("revision",rev(a))),o,key);
        case "nw_sop_material_add":try{return experts.upload(ex,s(a,"sopId"),rev(a),file(c,a.path("file")),o);}catch(IOException e){throw new ApiException(502,"素材读取失败");}
        case "nw_sop_material_read":return resource(c,map("type","sop","expertId",ex,"sopId",s(a,"sopId"),"id",id));
        case "nw_sop_material_remove":return experts.removeMaterial(ex,s(a,"sopId"),id,rev(a),o);
        case "nw_rule_set_list":return page(experts.ruleSets(ex),a);
        case "nw_rule_set_create":return shared(experts.createRuleSet(ex,d,o));
        case "nw_rule_list":return page(experts.rules(ex),a);
        case "nw_rule_save":return shared(experts.saveRule(ex,mode(a).equals("create")?null:id,d,o));
        case "nw_rule_delete":experts.deleteRule(ex,id,rev(a),o);return map("deleted",true,"definitionScope","shared");
        case "nw_extension_catalog_list":return page(experts.extensions(),a);
        case "nw_case_template_list":return page(experts.templates(),a);
        case "nw_task_list":return taskList(c,a);
        case "nw_task_get":return taskMetadata(tasks.detail(o,id));
        case "nw_task_update":return taskMetadata(tasks.edit(o,id,d));
        case "nw_task_create":{dispatchable(c);if(d.path("context").has("platformMcp"))throw new ApiException(403,"不能覆盖系统授权");db.update("UPDATE nw_platform_mcp_call SET target_task_id=? WHERE id=?","task-"+hash(o+":"+project+":"+key).substring(0,40),key);Object result=tasks.create(o,project,d,key);String target=json.valueToTree(result).path("task").path("id").asText();db.update("UPDATE nw_platform_mcp_call SET target_task_id=? WHERE id=?",target,key);return taskMetadata(result);}
        case "nw_task_run_list":{ArrayNode out=json.createArrayNode();JsonNode result=tasks.runs(o,id);for(JsonNode r:result.isArray()?result:result.path("items"))out.add(pick(r,"id","sessionId","status","createdAt","updatedAt","usage","primaryExpertId","error"));return page(out,a);}
        case "nw_task_run_start":{dispatchable(c);if(!c.taskId.equals(id))db.update("UPDATE nw_platform_mcp_call SET target_task_id=? WHERE id=?",id,key);Object result=pick(tasks.send(o,id,d,key),"id","sessionId","status","createdAt");if(!c.taskId.equals(id))db.update("UPDATE nw_platform_mcp_call SET target_task_id=? WHERE id=?",id,key);return result;}
        case "nw_task_run_get":return runMetadata(tasks.run(o,id,s(a,"runId")));
        case "nw_task_run_command":if(!c.taskId.equals(id)&&Arrays.asList("follow_up","resume").contains(d.path("type").asText())){dispatchable(c);db.update("UPDATE nw_platform_mcp_call SET target_task_id=? WHERE id=?",id,key);}return tasks.command(o,id,s(a,"runId"),d,key);
        case "nw_task_events_list":transcript(c,id);return tasks.events(o,id,a.path("after").asLong(0));
        case "nw_task_expert_run_get":if(c.run.hasNonNull("parentRunId")){if(!c.runId.equals(s(a,"runId")))throw new ApiException(403,"专家只能读取本次协作会话");return engine.get(o,c.projectId,"/v1/sessions/"+AgentClient.segment(c.run.path("sessionId").asText()));}transcript(c,id);return tasks.expert(o,id,s(a,"runId"));
        case "nw_task_context_get":{JsonNode run=tasks.run(o,id,s(a,"runId"));if(c.run.hasNonNull("parentRunId")&&!c.runId.equals(s(a,"runId")))throw new ApiException(403,"专家只能读取本次协作的资源来源");JsonNode m=run.path("manifest");ObjectNode out=(ObjectNode)pick(m,"schemaVersion","bundleVersions","primaryExpertId","knowledgeReferences","degraded");out.set("model",pick(m.path("model"),"providerId","revision","model"));ArrayNode skills=out.putArray("skills");for(JsonNode skill:m.path("skills"))skills.add(pick(skill,"id","name","revision","directory"));ArrayNode tools=out.putArray("tools");if(m.has("platformMcp")){out.set("systemMcp",pick(m.path("platformMcp"),"catalogVersion","policyRevision"));tools.addAll((ArrayNode)m.path("platformMcp").path("policy").path("tools"));}else for(JsonNode tool:m.path("businessTools"))tools.add(tool.path("name"));return out;}
        case "nw_session_grant_list":return engine.get(o,c.projectId,"/v1/session-grants?targetSessionId="+AgentClient.segment(c.run.path("sessionId").asText()));
        case "nw_session_read":return engine.get(o,c.projectId,"/v1/session-grants/"+AgentClient.segment(id)+"/events?targetSessionId="+AgentClient.segment(c.run.path("sessionId").asText())+"&after="+a.path("after").asLong(0));
        case "nw_session_grant_revoke":return engine.post(o,c.projectId,"/v1/session-grants/"+AgentClient.segment(id)+"/revoke",map("targetSessionId",c.run.path("sessionId").asText()),key);
        case "nw_artifact_list":return tasks.artifacts(o,project);
        case "nw_artifact_get":return engine.get(o,project,"/v1/artifacts/"+AgentClient.segment(id)+"?version="+a.path("version").asInt());
        case "nw_artifact_version_list":return engine.get(o,project,"/v1/artifacts/"+AgentClient.segment(id)+"/versions");
        case "nw_artifact_read":return resource(c,map("type","artifact","projectId",project,"id",id,"version",a.path("version").asInt()));
        case "nw_artifact_import":try{return tasks.upload(o,project,a.has("taskId")?s(a,"taskId"):null,file(c,a.path("file")),key);}catch(IOException e){throw new ApiException(502,"文件导入失败");}
        case "nw_workflow_list":return localList(c,"workflow",a);
        case "nw_workflow_get":return workflows.get(o,id);
        case "nw_workflow_create":return workflows.create(o,d,key);
        case "nw_workflow_retry":return workflows.retry(o,id,false);
        case "nw_workflow_definition_save":return workflows.definition(o,id,d);
        case "nw_workflow_validate":return workflows.validate(o,id,d);
        case "nw_workflow_source_get":return workflows.source(o,id,s(a,"path"),null);
        case "nw_workflow_source_save":return workflows.source(o,id,s(a,"path"),d);
        case "nw_workflow_revision_list":return workflows.revisions(o,id,s(a,"path"));
        case "nw_workflow_restore":return workflows.restore(o,id,s(a,"path"),d);
        case "nw_workflow_archive":return workflows.archive(o,id,d);
        case "nw_workflow_task_list":return workflows.tasks(o,workflow);
        case "nw_workflow_task_create":return workflows.createTask(o,workflow,d,key);
        case "nw_workflow_task_get":return workflows.task(o,id);
        case "nw_workflow_task_retry":return workflows.retry(o,id,true);
        case "nw_workflow_task_command":return workflows.control(o,id,s(a,"action"),d,key);
        case "nw_workflow_task_preview":return workflows.preview(o,id,d);
        case "nw_workflow_task_events_list":return workflows.events(o,id,a.path("after").asLong(0));
        case "nw_workflow_task_log_get":return workflows.logs(o,id,s(a,"step"),a.path("attempt").asInt());
        case "nw_workflow_artifact_list":return workflows.artifacts(o,workflow);
        case "nw_workflow_artifact_read":workflows.content(o,workflow,id);return resource(c,map("type","workflow","workflowId",workflow,"id",id));
        case "nw_model_catalog_list":return page(models.list(o),a);
        case "nw_model_settings_get":return models.settings(o);
        case "nw_admin_status_get":case "nw_admin_catalog_get":return admin(c,a);
        }
        if(n.startsWith("nw_memory_"))return memory(c,n,a,key);
        if(n.startsWith("nw_knowledge_")||n.startsWith("nw_faq_")||n.startsWith("nw_wiki_")||n.startsWith("nw_evidence_"))return knowledge(c,n,a,key);
        throw new IllegalStateException("未绑定的系统工具："+n);
    }
    List<String> grantedNames(PlatformMcpService.Context c){List<String> names=new ArrayList<>();for(PlatformMcpCatalog.Tool tool:c.getOuter().catalog.all())if(c.hasTool(tool.name))names.add(tool.name);return names;}
    Object shared(Object value){return map("definitionScope","shared","result",value);}
    /** Reads original receipts only. A missing receipt never causes a second submission. */
    Object recover(PlatformMcpService.Context c,String name,JsonNode a,String key){
        Map<String,Object> receipt;
        if(name.equals("nw_task_create")){String target="task-"+hash(c.owner+":"+s(a,"projectId")+":"+key).substring(0,40);receipt=db.one("SELECT id FROM nw_agent_task WHERE id=? AND owner_id=? AND session_id IS NOT NULL",target,c.owner);return receipt==null?null:taskMetadata(tasks.detail(c.owner,target));}
        if(name.equals("nw_task_run_start")||name.equals("nw_task_run_command")||name.equals("nw_artifact_import")){
            String kind=name.equals("nw_artifact_import")?"artifact":name.equals("nw_task_run_command")&&!a.path("data").path("type").asText().equals("follow_up")?"command":"run";
            String target=kind.equals("artifact")?s(a,"projectId"):kind.equals("command")?s(a,"runId"):str(tasks.owned(c.owner,s(a,"id")),"session_id");
            JsonNode found=engine.get(c.owner,kind.equals("artifact")?s(a,"projectId"):taskProject(c,s(a,"id")),"/v1/requests/"+kind+"/"+AgentClient.segment(target)+"?key="+AgentClient.segment(key));
            return !found.path("found").asBoolean()?null:kind.equals("run")?pick(found.path("result"),"id","sessionId","status","createdAt"):found.path("result");
        }
        if(name.startsWith("nw_workflow_")||name.equals("nw_sop_workflow_create")){
            receipt=db.one("SELECT result_json FROM nw_workflow_request WHERE owner_id=? AND request_key=?",c.owner,key);
            if(receipt!=null&&receipt.get("result_json")!=null)return decode(json,receipt.get("result_json"));
        }
        if(name.equals("nw_knowledge_creation_submit")){receipt=db.one("SELECT id FROM nw_knowledge_creation_job WHERE owner_id=? AND request_key=?",c.owner,key);return receipt==null?null:creation.job(c.owner,str(receipt,"id"));}
        if(name.startsWith("nw_knowledge_")||name.startsWith("nw_faq_")||name.startsWith("nw_wiki_")){
            receipt=db.one("SELECT id FROM nw_knowledge_operation WHERE owner_id=? AND request_key=?",c.owner,key);
            if(receipt!=null)return management.recover(c.owner,str(receipt,"id"));
        }
        if(name.equals("nw_memory_retry")){receipt=db.one("SELECT result_json FROM nw_memory_request WHERE owner_id=? AND request_key=?",c.owner,key);if(receipt!=null&&receipt.get("result_json")!=null)return decode(json,receipt.get("result_json"));}
        return null;
    }
    void dispatchable(PlatformMcpService.Context c){if(c.run.hasNonNull("parentRunId")||db.one("SELECT id FROM nw_platform_mcp_call WHERE owner_id=? AND target_task_id=? LIMIT 1",c.owner,c.taskId)!=null)throw new ApiException(403,"第一版仅允许主任务进行一级业务任务调度");}
    Object taskList(PlatformMcpService.Context c,JsonNode a){return localList(c,"task",a);}
    Object taskOverview(PlatformMcpService.Context c,JsonNode a){
        List<Object> params=new ArrayList<>();params.add(c.owner);params.add(c.owner);
        String where=" FROM nw_agent_task t JOIN nw_project p ON p.id=t.project_id WHERE t.owner_id=? AND p.owner_id=? AND t.deleted_at IS NULL";
        Set<String> projects=scopeIds(c,"project");if(projects!=null){if(projects.isEmpty())return map("totalTasks",0,"projects",Collections.emptyList(),"items",Collections.emptyList(),"hasMore",false);where+=" AND t.project_id IN ("+String.join(",",Collections.nCopies(projects.size(),"?"))+")";params.addAll(projects);}
        if(a.hasNonNull("projectId")){where+=" AND t.project_id=?";params.add(s(a,"projectId"));}
        if(a.hasNonNull("workbenchId")){where+=" AND p.workbench_id=?";params.add(s(a,"workbenchId"));}
        Map<String,Object> count=db.one("SELECT COUNT(*) AS total"+where,params.toArray());
        List<Object> paged=new ArrayList<>(params);paged.add(Math.min(100,a.path("limit").asInt(50)));paged.add(a.path("offset").asInt(0));
        List<Map<String,Object>> counts=db.rows("SELECT t.project_id AS projectId,COUNT(*) AS taskCount"+where+" GROUP BY t.project_id ORDER BY t.project_id LIMIT ? OFFSET ?",paged.toArray());
        ObjectNode result=json.valueToTree(taskList(c,a));result.put("totalTasks",count==null?0:((Number)count.get("total")).longValue());result.set("projects",json.valueToTree(counts));return result;
    }
    Set<String> scopeIds(PlatformMcpService.Context c,String kind){if(!c.run.hasNonNull("parentRunId")&&s(c.frozen,"scope").equals("account")&&s(c.current,"scope").equals("account"))return null;Set<String> candidates=new LinkedHashSet<>();if(kind.equals("project"))candidates.add(c.projectId);if(kind.equals("workbench"))candidates.add(c.workbenchId);if(kind.equals("expert")){for(JsonNode e:c.manifest.path("experts"))candidates.add(e.path("id").asText());candidates.add(c.manifest.path("primaryExpertId").asText());}for(JsonNode p:Arrays.asList(c.frozen,c.current))for(JsonNode r:p.path("resources"))if(kind.equals(r.path("kind").asText()))candidates.add(r.path("id").asText());if(kind.equals("workflow")){Set<String> ex=scopeIds(c,"expert");if(ex!=null&&!ex.isEmpty()){List<Object> args=new ArrayList<>();args.add(c.owner);args.addAll(ex);for(Map<String,Object> row:db.rows("SELECT w.workflow_id FROM nw_sop_workflow w JOIN nw_sop s ON s.id=w.sop_id WHERE w.owner_id=? AND s.expert_id IN ("+String.join(",",Collections.nCopies(ex.size(),"?"))+") LIMIT 100",args.toArray()))candidates.add(str(row,"workflow_id"));}}candidates.remove("");candidates.removeIf(id->!c.allows(kind,id));return candidates;}
    Object localList(PlatformMcpService.Context c,String kind,JsonNode a){String table=kind.equals("workbench")?"nw_workbench":kind.equals("project")?"nw_project":kind.equals("expert")?"nw_expert":kind.equals("workflow")?"nw_workflow":"nw_agent_task";String alias="e",scopeKind=kind.equals("task")?"project":kind,scopeColumn=kind.equals("task")?"e.project_id":"e.id";Set<String> ids=scopeIds(c,scopeKind);List<Object> args=new ArrayList<>();StringBuilder sql=new StringBuilder("SELECT e.* FROM "+table+" e WHERE ");if(kind.equals("expert")){sql.append("NOT EXISTS (SELECT 1 FROM nw_expert_membership m WHERE m.owner_id=? AND m.expert_id=e.id AND m.removed=TRUE)");args.add(c.owner);}else{sql.append("e.owner_id=?");args.add(c.owner);}if(Arrays.asList("workbench","task").contains(kind))sql.append(" AND e.deleted_at IS NULL");if(ids!=null){if(ids.isEmpty())return map("items",Collections.emptyList(),"nextOffset",null,"hasMore",false);sql.append(" AND "+scopeColumn+" IN ("+String.join(",",Collections.nCopies(ids.size(),"?"))+")");args.addAll(ids);}if(a.hasNonNull("projectId")&&kind.equals("task")){sql.append(" AND e.project_id=?");args.add(s(a,"projectId"));}if(a.hasNonNull("workbenchId")){if(kind.equals("task"))sql.append(" AND EXISTS(SELECT 1 FROM nw_project p WHERE p.id=e.project_id AND p.workbench_id=?)");else if(kind.equals("project"))sql.append(" AND e.workbench_id=?");else throw new ApiException(422,"此列表不支持 workbenchId");args.add(s(a,"workbenchId"));}if(a.hasNonNull("query")){sql.append(" AND LOWER(e."+(kind.equals("task")?"title":"name")+") LIKE ?");args.add("%"+s(a,"query").toLowerCase(Locale.ROOT)+"%");}int limit=Math.min(100,Math.max(1,a.path("limit").asInt(50))),offset=a.path("offset").asInt(0);sql.append(" ORDER BY e.created_at DESC,e.id LIMIT ? OFFSET ?");args.add(limit+1);args.add(offset);List<Map<String,Object>> rows=db.rows(sql.toString(),args.toArray());boolean more=rows.size()>limit;if(more)rows.remove(rows.size()-1);ArrayNode out=json.createArrayNode();Map<String,JsonNode> status=new HashMap<>();if(kind.equals("task")&&!rows.isEmpty()){StringJoiner list=new StringJoiner(",");for(Map<String,Object> row:rows)if(row.get("session_id")!=null)list.add(AgentClient.segment(str(row,"session_id")));if(list.length()>0){JsonNode result=engine.get(c.owner,null,"/v1/sessions/status?ids="+list);for(JsonNode item:result.path("items"))status.put(item.path("id").asText(),item);}}for(Map<String,Object> row:rows){ObjectNode item=(ObjectNode)pick(json.valueToTree(row),"id","name","title","description","status","revision","icon","color","created_at","updated_at","archived");if(row.containsKey("workbench_id"))item.put("workbenchId",str(row,"workbench_id"));if(row.containsKey("role_label"))item.put("role",str(row,"role_label"));if(kind.equals("task")){item.put("projectId",str(row,"project_id"));item.put("sessionId",str(row,"session_id"));JsonNode state=status.get(str(row,"session_id"));item.put("status",state==null?"unavailable":state.path("status").asText("unavailable"));}out.add(item);}return map("items",out,"nextOffset",more?offset+limit:null,"hasMore",more);}
    Object usage(PlatformMcpService.Context c,JsonNode a){String kind=s(a,"kind"),id=s(a,"id");if(kind.equals("project")){c.require("project",id);return usage.projectUsage(usage.load(c.owner,id),id);}if(kind.equals("workbench")){c.require("workbench",id);if(!c.accountScope())throw new ApiException(403,"工作台跨项目用量需要账号范围授权");return tasks.workbenchUsage(c.owner,id);}if(kind.equals("expert")){c.require("expert",id);if(!c.accountScope())throw new ApiException(403,"专家跨项目用量需要主执行的账号范围授权");return usage.expert(c.owner,id,a.path("offset").asInt(0));}if(kind.equals("task")){c.require("project",taskProject(c,id));return json.valueToTree(tasks.detail(c.owner,id)).path("usage");}if(kind.equals("run")){c.require("project",taskProject(c,s(a,"taskId")));return tasks.run(c.owner,s(a,"taskId"),id).path("usage");}if(kind.equals("user")&&c.accountScope())return usage.load(c.owner,null);throw new ApiException(403,"用量范围未授权");}
    Object search(PlatformMcpService.Context c,JsonNode a){Map<String,Object> result=new LinkedHashMap<>();for(String kind:Arrays.asList("workbench","project","expert","task"))result.put(kind,localList(c,kind,a));return map("groups",result,"pagination","independent_per_group");}
    JsonNode mapNode(Object... pairs){return json.valueToTree(map(pairs));}
    Object admin(PlatformMcpService.Context c,JsonNode a){switch(s(a,"kind")){case "knowledge":return knowledge.settings(c.owner);case "memory":return memoryConfig.read(c.owner);case "workflow":return workflowSettings.read(c.owner);case "engine":return engineSettings.read(c.owner);case "engine-status":return engineSettings.status(c.owner);case "models":return models.list(c.owner);case "credentials":return runtime.credentials(c.owner);case "knowledge-templates":return creation.templates(c.owner,s(a,"id"));case "knowledge-resources":return creation.resources(c.owner,s(a,"id"));case "knowledge-discovery":return knowledge.discover(c.owner,s(a,"id"));case "model-settings":return models.settings(c.owner);default:throw new ApiException(422,"不支持的管理查询类型");}}
    Object memory(PlatformMcpService.Context c,String n,JsonNode a,String key){String o=c.owner,id=s(a,"id"),kind=s(a,"kind");ObjectNode d=data(a);switch(n){case "nw_memory_target_list":{ArrayNode allowed=json.createArrayNode();for(JsonNode target:json.valueToTree(memory.targets(o))){try{memoryScope(c,target.path("kind").asText(),target.path("scopeId").asText());allowed.add(target);}catch(ApiException denied){if(denied.status!=403)throw denied;}}return page(allowed,a);}case "nw_memory_entry_list":return memory.list(o,kind,id,a.path("offset").asInt(0));case "nw_memory_get":return memory.detail(o,id);case "nw_memory_search":return memory.searchScope(o,kind,id,json.valueToTree(map("query",s(a,"query"))));case "nw_memory_context_get":transcript(c,s(a,"taskId"));return memoryRuntime.history(o,s(a,"taskId"));case "nw_memory_cleanup_list":{ArrayNode allowed=json.createArrayNode();for(JsonNode entry:json.valueToTree(memory.cleanup(o))){Map<String,Object> scope=db.one("SELECT s.kind,s.object_id FROM nw_memory_entry e JOIN nw_memory_scope s ON s.id=e.scope_id WHERE e.id=? AND s.owner_id=?",entry.path("id").asText(),o);if(scope!=null){try{memoryScope(c,str(scope,"kind"),str(scope,"object_id"));allowed.add(entry);}catch(ApiException denied){if(denied.status!=403)throw denied;}}}return page(allowed,a);}case "nw_memory_propose":{String entry="pmm-"+hash(key).substring(0,32);return memory.propose(o,kind,id,entry,text(d,"title",300,true),text(d,"content",50000,true),json.valueToTree(map("type","agent_proposal","taskId",c.taskId,"runId",c.runId,"projectId",c.projectId,"requiresReview",true,"sourceEntryId",d.path("sourceEntryId").asText(null))),c.runId);}case "nw_memory_draft_update":{JsonNode old=json.valueToTree(memory.detail(o,id));if(!old.path("state").asText().equals("draft"))throw new ApiException(403,"系统工具只能编辑建议草稿");return memory.updateAgentDraft(o,id,d,key,c.taskId,c.runId);}case "nw_memory_disable":case "nw_memory_delete":return memory.change(o,id,n.endsWith("delete")?"delete":"disable",json.valueToTree(map("revision",rev(a))),key);case "nw_memory_retry":return memory.retry(o,id,json.valueToTree(map("revision",rev(a))),key);default:throw new IllegalStateException(n);}}
    Object manage(PlatformMcpService.Context c,JsonNode a,String op,JsonNode payload,String key){ObjectNode request=json.createObjectNode().put("operation",op).put("collectionId",s(a,"collectionId")).put("requestKey",key);if(a.has("id"))request.put("resourceId",s(a,"id"));request.set("payload",payload);for(String field:Arrays.asList("page","pageSize","keyword","query","parse_status","source","search_field","is_enabled","tag_id","sort_order","folder_id","page_type","status","parent_id","version","cursor"))if(payload.has(field))request.set(field,payload.get(field));return management.manage(c.owner,s(a,"connectionId"),request);}
    Object knowledge(PlatformMcpService.Context c,String n,JsonNode a,String key){String o=c.owner,id=s(a,"id"),connection=s(a,"connectionId"),collection=s(a,"collectionId");ObjectNode d=data(a);switch(n){
        case "nw_knowledge_driver_list":return knowledge.drivers();
        case "nw_knowledge_connection_list":return knowledge.connections(o,"user","");
        case "nw_knowledge_target_list":return localList(c,s(a,"kind"),a);
        case "nw_knowledge_scope_get":return knowledge.configuration(o,s(a,"kind"),id);
        case "nw_knowledge_reference_set":if(s(a,"action").equals("bind"))return knowledge.bind(o,s(a,"kind"),id,json.valueToTree(map("revision",rev(a),"connectionId",connection,"collectionId",collection)));if(s(a,"action").equals("unbind"))return knowledge.unbind(o,s(a,"kind"),id,s(a,"referenceId"),rev(a));throw new ApiException(422,"action 仅支持 bind/unbind");
        case "nw_knowledge_library_list":{List<String> allowed=null;if(!c.accountScope()){Set<String> ids=new LinkedHashSet<>();for(JsonNode ref:c.manifest.path("knowledgeReferences"))if(connection.equals(ref.path("connectionId").asText()))ids.add(ref.path("collectionId").asText());for(JsonNode policy:Arrays.asList(c.frozen,c.current))for(JsonNode ref:policy.path("resources"))if("knowledge".equals(ref.path("kind").asText())&&connection.equals(ref.path("connectionId").asText()))ids.add(ref.path("id").asText());ids.removeIf(kb->!c.allows("knowledge",kb,connection));allowed=new ArrayList<>(ids);}return knowledge.collectionsPage(o,connection,allowed,a.path("limit").asInt(50),a.path("offset").asInt(0));}
        case "nw_knowledge_library_get":return manage(c,a,"kb.get",d,key);
        case "nw_knowledge_library_references_get":return manage(c,a,"kb.references",d,key);
        case "nw_knowledge_library_create":if(!Arrays.asList("faq","wiki").contains(d.path("type").asText()))throw new ApiException(422,"文档型知识库请通过创建模板作业创建");requireFields(d,"name","description","type","faq_config","wiki_config");return manage(c,a,"kb.create",d,key);
        case "nw_knowledge_library_update":requireFields(d,"name","description");return manage(c,a,"kb.update",d,key);
        case "nw_knowledge_library_delete":return manage(c,a,"kb.delete",d,key);
        case "nw_knowledge_creation_template_list":return page(creation.templates(o,null),a);
        case "nw_knowledge_creation_submit":d.put("requestKey",key);return creation.submit(o,d);
        case "nw_knowledge_creation_job_list":return page(creation.jobs(o),a);
        case "nw_knowledge_creation_job_get":return creation.job(o,id);
        case "nw_knowledge_creation_job_confirm":return creation.confirm(o,id,d);
        case "nw_knowledge_creation_job_retry":return creation.retry(o,id,false);
        case "nw_knowledge_creation_job_recover":return creation.retry(o,id,true);
        case "nw_knowledge_operation_list":{ArrayNode allowed=json.createArrayNode();for(JsonNode op:json.valueToTree(management.listOperations(o)))if(c.allows("knowledge",op.path("collectionId").asText(),op.path("connectionId").asText()))allowed.add(op);return page(allowed,a);}
        case "nw_knowledge_operation_recover":return management.recover(o,id);
        case "nw_knowledge_operation_import_progress":return management.progress(o,id);
        case "nw_knowledge_operation_failure_report":return resource(c,map("type","failure_report","id",id));
        case "nw_evidence_get":return evidence.read(o,s(a,"taskId"),id);
        case "nw_evidence_source_read":return evidence.source(o,s(a,"taskId"),id,d);
        case "nw_evidence_media_read":return resource(c,map("type","evidence","taskId",s(a,"taskId"),"id",id));
        case "nw_knowledge_document_create":if(!Arrays.asList("manual","url").contains(s(a,"source")))throw new ApiException(422,"source 仅支持 manual/url");return manage(c,a,"document."+s(a,"source"),d,key);
        case "nw_knowledge_document_update":return manage(c,a,"document.update",d,key);
        case "nw_knowledge_document_delete":return manage(c,a,"document.delete",d,key);
        case "nw_knowledge_document_list":return manage(c,a,"documents.list",d,key);
        case "nw_knowledge_document_get":return manage(c,a,"document.get",d,key);
        case "nw_knowledge_document_parse_status":return manage(c,a,"document.stages",d,key);
        case "nw_knowledge_document_parse_command":if(!Arrays.asList("reparse","cancel").contains(s(a,"action")))throw new ApiException(422,"解析动作仅支持 reparse/cancel");return manage(c,a,"document."+s(a,"action"),d,key);
        case "nw_knowledge_document_file_add":{MultipartFile file=file(c,a.path("file"));return management.upload(o,connection,collection,key,file,file.getOriginalFilename(),s(a,"relativePath"));}
        case "nw_knowledge_document_export":return resource(c,map("type","knowledge_download","connectionId",connection,"collectionId",collection,"id",id,"format","json"));
        case "nw_knowledge_document_source_read":return sourceResource(c,a,d);
        case "nw_faq_list":return manage(c,a,"faq.list",d,key);
        case "nw_faq_get":return manage(c,a,"faq.get",d,key);
        case "nw_faq_save":return manage(c,a,"faq."+(mode(a).equals("create")?"create":"update"),d,key);
        case "nw_faq_delete":return manage(c,a,"faq.delete",d,key);
        case "nw_faq_batch_update":if(!Arrays.asList("fields","tags").contains(s(a,"action")))throw new ApiException(422,"仅支持 fields/tags");return manage(c,a,"faq."+s(a,"action"),d,key);
        case "nw_faq_import":if(a.has("file")){if(d.has("entries"))throw new ApiException(422,"entries 与导入文件只能选择一种");try{d.set("entries",PlatformMcpFaqFiles.parse(json,new String(file(c,a.path("file")).getBytes(),java.nio.charset.StandardCharsets.UTF_8),s(a,"format")));}catch(IOException e){throw new ApiException(502,"FAQ 文件读取失败");}}return manage(c,a,"faq.import",d,key);
        case "nw_faq_export":return resource(c,map("type","knowledge_download","connectionId",connection,"collectionId",collection,"id","","format",s(a,"format")));
        case "nw_knowledge_tag_list":return manage(c,a,"tags.list",d,key);
        case "nw_knowledge_tag_save":return manage(c,a,"tags."+(mode(a).equals("create")?"create":"update"),d,key);
        case "nw_knowledge_tag_delete":return manage(c,a,"tags.delete",d,key);
        case "nw_wiki_page_list":return manage(c,a,"wiki.pages",d,key);
        case "nw_wiki_page_get":return manage(c,a,"wiki.get",d,key);
        case "nw_wiki_page_save":return manage(c,a,"wiki."+(mode(a).equals("create")?"create":"update"),d,key);
        case "nw_wiki_page_delete":return manage(c,a,"wiki.delete",d,key);
        case "nw_wiki_page_move":return manage(c,a,"wiki.move",d,key);
        case "nw_wiki_folder_list":return manage(c,a,"wiki.folders",d,key);
        case "nw_wiki_folder_save":return manage(c,a,"wiki.folder."+(mode(a).equals("create")?"create":"update"),d,key);
        case "nw_wiki_folder_delete":return manage(c,a,"wiki.folder.delete",d,key);
        case "nw_wiki_revision_list":return manage(c,a,"wiki.revisions",d,key);
        case "nw_wiki_revert":return manage(c,a,"wiki.revert",d,key);
        case "nw_wiki_index_get":return manage(c,a,"wiki.index",d,key);
        case "nw_wiki_stats_get":return manage(c,a,"wiki.stats",d,key);
        case "nw_wiki_lint_get":return manage(c,a,"wiki.lint",d,key);
        case "nw_wiki_issue_list":return manage(c,a,"wiki.issues",d,key);
        case "nw_wiki_issue_set":return manage(c,a,"wiki.issue",d,key);
        case "nw_wiki_graph_get":return manage(c,a,"wiki.graph",d,key);
        case "nw_wiki_links_rebuild":return manage(c,a,"wiki.links",d,key);
        case "nw_wiki_autofix":return manage(c,a,"wiki.fix",d,key);
        }
        String op=n.equals("nw_knowledge_document_read")?"document":n.equals("nw_knowledge_capabilities_get")?"capabilities":n.equals("nw_knowledge_search")?"search":n.equals("nw_knowledge_answer")?"answer":n.equals("nw_knowledge_chunk_get")?"chunk":n.equals("nw_knowledge_entity_graph_get")?"graph":n.equals("nw_knowledge_gallery_get")?"gallery":null;
        if(op!=null){JsonNode result;if(a.hasNonNull("referenceId")){String ref=s(a,"referenceId");boolean found=false;for(JsonNode r:c.manifest.path("knowledgeReferences"))if(ref.equals(r.path("id").asText())&&s(a,"kind").equals(r.path("scopeKind").asText())&&id.equals(r.path("scopeId").asText()))found=true;if(!found)throw new ApiException(403,"知识引用不属于本轮快照");result=knowledge.readReference(o,s(a,"kind"),id,ref,op,d);result=evidence.record(o,c.taskId,c.runId,key,s(a,"kind"),id,ref,result);}else{c.library(connection,collection);result=knowledge.readCatalog(o,connection,collection,op,d);String uri=c.getOuter().resource(c,map("type","evidence_catalog","connectionId",connection,"collectionId",collection));result=evidence.recordCatalog(o,c.taskId,c.runId,key,connection,uri.substring(20),result);}return result;}
        throw new IllegalStateException("未实现知识工具："+n);
    }
    void requireFields(JsonNode value,String... fields){Set<String> allowed=new HashSet<>(Arrays.asList(fields));value.fieldNames().forEachRemaining(k->{if(!allowed.contains(k))throw new ApiException(403,"系统工具不可修改技术配置："+k);});}
    Object sourceResource(PlatformMcpService.Context c,JsonNode a,JsonNode d){if(a.has("referenceId")){boolean found=false;for(JsonNode ref:c.manifest.path("knowledgeReferences"))if(s(a,"referenceId").equals(ref.path("id").asText())&&s(a,"kind").equals(ref.path("scopeKind").asText())&&s(a,"id").equals(ref.path("scopeId").asText()))found=true;if(!found)throw new ApiException(403,"知识引用不属于本轮");}else c.library(s(a,"connectionId"),s(a,"collectionId"));return resource(c,map("type","knowledge_source","arguments",a));}
    Object resource(PlatformMcpService.Context c,Object descriptor){ObjectNode fixed=json.valueToTree(descriptor);if(Arrays.asList("knowledge_source","knowledge_download").contains(fixed.path("type").asText()))fixed.put("frozenSha256",binaryHash(binary(c,fixed).bytes));return map("uri",c.getOuter().resource(c,fixed));}
    String binaryHash(byte[] value){try{return Base64.getEncoder().encodeToString(java.security.MessageDigest.getInstance("SHA-256").digest(value));}catch(java.security.NoSuchAlgorithmException impossible){throw new IllegalStateException(impossible);}}
    Binary binary(PlatformMcpService.Context c,JsonNode d){Binary value=sourceBinary(c,d);if(d.has("frozenSha256")&&!d.path("frozenSha256").asText().equals(binaryHash(value.bytes)))throw new ApiException(409,"原文件版本已变化，请重新读取来源并使用新的资源句柄");return value;}
    Object readResource(PlatformMcpService.Context c,String uri,JsonNode a){JsonNode descriptor=c.getOuter().resourceDescriptor(c,uri);resourceAuthorization(c,descriptor);if(descriptor.path("type").asText().equals("json")){String text=descriptor.path("value").toString();int offset=a.path("offset").asInt(0),limit=Math.min(65536,Math.max(1,a.path("limit").asInt(65536)));if(offset>text.length())throw new ApiException(422,"资源偏移无效");int end=Math.min(text.length(),offset+limit);return map("mimeType","application/json","encoding","utf8","text",text.substring(offset,end),"offset",offset,"nextOffset",end<text.length()?end:null,"size",text.length());}Binary file=binary(c,descriptor);int offset=a.path("offset").asInt(0),limit=Math.min(65536,Math.max(1,a.path("limit").asInt(65536)));if(offset>file.bytes.length)throw new ApiException(422,"资源偏移无效");int end=Math.min(file.bytes.length,offset+limit);return map("mimeType",file.type,"encoding","base64","data",Base64.getEncoder().encodeToString(Arrays.copyOfRange(file.bytes,offset,end)),"offset",offset,"nextOffset",end<file.bytes.length?end:null,"size",file.bytes.length);}
    void resourceAuthorization(PlatformMcpService.Context c,JsonNode d){if(d.has("policyHash")&&!d.path("policyHash").asText().equals(fingerprint(c.current)))throw new ApiException(403,"授权版本已变化，请重新读取资源");if(d.has("sourceTool")){c.requireTool(d.path("sourceTool").asText());authorize(c,d.path("sourceTool").asText(),d.path("sourceArguments"));}}
    Binary sourceBinary(PlatformMcpService.Context c,JsonNode d){resourceAuthorization(c,d);String type=d.path("type").asText();if(type.equals("artifact")){String project=s(d,"projectId"),id=s(d,"id");c.require("project",project);tasks.project(c.owner,project,false);return new Binary(engine.contentBytes(c.owner,project,id,d.path("version").asInt()),"application/octet-stream",id);}
        if(type.equals("workflow")){c.require("workflow",s(d,"workflowId"));WorkflowService.Download file=workflows.download(c.owner,s(d,"workflowId"),s(d,"id"));ByteArrayOutputStream out=bounded();file.write(out);return new Binary(out.toByteArray(),"application/octet-stream",file.filename);}
        if(type.equals("knowledge_download")){c.library(s(d,"connectionId"),s(d,"collectionId"));KnowledgeRestClient.Binary file=management.download(c.owner,s(d,"connectionId"),s(d,"collectionId"),s(d,"id"),s(d,"format"));return new Binary(file.bytes,file.contentType,"knowledge-export");}
        if(type.equals("failure_report")){KnowledgeRestClient.Binary f=management.failureReport(c.owner,s(d,"id"));return new Binary(f.bytes,f.contentType,"faq-errors.csv");}
        if(type.equals("evidence")){c.require("project",taskProject(c,s(d,"taskId")));KnowledgeRestClient.Binary f=evidence.binary(c.owner,s(d,"taskId"),s(d,"id"),true,false);return new Binary(f.bytes,f.contentType,"evidence");}
        if(type.equals("knowledge_source")){JsonNode a=d.path("arguments");sourceAuthorization(c,a);ObjectNode input=a.path("data").deepCopy();boolean media=input.path("media").asBoolean();input.remove("media");KnowledgeRestClient.Binary f=a.hasNonNull("referenceId")?content.reference(c.owner,s(a,"kind"),s(a,"id"),s(a,"referenceId"),input,media):content.catalog(c.owner,s(a,"connectionId"),s(a,"collectionId"),input,media);return new Binary(f.bytes,f.contentType,"knowledge-source");}
        if(type.equals("sop")){String expert=s(d,"expertId");c.require("expert",expert);ByteArrayOutputStream out=bounded();try{javax.servlet.ServletOutputStream stream=new javax.servlet.ServletOutputStream(){public boolean isReady(){return true;}public void setWriteListener(javax.servlet.WriteListener listener){}public void write(int b){out.write(b);}};HttpServletResponse response=(HttpServletResponse)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{HttpServletResponse.class},(p,m,args)->m.getName().equals("getOutputStream")?stream:m.getReturnType().equals(boolean.class)?false:m.getReturnType().equals(int.class)?200:null);experts.download(expert,s(d,"sopId"),s(d,"id"),c.owner,response,null,null);}catch(IOException e){throw new ApiException(502,"素材下载失败");}return new Binary(out.toByteArray(),"application/octet-stream","sop-material");}
        throw new ApiException(422,"不支持的资源类型");}
    void sourceAuthorization(PlatformMcpService.Context c,JsonNode a){if(a.has("referenceId")){boolean included=false;for(JsonNode ref:c.manifest.path("knowledgeReferences"))if(s(a,"referenceId").equals(ref.path("id").asText()))included=true;if(!included)throw new ApiException(403,"引用不属于本轮");}else c.library(s(a,"connectionId"),s(a,"collectionId"));}
    ByteArrayOutputStream bounded(){return new ByteArrayOutputStream(){public synchronized void write(byte[] b,int off,int len){if(count+len>20*1024*1024)throw new ApiException(413,"文件超过20 MiB");super.write(b,off,len);}public synchronized void write(int b){if(count>=20*1024*1024)throw new ApiException(413,"文件超过20 MiB");super.write(b);}};}
    static final class Binary{final byte[] bytes;final String type,name;Binary(byte[] bytes,String type,String name){if(bytes.length>20*1024*1024)throw new ApiException(413,"文件超过20 MiB");this.bytes=bytes;this.type=type;this.name=name;}}
    MultipartFile file(PlatformMcpService.Context c,JsonNode ref){Binary binary;if(ref.has("uri"))binary=binary(c,c.getOuter().resourceDescriptor(c,ref.path("uri").asText()));else{String project=ref.path("projectId").asText();c.require("project",project);tasks.project(c.owner,project,false);if(!ref.path("version").isIntegralNumber()||ref.path("version").asInt()<1)throw new ApiException(422,"文件必须固定版本");String id=ref.path("id").asText();JsonNode metadata=engine.get(c.owner,project,"/v1/artifacts/"+AgentClient.segment(id)+"?version="+ref.path("version").asInt());binary=new Binary(engine.contentBytes(c.owner,project,id,ref.path("version").asInt()),metadata.path("mediaType").asText("application/octet-stream"),metadata.path("name").asText("file"));}final Binary b=binary;return new MultipartFile(){public String getName(){return "file";}public String getOriginalFilename(){return b.name;}public String getContentType(){return b.type;}public boolean isEmpty(){return b.bytes.length==0;}public long getSize(){return b.bytes.length;}public byte[] getBytes(){return b.bytes;}public InputStream getInputStream(){return new ByteArrayInputStream(b.bytes);}public void transferTo(File dest)throws IOException{throw new IOException("Host filesystem writes are not supported");}};}
}
