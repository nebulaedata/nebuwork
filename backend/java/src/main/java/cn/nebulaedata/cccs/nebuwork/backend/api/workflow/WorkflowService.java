package cn.nebulaedata.cccs.nebuwork.backend.api.workflow;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.expert.ExpertService;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.io.OutputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.workflow.WorkflowStore.*;

@Service
public class WorkflowService {
    private final WorkflowStore db;private final WorkflowSettings settings;private final WorkflowClient client;private final ObjectMapper json;
    public WorkflowService(WorkflowStore db,WorkflowSettings settings,WorkflowClient client,ObjectMapper json) { this.db=db;this.settings=settings;this.client=client;this.json=json; }
    public Map<String,Object> dto(Map<String,Object> row) {
        return map("id",row.get("id"),"name",row.get("name"),"description",row.get("description"),"status",row.get("state"),"error",row.get("error"),"archived",flag(row.get("archived")),"createdAt",Objects.toString(row.get("created_at"),null));
    }
    public Object list(String actor) {
        List<Object> items=new ArrayList<>();for(Map<String,Object> row:db.rows("SELECT * FROM nw_workflow WHERE owner_id=? ORDER BY created_at DESC",actor))items.add(dto(row));
        return map("enabled",settings.current().enabled,"items",items);
    }
    @Transactional public Object create(String actor,JsonNode body,String key) {
        db.settings(true);settings.requireEnabled();Map<String,Object> request=settings.reserve(actor,key,"workflow-create",body);
        if(request.get("result_json")!=null)return settings.decode(request.get("result_json"));
        Map<String,Object> row=insert(actor,WorkflowSettings.text(body,"name",160,true),WorkflowSettings.text(body,"description",2000,false));Object result=dto(row);settings.finish(actor,key,result);return result;
    }
    /** Participates in the caller's SOP transaction, including the same destination lock. */
    public Map<String,Object> insert(String actor,String name,String description) {
        db.settings(true);settings.requireEnabled();String id=ExpertService.id("wf");
        db.update("INSERT INTO nw_workflow(id,owner_id,remote_id,name,description) VALUES(?,?,?,?,?)",id,actor,"nw-"+UUID.randomUUID().toString().replace("-",""),name,description);
        return db.owned("nw_workflow",id,actor);
    }
    public void link(String actor,String sop,String workflow) { db.owned("nw_workflow",workflow,actor);db.update("INSERT INTO nw_sop_workflow(owner_id,sop_id,workflow_id) VALUES(?,?,?)",actor,sop,workflow); }
    public Map<String,Object> forSop(String actor,String sop) {
        Map<String,Object> row=db.one("SELECT w.* FROM nw_workflow w JOIN nw_sop_workflow s ON s.workflow_id=w.id AND s.owner_id=w.owner_id WHERE s.owner_id=? AND s.sop_id=?",actor,sop);
        return row==null?null:dto(row);
    }
    public void unlinkSop(String sop) { db.update("DELETE FROM nw_sop_workflow WHERE sop_id=?",sop); }
    public Map<String,Object> get(String actor,String id) {
        Map<String,Object> row=db.owned("nw_workflow",id,actor),result=dto(row);result.put("enabled",settings.current().enabled);
        if("ready".equals(row.get("state"))&&settings.current().enabled)result.put("workflow",request(row,"GET","",null));return result;
    }
    private Map<String,Object> ready(String actor,String id) {
        Map<String,Object> row=db.owned("nw_workflow",id,actor);if(!"ready".equals(row.get("state")))throw new ApiException(409,"工作流尚未创建完成");return row;
    }
    private JsonNode request(Map<String,Object> row,String method,String suffix,Object body) {
        return client.request(settings.requireEnabled(),method,"/api/v1/workflows/"+str(row,"remote_id")+suffix,body);
    }
    public Object definition(String actor,String id,JsonNode body) {
        Map<String,Object> row=ready(actor,id);ObjectNode payload=payload(body);payload.retain("definition","expected_revision");
        JsonNode result=request(row,"PUT","/definition",payload);db.update("UPDATE nw_workflow SET name=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=?",result.path("name").asText(),id);return result;
    }
    public Object validate(String actor,String id,JsonNode body) { ObjectNode p=payload(body);p.retain("definition");return request(ready(actor,id),"POST","/validate",p); }
    public Object source(String actor,String id,String path,JsonNode body) {
        Map<String,Object> row=ready(actor,id);String suffix="/source?path="+enc(path);
        if(body==null)return request(row,"GET",suffix,null);
        ObjectNode p=payload(body);p.retain("content","expected_revision");return request(row,"PUT",suffix,p);
    }
    public Object revisions(String actor,String id,String path) { return request(ready(actor,id),"GET","/revisions?path="+enc(path),null); }
    public Object restore(String actor,String id,String path,JsonNode body) { ObjectNode p=payload(body);p.retain("revision_id","expected_revision");return request(ready(actor,id),"POST","/restore?path="+enc(path),p); }
    public Object archive(String actor,String id,JsonNode body) {
        if(!body.path("archived").isBoolean())throw new ApiException(422,"归档开关必须是布尔值");
        Map<String,Object> row=ready(actor,id);Object result=request(row,"POST","/archive",map("archived",body.path("archived").asBoolean()));
        db.update("UPDATE nw_workflow SET archived=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=?",body.path("archived").asBoolean(),id);return result;
    }
    @Transactional public Object retry(String actor,String id,boolean task) {
        settings.requireEnabled();String table=task?"nw_workflow_task":"nw_workflow";Map<String,Object> row=db.owned(table,id,actor);
        if(!"failed".equals(row.get("state")))throw new ApiException(409,"只允许重试失败的创建操作");
        db.update("UPDATE "+table+" SET state='pending',error=NULL,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND state='failed'",id);
        return task?taskDto(db.owned(table,id,actor)):dto(db.owned(table,id,actor));
    }
    @Transactional public Object createTask(String actor,String workflow,JsonNode body,String key) {
        Map<String,Object> flow=ready(actor,workflow);settings.requireEnabled();if(flag(flow.get("archived")))throw new ApiException(409,"归档工作流不能运行");
        Map<String,Object> request=settings.reserve(actor,key,"task-create:"+workflow,body);
        if(request.get("result_json")!=null)return settings.decode(request.get("result_json"));
        String input=settings.encode(body.has("input")?body.get("input"):json.createObjectNode());if(input.length()>1000000)throw new ApiException(422,"运行输入超过大小限制");
        String id=ExpertService.id("wft");db.update("INSERT INTO nw_workflow_task(id,owner_id,workflow_id,input_json) VALUES(?,?,?,?)",id,actor,workflow,input);
        Object result=taskDto(db.owned("nw_workflow_task",id,actor));settings.finish(actor,key,result);return result;
    }
    public Map<String,Object> taskDto(Map<String,Object> row) { return map("id",row.get("id"),"workflowId",row.get("workflow_id"),"status",row.get("state"),"error",row.get("error"),"createdAt",Objects.toString(row.get("created_at"),null)); }
    public Object tasks(String actor,String id) {
        Map<String,Object> flow=ready(actor,id);Map<String,JsonNode> remote=new HashMap<>();
        for(JsonNode t:client.request(settings.requireEnabled(),"GET","/api/v1/tasks?workflow_id="+str(flow,"remote_id")+"&limit=1000",null))remote.put(t.path("id").asText(),t);
        List<Object> result=new ArrayList<>();
        for(Map<String,Object> row:db.rows("SELECT * FROM nw_workflow_task WHERE owner_id=? AND workflow_id=? ORDER BY created_at DESC LIMIT 100",actor,id)) {
            Map<String,Object> item=taskDto(row);item.put("task",remote.get(str(row,"remote_id")));result.add(item);
        }return result;
    }
    public Object task(String actor,String id) {
        Map<String,Object> row=db.owned("nw_workflow_task",id,actor),result=taskDto(row);result.put("enabled",settings.current().enabled);
        if(!str(row,"remote_id").isEmpty()&&Arrays.asList("ready","failed").contains(row.get("state"))&&settings.current().enabled)result.put("task",remoteTask(row));return result;
    }
    private Map<String,Object> taskReady(String actor,String id) { Map<String,Object> row=db.owned("nw_workflow_task",id,actor);if(str(row,"remote_id").isEmpty()||!Arrays.asList("ready","failed").contains(row.get("state")))throw new ApiException(409,"运行创建尚未完成");return row; }
    private JsonNode remoteTask(Map<String,Object> row) { return client.request(settings.requireEnabled(),"GET","/api/v1/tasks/"+str(row,"remote_id"),null); }
    public Object control(String actor,String id,String action,JsonNode body,String key) {
        if(!Arrays.asList("start","pause","resume","cancel","rerun").contains(action))throw new ApiException(422,"不支持的运行操作");
        if(key==null||!key.matches("[A-Za-z0-9_-]{8,100}"))throw new ApiException(422,"缺少操作编号");
        Map<String,Object> row=taskReady(actor,id);ObjectNode p=payload(body);p.retain("expected_version","from_steps","expected_environment");
        p.put("command_id","nw-"+UUID.nameUUIDFromBytes((actor+"\n"+id+"\n"+action+"\n"+key).getBytes(StandardCharsets.UTF_8)).toString().replace("-",""));
        Object result=client.request(settings.requireEnabled(),"POST","/api/v1/tasks/"+str(row,"remote_id")+"/actions/"+action,p);
        if("failed".equals(row.get("state")))db.update("UPDATE nw_workflow_task SET state='ready',error=NULL WHERE id=? AND state='failed'",id);
        return result;
    }
    public Object preview(String actor,String id,JsonNode body) { ObjectNode p=payload(body);p.retain("from_steps");return client.request(settings.requireEnabled(),"POST","/api/v1/tasks/"+str(taskReady(actor,id),"remote_id")+"/preview",p); }
    public Object events(String actor,String id,long after) { return client.request(settings.requireEnabled(),"GET","/api/v1/tasks/"+str(taskReady(actor,id),"remote_id")+"/events?after="+Math.max(0,after),null); }
    public Object logs(String actor,String id,String step,int attempt) { return client.request(settings.requireEnabled(),"GET","/api/v1/tasks/"+str(taskReady(actor,id),"remote_id")+"/logs?step="+enc(step)+"&attempt="+attempt,null); }
    public Object artifacts(String actor,String id) { return request(ready(actor,id),"GET","/artifacts",null); }
    private JsonNode authorizedArtifact(String actor,String workflow,String artifact) {
        for(JsonNode a:request(ready(actor,workflow),"GET","/artifacts",null))if(artifact.equals(a.path("id").asText()))return a;
        throw new ApiException(404,"产物不存在");
    }
    public Object content(String actor,String workflow,String artifact) { authorizedArtifact(actor,workflow,artifact);return client.request(settings.requireEnabled(),"GET","/api/v1/artifacts/"+enc(artifact)+"/content",null); }
    public Download download(String actor,String workflow,String artifact) {
        JsonNode a=authorizedArtifact(actor,workflow,artifact);return new Download(settings.requireEnabled(),"/api/v1/artifacts/"+enc(artifact)+"/download",a.path("filename").asText("artifact"));
    }
    public class Download {
        public final String filename;private final WorkflowSettings.Connection connection;private final String path;
        Download(WorkflowSettings.Connection c,String path,String filename) { connection=c;this.path=path;this.filename=filename; }
        public void write(OutputStream output) { client.download(connection,path,output); }
    }
    static String enc(String value) { try{return URLEncoder.encode(value,"UTF-8");}catch(Exception e){throw new IllegalArgumentException(e);} }
    private ObjectNode payload(JsonNode body) { if(body==null||!body.isObject())throw new ApiException(422,"请求必须是 JSON 对象");return body.deepCopy(); }
}
