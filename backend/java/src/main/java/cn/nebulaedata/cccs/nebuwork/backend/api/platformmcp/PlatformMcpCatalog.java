package cn.nebulaedata.cccs.nebuwork.backend.api.platformmcp;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.springframework.stereotype.Component;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Authoritative, versioned business tool registry. No reflection or arbitrary HTTP dispatch. */
@Component
public class PlatformMcpCatalog {
    public static final String VERSION="1";
    public static final class Tool {
        public final String name,group,description; public final boolean write,remote;
        public final Map<String,Object> schema;
        Tool(String name,String group,String description,boolean write,boolean remote,Map<String,Object> schema){this.name=name;this.group=group;this.description=description;this.write=write;this.remote=remote;this.schema=schema;PlatformMcpSchemas.enrich(name,schema);}
        public Map<String,Object> dto(){return map("name",name,"group",group,"description",description,"write",write,"replay",write?(remote?"reconcile":"idempotent"):"read","inputSchema",schema,
            "outputSchema",map("type","object","properties",map("data",map(),"operationId",map("type","string")),"required",Arrays.asList("data"),"additionalProperties",true),
            "annotations",map("readOnlyHint",!write,"destructiveHint",write,"idempotentHint",!remote,"openWorldHint",remote));}
    }
    private final Map<String,Tool> tools=new LinkedHashMap<>(); private final ObjectMapper json;
    public PlatformMcpCatalog(ObjectMapper json){this.json=json;
        add("",false,false,"identity_get","当前调用身份与授权");add("",false,false,"capabilities_get","已实现能力与模块状态");
        add("",false,false,"search","按关键词搜索授权业务对象","query!","projectId","limit:n","offset:n");
        add("",false,false,"task_overview_get","授权任务概览","projectId","workbenchId","limit:n","offset:n");
        add("",false,true,"usage_get","实际 Tokens 用量；未知不计为零","kind!","id","taskId","limit:n","offset:n");
        add("",false,false,"operation_get","读取调用记录与结果","id!");add("",true,true,"operation_reconcile","核对原调用，不重复提交未知操作","id!");
        add("",false,true,"resource_read","读取工具返回的受控资源句柄","uri!","offset:n","limit:n");
        reads("workbench","工作台", "list|limit:n offset:n query","get|id!","config_get|id!","version_list|id! limit:n offset:n","version_get|id! version!");
        writes("workbench",false,"工作台","save|mode! id data:o!","delete|id! revision:n!","config_save|id! data:o!","binding_set|id! kind! targetId! enabled:b! revision:n!");
        writes("workbench",true,"工作台","publish|id! revision:n!");
        reads("project","项目","list|workbenchId limit:n offset:n query","get|id!");writes("project",false,"项目","save|mode! id data:o!");
        reads("runtime","运行资源（不含凭据）","get|kind! id!");writes("runtime",false,"运行指令与完整技能资源","save|kind! id! revision:n! data:o!");writes("runtime",true,"运行资源","publish|kind! id! revision:n!","file_add|kind! id! revision:n! path! file:o!");
        reads("expert","专家","list|limit:n offset:n query","get|id! offset:n");writes("expert",false,"专家共享定义；成员关系账号独立","save|mode! id data:o!","remove|id! revision:n! membershipRevision:n!","binding_set|id! kind! targetId! enabled:b!");
        writes("expert",true,"专家能力草稿","ability_complete|data:o!");reads("market_expert","市场专家","list|limit:n offset:n query");writes("market_expert",false,"添加市场专家","add|id!");
        reads("sop","专家 SOP","list|expertId! limit:n offset:n");writes("sop",false,"SOP","save|mode! expertId! id data:o!","delete|expertId! id! revision:n!");writes("sop",true,"真实 Workflow SOP","workflow_create|expertId! id! revision:n!");
        writes("sop_material",true,"SOP 素材","add|expertId! sopId! revision:n! file:o!");reads("sop_material","SOP 素材","read|expertId! sopId! id!");writes("sop_material",false,"移除素材引用","remove|expertId! sopId! id! revision:n!");
        reads("rule_set","规则场景集","list|expertId! limit:n offset:n");writes("rule_set",false,"规则场景集","create|expertId! data:o!");
        reads("rule","业务规则","list|expertId! limit:n offset:n");writes("rule",false,"业务规则","save|mode! expertId! id data:o!","delete|expertId! id! revision:n!");
        reads("extension_catalog","扩展目录（不代表已安装）","list|limit:n offset:n query");reads("case_template","案例模板目录","list|limit:n offset:n query");
        reads("task","任务元数据","list|projectId limit:n offset:n query","get|id!","run_list|id! limit:n offset:n","run_get|id! runId!","events_list|id! after:n limit:n","expert_run_get|id! runId!","context_get|id! runId!");
        writes("task",false,"任务元数据","update|id! data:o!");writes("task",true,"真实项目任务","create|projectId! data:o!","run_start|id! data:o!","run_command|id! runId! data:o!");
        reads("session","已有会话授权","grant_list|limit:n offset:n","read|id! after:n limit:n");writes("session",true,"撤销已有会话授权","grant_revoke|id!");
        reads("artifact","不可变成果版本","list|projectId! limit:n offset:n","get|projectId! id! version:n!","version_list|projectId! id! limit:n offset:n","read|projectId! id! version:n!");writes("artifact",true,"将授权文件导入目标项目","import|projectId! taskId file:o! name");
        reads("workflow","真实工作流","list|limit:n offset:n query","get|id!","source_get|id! path!","revision_list|id! path! limit:n offset:n");
        writes("workflow",true,"真实工作流","create|data:o!","retry|id!","definition_save|id! data:o!","validate|id! data:o!","source_save|id! path! data:o!","restore|id! path! data:o!","archive|id! data:o!");
        reads("workflow_task","工作流运行","list|workflowId! limit:n offset:n","get|id!","events_list|id! after:n limit:n","log_get|id! step! attempt:n!");
        writes("workflow_task",true,"工作流运行控制","create|workflowId! data:o!","retry|id!","command|id! action! data:o!","preview|id! data:o!");
        reads("workflow_artifact","工作流成果","list|workflowId! limit:n offset:n","read|workflowId! id!");
        reads("knowledge","授权知识目录","driver_list|","connection_list|limit:n offset:n","target_list|kind! limit:n offset:n","scope_get|kind! id!");writes("knowledge",false,"知识引用","reference_set|kind! id! action! revision:n! connectionId collectionId referenceId");
        reads("knowledge_library","可访问知识库","list|connectionId! limit:n offset:n","get|connectionId! collectionId!","references_get|connectionId! collectionId!");
        writes("knowledge_library",true,"知识库业务信息","create|connectionId! data:o!","update|connectionId! collectionId! data:o!","delete|connectionId! collectionId!");
        for(String[] row:new String[][]{{"capabilities_get","capabilities"},{"search","search"},{"answer","answer"},{"chunk_get","chunk"},{"entity_graph_get","graph"},{"gallery_get","gallery"}})add("knowledge",false,true,row[0],"授权知识能力："+row[1],"connectionId","collectionId","kind","id","referenceId","data:o!");
        reads("knowledge_document","知识文档","list|connectionId! collectionId! data:o","get|connectionId! collectionId! id!","read|connectionId collectionId kind id referenceId data:o!","parse_status|connectionId! collectionId! id!","export|connectionId! collectionId! id!","source_read|connectionId collectionId kind id referenceId data:o!");
        writes("knowledge_document",true,"知识文档维护","create|connectionId! collectionId! source! data:o!","update|connectionId! collectionId! id! data:o!","delete|connectionId! collectionId! id!","parse_command|connectionId! collectionId! id! action!","file_add|connectionId! collectionId! file:o! relativePath");
        reads("faq","FAQ","list|connectionId! collectionId! data:o","get|connectionId! collectionId! id!","export|connectionId! collectionId! format!");
        writes("faq",true,"FAQ 内容维护","save|mode! connectionId! collectionId! id data:o!","delete|connectionId! collectionId! data:o!","batch_update|connectionId! collectionId! action! data:o!","import|connectionId! collectionId! data:o! file:o format");
        reads("knowledge_tag","知识标签","list|connectionId! collectionId! data:o");writes("knowledge_tag",true,"知识标签","save|mode! connectionId! collectionId! id data:o!","delete|connectionId! collectionId! id!");
        reads("wiki_page","Wiki 页面","list|connectionId! collectionId! data:o","get|connectionId! collectionId! id!");
        writes("wiki_page",true,"Wiki 页面","save|mode! connectionId! collectionId! id data:o!","delete|connectionId! collectionId! id!","move|connectionId! collectionId! data:o!");
        reads("wiki_folder","Wiki 目录","list|connectionId! collectionId! data:o");writes("wiki_folder",true,"Wiki 目录","save|mode! connectionId! collectionId! id data:o!","delete|connectionId! collectionId! id!");
        reads("wiki","Wiki 结构与质量","revision_list|connectionId! collectionId! id! data:o","index_get|connectionId! collectionId! data:o","stats_get|connectionId! collectionId!","lint_get|connectionId! collectionId!","issue_list|connectionId! collectionId!","graph_get|connectionId! collectionId!");
        writes("wiki",true,"Wiki 维护","revert|connectionId! collectionId! data:o!","issue_set|connectionId! collectionId! id! data:o!","links_rebuild|connectionId! collectionId!","autofix|connectionId! collectionId!");
        reads("knowledge_creation","知识库创建模板","template_list|limit:n offset:n");writes("knowledge_creation",true,"模板化知识库创建","submit|data:o!");
        reads("knowledge_creation_job","知识库创建作业","list|limit:n offset:n","get|id!");writes("knowledge_creation_job",true,"原知识库创建作业","confirm|id! data:o!","retry|id!","recover|id!");
        reads("knowledge_operation","知识内容维护回执","list|limit:n offset:n","import_progress|id!","failure_report|id!");writes("knowledge_operation",true,"原知识内容操作恢复","recover|id!");
        reads("evidence","稳定知识证据","get|taskId! id!","source_read|taskId! id! data:o","media_read|taskId! id!");
        reads("memory","授权记忆","target_list|limit:n offset:n","entry_list|kind! id! offset:n limit:n","get|id!","search|kind! id! query!","cleanup_list|limit:n offset:n","context_get|taskId!");
        writes("memory",false,"有来源的记忆草稿（不可审核发布）","propose|kind! id! data:o!","draft_update|id! data:o!","disable|id! revision:n!","delete|id! revision:n!");writes("memory",true,"记忆原同步操作","retry|id! revision:n!");
        reads("model","本人已保存模型（无密钥与地址）","catalog_list|limit:n offset:n","settings_get|");
        reads("admin","按原管理员权限提供脱敏查询","status_get|kind!","catalog_get|kind! id limit:n offset:n");
    }
    private void reads(String g,String d,String... rows){for(String row:rows)row(g,false,true,d,row);}
    private void writes(String g,boolean remote,String d,String... rows){for(String row:rows)row(g,true,remote,d,row);}
    private void row(String g,boolean w,boolean r,String d,String row){String[] pair=row.split("\\|",-1);add(g,w,r,pair[0],d+" · "+pair[0],pair[1].trim().isEmpty()?new String[0]:pair[1].split(" +"));}
    private void add(String g,boolean w,boolean r,String n,String d,String... fields){Map<String,Object> props=new LinkedHashMap<>();List<String> required=new ArrayList<>();for(String f:fields){boolean req=f.endsWith("!");f=f.replace("!","");String[] p=f.split(":");String type=p.length==1?"string":p[1].equals("n")?"integer":p[1].equals("b")?"boolean":"object";props.put(p[0],map("type",type));if(req)required.add(p[0]);}String name="nw_"+(g.isEmpty()?"":g+"_")+n;if(tools.put(name,new Tool(name,g,d,w,r,map("type","object","properties",props,"required",required,"additionalProperties",false)))!=null)throw new IllegalStateException(name);}
    public Tool get(String name){Tool t=tools.get(name);if(t==null)throw new ApiException(422,"未实现的系统工具");return t;}
    public Collection<Tool> all(){return Collections.unmodifiableCollection(tools.values());}
    public void validate(Tool tool,JsonNode args){
        if(args==null||!args.isObject()||args.toString().length()>1048576)throw new ApiException(422,"工具参数必须为不超过 1 MiB 的对象");
        validateNode(json.valueToTree(tool.schema),args,"参数");
    }
    private void validateNode(JsonNode schema,JsonNode value,String path){
        String type=schema.path("type").asText();
        boolean valid=type.isEmpty()||type.equals("null")&&value.isNull()||type.equals("object")&&value.isObject()||type.equals("array")&&value.isArray()||type.equals("string")&&value.isTextual()||type.equals("integer")&&value.isIntegralNumber()&&value.canConvertToLong()||type.equals("boolean")&&value.isBoolean();
        if(!valid)throw new ApiException(422,path+" 类型无效");
        if(schema.has("enum")){boolean match=false;for(JsonNode option:schema.path("enum"))if(option.equals(value))match=true;if(!match)throw new ApiException(422,path+" 取值无效");}
        if(value.isNumber()&&(schema.has("minimum")&&value.asLong()<schema.path("minimum").asLong()||schema.has("maximum")&&value.asLong()>schema.path("maximum").asLong()))throw new ApiException(422,path+" 超出范围");
        if(value.isObject()){
            for(JsonNode f:schema.path("required"))if(!value.hasNonNull(f.asText()))throw new ApiException(422,path+" 缺少字段："+f.asText());
            value.fields().forEachRemaining(e->{if(schema.path("additionalProperties").isBoolean()&&!schema.path("additionalProperties").asBoolean()&&!schema.path("properties").has(e.getKey()))throw new ApiException(422,path+" 不支持字段："+e.getKey());if(schema.path("properties").has(e.getKey()))validateNode(schema.path("properties").path(e.getKey()),e.getValue(),path+"."+e.getKey());});
        }
        if(value.isArray()&&schema.has("items"))for(JsonNode item:value)validateNode(schema.path("items"),item,path+"[]");
        for(String union:Arrays.asList("oneOf","anyOf"))if(schema.has(union)){int matches=0;for(JsonNode branch:schema.path(union))try{validateNode(branch,value,path);matches++;}catch(ApiException ignored){}if(matches==0||union.equals("oneOf")&&matches!=1)throw new ApiException(422,path+" 不符合所需参数组合");}
    }
}
