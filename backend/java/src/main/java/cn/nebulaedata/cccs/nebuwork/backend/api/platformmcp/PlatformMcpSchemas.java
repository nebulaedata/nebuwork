package cn.nebulaedata.cccs.nebuwork.backend.api.platformmcp;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Business payload schemas accompany tool discovery, so callers need no browser/API knowledge. */
final class PlatformMcpSchemas {
    private PlatformMcpSchemas(){}
    static Map<String,Object> object(String fields){Map<String,Object> props=new LinkedHashMap<>();for(String field:fields.split(" +")){if(field.isEmpty())continue;String[] p=field.split(":");String type=p.length==1?"string":p[1].equals("n")?"integer":p[1].equals("b")?"boolean":p[1].equals("a")?"array":"object";Map<String,Object> spec=map("type",type,"description",p[0]);if(type.equals("array"))spec.put("items",map());props.put(p[0],spec);}return map("type","object","properties",props,"additionalProperties",false);}
    static Map<String,Object> data(String n){
        if(n.equals("nw_workbench_save"))return object("name desc icon color revision:n");
        if(n.equals("nw_workbench_config_save"))return object("revision:n bizName domain bizDef wikiMd applicabilityMd exclusionsMd systemPrompt entities:a relations:a defaultAgentId");
        if(n.equals("nw_project_save"))return object("name desc workbenchId parameters:o status revision:n");
        if(n.equals("nw_expert_save"))return object("name role tagline modelProviderId revision:n");
        if(n.equals("nw_expert_ability_complete"))return object("name role tagline modelProviderId");
        if(n.equals("nw_runtime_save"))return object("instructions:a skills:a files:a modelProviderId");
        if(n.equals("nw_sop_save"))return object("name desc kind revision:n wf:o proc:o");
        if(n.equals("nw_rule_set_create"))return object("name desc");
        if(n.equals("nw_rule_save"))return object("name content scene ruleSetId enabled:b revision:n");
        if(n.equals("nw_task_create")||n.equals("nw_task_run_start"))return object("title content fileIds:a fileRefs:a context:o retryOf");
        if(n.equals("nw_task_update"))return object("title context:o");
        if(n.equals("nw_task_run_command"))return object("type content");
        if(n.equals("nw_workflow_create"))return object("name description");
        if(n.equals("nw_workflow_definition_save"))return object("definition:o expected_revision");
        if(n.equals("nw_workflow_validate"))return object("definition:o");
        if(n.equals("nw_workflow_source_save"))return object("content expected_revision");
        if(n.equals("nw_workflow_restore"))return object("revision_id:n expected_revision");
        if(n.equals("nw_workflow_archive"))return object("archived:b");
        if(n.equals("nw_workflow_task_create"))return object("input:o");
        if(n.equals("nw_workflow_task_command"))return object("expected_version:n from_steps:a expected_environment");
        if(n.equals("nw_workflow_task_preview"))return object("from_steps:a");
        if(n.equals("nw_knowledge_library_create"))return object("name description type faq_config:o wiki_config:o");
        if(n.equals("nw_knowledge_library_update"))return object("name description");
        if(n.equals("nw_knowledge_creation_submit"))return object("templateId revision:n name description preview:b");
        if(n.equals("nw_knowledge_creation_job_confirm"))return object("business:o");
        if(n.equals("nw_knowledge_document_create"))return object("title content status tag_ids:a process_config:o url");
        if(n.equals("nw_knowledge_document_update"))return object("title content status");
        if(n.equals("nw_faq_save"))return object("standard_question similar_questions:a negative_questions:a answers:a answer_strategy tag_id tag_name is_enabled:b is_recommended:b");
        if(n.equals("nw_faq_delete"))return object("ids:a");
        if(n.equals("nw_faq_batch_update"))return object("by_id:o by_tag:o exclude_ids:a updates:a");
        if(n.equals("nw_faq_import"))return object("entries:a mode dry_run:b");
        if(n.equals("nw_knowledge_tag_save"))return object("name color");
        if(n.equals("nw_wiki_page_save"))return object("slug title content folder_id page_type version:n");
        if(n.equals("nw_wiki_page_move"))return object("slug folder_id");
        if(n.equals("nw_wiki_folder_save"))return object("name parent_id move_parent:b");
        if(n.equals("nw_wiki_revert"))return object("slug version:n");
        if(n.equals("nw_wiki_issue_set"))return object("status");
        if(n.equals("nw_memory_propose"))return object("title content sourceEntryId");
        if(n.equals("nw_memory_draft_update"))return object("revision:n title content");
        if(n.startsWith("nw_evidence_"))return object("page:n");
        if(n.equals("nw_knowledge_document_source_read"))return object("documentId chunkId imageId download:b media:b");
        return object("query topK:n documentId contentKind page:n pageSize:n chunkId mode nodeId limit:n searchIn:a sortBy sortOrder isEnabled:b documentIds:a attrFilters:o attrRules:a keyword parse_status source search_field is_enabled:b tag_id sort_order folder_id page_type status parent_id version:n cursor");
    }
    @SuppressWarnings("unchecked") static void enrich(String n,Map<String,Object> schema){Map<String,Object> props=(Map<String,Object>)schema.get("properties");for(Map.Entry<String,Object> e:props.entrySet())((Map<String,Object>)e.getValue()).put("description",e.getKey().equals("data")?"业务参数；更新必须使用当前读取的版本，字段定义如下":e.getKey().equals("id")?"目标业务对象 ID，从对应列表或创建结果取得":e.getKey().equals("limit")?"每页数量，默认50，最多100":e.getKey().equals("offset")?"分页偏移，默认0":e.getKey());
        if(props.containsKey("data"))props.put("data",data(n));
        if(props.containsKey("data")){Map<String,Object> business=(Map<String,Object>)((Map<String,Object>)props.get("data")).get("properties");for(String field:Arrays.asList("modelProviderId","defaultAgentId"))if(business.containsKey(field))business.put(field,map("anyOf",Arrays.asList(map("type","string"),map("type","null")),"description","已保存引用，null 表示解除选择或继承"));if(n.equals("nw_workflow_source_save"))business.put("expected_revision",map("anyOf",Arrays.asList(map("type","string"),map("type","null")),"description","已有文件版本；新文件使用 null"));if(n.equals("nw_workflow_task_create"))business.put("input",map("description","遵循工作流输入场景的 JSON 值"));}
        if(n.equals("nw_runtime_save")){Map<String,Object> payload=(Map<String,Object>)props.get("data");Map<String,Object> properties=(Map<String,Object>)payload.get("properties");properties.put("files",map("type","array","description","可选的保留文件列表；仅填写已有 path，省略的文件会移除。新文件使用 nw_runtime_file_add。","items",map("type","object","properties",map("path",map("type","string")),"required",Arrays.asList("path"),"additionalProperties",false)));}
        if(props.containsKey("mode"))((Map<String,Object>)props.get("mode")).put("enum",Arrays.asList("create","update"));
        if(props.containsKey("file")){Map<String,Object> file=object("uri projectId id version:n");file.put("oneOf",Arrays.asList(map("required",Arrays.asList("uri")),map("required",Arrays.asList("projectId","id","version"))));file.put("description","受控资源 URI，或已授权项目中的成果 ID 与固定版本；工作区文件先发布为成果");props.put("file",file);}
        if(props.containsKey("limit")){((Map<String,Object>)props.get("limit")).put("minimum",1);((Map<String,Object>)props.get("limit")).put("maximum",100);}
        for(String key:Arrays.asList("offset","after"))if(props.containsKey(key)){((Map<String,Object>)props.get(key)).put("minimum",0);((Map<String,Object>)props.get(key)).put("maximum",Integer.MAX_VALUE);}
        if(n.equals("nw_resource_read"))((Map<String,Object>)props.get("limit")).put("maximum",65536);
        if(props.containsKey("referenceId")&&props.containsKey("data")&&!n.equals("nw_knowledge_reference_set"))schema.put("anyOf",Arrays.asList(map("required",Arrays.asList("connectionId","collectionId")),map("required",Arrays.asList("kind","id","referenceId"))));
        if(n.equals("nw_task_run_command"))((Map<String,Object>)((Map<String,Object>)props.get("data")).get("properties")).put("type",map("type","string","enum",Arrays.asList("steer","follow_up","cancel","resume")));
        if(n.equals("nw_workflow_task_command"))((Map<String,Object>)props.get("action")).put("enum",Arrays.asList("start","pause","resume","cancel","rerun"));
        if(n.equals("nw_workbench_binding_set"))((Map<String,Object>)props.get("kind")).put("enum",Arrays.asList("agents","tpls"));
        if(n.equals("nw_expert_binding_set"))((Map<String,Object>)props.get("kind")).put("enum",Arrays.asList("extensions","tpls"));
        if(n.startsWith("nw_admin_"))((Map<String,Object>)props.get("kind")).put("enum",Arrays.asList("knowledge","memory","workflow","engine","engine-status","models","credentials","knowledge-templates","knowledge-resources","knowledge-discovery","model-settings"));
        if(props.containsKey("kind")){List<String> values=n.startsWith("nw_runtime_")||n.startsWith("nw_knowledge_")?Arrays.asList("project","workbench","expert"):n.startsWith("nw_memory_")?Arrays.asList("user","task","project","workbench","expert"):n.equals("nw_usage_get")?Arrays.asList("user","task","run","project","workbench","expert"):null;if(values!=null)((Map<String,Object>)props.get("kind")).put("enum",values);}
    }
}
