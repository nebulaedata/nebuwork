package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.*;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;

/** Frozen references and narrowly additive creation grants. Workers never receive database credentials. */
@Service
public class DatabaseRuntime {
    final DatabaseService databases;final AgentStore db;final ObjectMapper json;final AgentRequests requests;final ObjectProvider<AgentBridge> bridge;
    public DatabaseRuntime(DatabaseService databases,AgentStore db,ObjectMapper json,AgentRequests requests,ObjectProvider<AgentBridge> bridge){this.databases=databases;this.db=db;this.json=json;this.requests=requests;this.bridge=bridge;}
    public void capture(String owner,String project,String primary,ObjectNode manifest){
        if(!databases.enabled())return;databases.objects.storage(owner);Map<String,Object> p=db.one("SELECT workbench_id FROM nw_project WHERE owner_id=? AND id=?",owner,project);if(p==null)throw new ApiException(404,"数据库运行项目不存在");String wb=str(p,"workbench_id");
        ArrayNode common=databases.references(owner,"workbench",wb);common.addAll(databases.references(owner,"project",project));ArrayNode main=common.deepCopy();if(primary!=null&&!primary.isEmpty())main.addAll(databases.references(owner,"expert",primary));
        manifest.put("workbenchId",wb);manifest.set("databaseReferences",main);
        for(JsonNode expert:manifest.path("experts")){ObjectNode runtime=((ObjectNode)expert).with("runtime");ArrayNode refs=common.deepCopy();refs.addAll(databases.references(owner,"expert",expert.path("id").asText()));runtime.set("databaseReferences",refs);if(runtime.has("businessTools"))addTools(runtime);}
        if(manifest.has("businessTools"))addTools(manifest);
    }
    public void addTools(ObjectNode manifest){ArrayNode tools=manifest.withArray("businessTools");for(int i=tools.size()-1;i>=0;i--)if(tools.get(i).path("capability").asText().equals("database"))tools.remove(i);if(databases.enabled()&&manifest.has("databaseReferences"))tools.addAll(tools());}
    ArrayNode tools(){
        ArrayNode out=json.createArrayNode();Map<String,Object> props=new LinkedHashMap<>();
        for(String field:Arrays.asList("databaseId","operationId","name","description","table","sql","format","sheet","encoding"))props.put(field,map("type","string"));
        props.put("waitMs",map("type","integer","minimum",0,"maximum",20000));props.put("params",map("type","array","items",map("type",Arrays.asList("string","number","boolean","null"))));
        props.put("rows",map("type","array","minItems",1,"maxItems",10000,"items",map("type","object")));props.put("source",map("type","object","properties",map("projectId",map("type","string"),"artifactId",map("type","string"),"version",map("type","integer","minimum",1)),"required",Arrays.asList("projectId","artifactId","version"),"additionalProperties",false));
        props.put("mapping",map("type","array","items",map("type","object")));props.put("createTable",map("type","object"));
        add(out,props,"list","查看本轮数据库及本轮新建的数据库","read");
        add(out,props,"schema","读取数据库表和字段、主键、索引；返回操作编号后查询实际结果","idempotent","databaseId");
        add(out,props,"query","提交单条只读 SQL。排队不代表完成，使用 database_operation_get 等待结果","idempotent","databaseId","sql");
        add(out,props,"execute","提交已授权的单条数据写入或表/索引变更，不支持事务控制或管理 SQL","idempotent","databaseId","sql");
        add(out,props,"insert_rows","按字段对象批量存入生成的数据；整批数据提交或回滚","idempotent","databaseId","table","rows");
        add(out,props,"create","新建 SQLite；主任务创建项目库，协作专家创建自己的库，创建后立即可用","idempotent","name");
        add(out,props,"import","从明确 artifactId/version 的 CSV/XLSX 导入；须提供字段映射，默认追加","idempotent","databaseId","table","source","mapping");
        add(out,props,"export","将表或只读 SQL 结果导出 CSV/XLSX 并保存为项目成果","idempotent","databaseId","format");
        add(out,props,"operation_get","等待数据库操作的真实结果；unknown 表示结果待核对，不得重复写入","read","databaseId","operationId");return out;
    }
    void add(ArrayNode out,Map<String,Object> all,String operation,String description,String replay,String...required){
        Map<String,Object> props=new LinkedHashMap<>();List<String> fields;
        switch(operation){case "list":fields=Collections.emptyList();break;case "create":fields=Arrays.asList("name","description");break;
            case "operation_get":fields=Arrays.asList("databaseId","operationId","waitMs");break;case "schema":fields=Arrays.asList("databaseId","table");break;
            case "insert_rows":fields=Arrays.asList("databaseId","table","rows");break;case "import":fields=Arrays.asList("databaseId","table","source","mapping","sheet","encoding","createTable");break;
            case "export":fields=Arrays.asList("databaseId","table","sql","params","format","name");break;default:fields=Arrays.asList("databaseId","sql","params");}
        for(String f:fields)props.put(f,all.get(f));out.add(json.valueToTree(map("name","database_"+operation,"description",description,"capability","database","operation",operation,"replay",replay,"required",false,"parameters",map("type","object","properties",props,"required",Arrays.asList(required),"additionalProperties",false))));
    }
    ArrayNode references(JsonNode run){
        ArrayNode refs=json.createArrayNode();refs.addAll((ArrayNode)(run.path("manifest").path("databaseReferences").isArray()?run.path("manifest").path("databaseReferences"):json.createArrayNode()));Set<String> seen=new HashSet<>();for(JsonNode ref:refs)seen.add(ref.path("id").asText());
        String owner=run.path("ownerId").asText(),id=run.path("id").asText(),parent=run.path("parentRunId").asText("");
        for(Map<String,Object> grant:db.rows("SELECT g.* FROM nw_database_run_grant g WHERE g.owner_id=? AND (g.run_id=? OR (g.run_id=? AND g.include_children=TRUE))",owner,id,parent)){
            if(!seen.add(str(grant,"database_id")))continue;try{refs.add(databases.reference(databases.owned(owner,str(grant,"database_id")),number(grant,"config_version")));}catch(ApiException ignored){}}
        return refs;
    }
    JsonNode reference(JsonNode run,String id){
        for(JsonNode ref:references(run))if(id.equals(ref.path("id").asText())){
            Map<String,Object> p=db.one("SELECT workbench_id FROM nw_project WHERE id=? AND owner_id=?",run.path("projectId").asText(),run.path("ownerId").asText());if(p==null)throw new ApiException(403,"项目数据库授权已撤销");
            String kind=ref.path("scopeKind").asText(),scope=ref.path("scopeId").asText();
            if(kind.equals("project")?!scope.equals(run.path("projectId").asText()):kind.equals("workbench")?!scope.equals(str(p,"workbench_id")):!scope.equals(run.path("manifest").path("primaryExpertId").asText()))throw new ApiException(403,"数据库不属于当前执行专家或项目");
            Map<String,Object> row=databases.owned(run.path("ownerId").asText(),id);if(!kind.equals(str(row,"scope_kind"))||!scope.equals(str(row,"scope_id")))throw new ApiException(403,"数据库来源不匹配");
            databases.active(run.path("ownerId").asText(),id,ref.path("configVersion").asLong());return ref;
        }throw new ApiException(403,"数据库不属于本轮冻结范围或本轮新建资源");
    }
    public void authorizeArguments(JsonNode run,String operation,JsonNode args){
        databases.settings.require();if(operation.equals("list")||operation.equals("create"))return;JsonNode ref=reference(run,text(args,"databaseId",128,true));
        if(!operation.equals("operation_get"))databases.requirePermission(databases.active(run.path("ownerId").asText(),ref.path("id").asText(),ref.path("configVersion").asLong()),operation,args);
    }
    public Object tool(String owner,Map<String,Object> task,JsonNode run,String operation,JsonNode args,String callKey){
        authorizeArguments(run,operation,args);
        if(operation.equals("list")){ArrayNode allowed=json.createArrayNode(),problems=json.createArrayNode();for(JsonNode ref:references(run))try{reference(run,ref.path("id").asText());ObjectNode item=ref.deepCopy();item.set("permissions",databases.active(owner,ref.path("id").asText(),ref.path("configVersion").asLong()).path("permissions"));allowed.add(item);}catch(ApiException e){problems.add(json.valueToTree(map("id",ref.path("id"),"reason",e.getMessage())));}return map("databases",allowed,"problems",problems);}
        if(operation.equals("create")){
            boolean child=run.hasNonNull("parentRunId");String kind=child?"expert":"project",target=child?run.path("manifest").path("primaryExpertId").asText():run.path("projectId").asText();if(target.isEmpty())throw new ApiException(403,"协作专家身份缺失，无法创建专家数据库");
            ObjectNode body=args.deepCopy();body.put("type","sqlite");return requests.once(owner,"database-create:"+kind+":"+target,callKey,body,()->databases.create(owner,kind,target,body,callKey,run));
        }
        String database=args.path("databaseId").asText();JsonNode ref=reference(run,database);
        if(operation.equals("operation_get")){
            long deadline=System.currentTimeMillis()+Math.max(0,Math.min(20000,args.path("waitMs").asInt()));Object result;
            do{result=databases.operation(owner,database,args.path("operationId").asText());if(!Arrays.asList("queued","running").contains(((Map<?,?>)result).get("state")))break;if(System.currentTimeMillis()>=deadline)break;try{Thread.sleep(200);}catch(InterruptedException e){Thread.currentThread().interrupt();break;}}while(true);reference(run,database);if("unknown".equals(((Map<?,?>)result).get("state"))&&"export".equals(((Map<?,?>)result).get("operation")))result=databases.reconcileExport(owner,database,args.path("operationId").asText());return result;
        }
        ObjectNode payload=args.deepCopy();payload.remove("databaseId");ObjectNode body=json.valueToTree(map("operation",operation,"arguments",payload,"configVersion",ref.path("configVersion"),"projectId",task.get("project_id"),"taskId",task.get("id")));
        ObjectNode identity=json.valueToTree(map("tenantId",run.path("tenantId"),"ownerId",owner,"projectId",run.path("projectId"),"sessionId",run.path("sessionId"),"runId",run.path("id"),"manifestHash",run.path("manifestHash")));
        return databases.submit(owner,database,body,callKey,identity);
    }
    public void authorizeOperation(Map<String,Object> operation){if(operation.get("identity_json")==null)return;ObjectNode identity=(ObjectNode)decode(json,operation.get("identity_json"));identity.put("kind","tool").put("resourceId","database_"+operation.get("operation"));JsonNode decision=json.valueToTree(bridge.getObject().authorize(identity));if(!decision.path("allowed").asBoolean())throw new ApiException(403,"数据库操作的运行授权已撤销");
        JsonNode run=databases.engine.get(str(operation,"owner_id"),str(operation,"project_id"),"/v1/runs/"+AgentClient.segment(str(operation,"run_id")));reference(run,str(operation,"database_id"));
    }
}
