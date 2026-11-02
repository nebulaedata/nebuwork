package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Service;
import java.time.*;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;

/** Account-scoped read projection. Engine metering is authoritative; Java joins business identity. */
@Service
public class AgentUsage {
    private final AgentClient engine; private final AgentStore db; private final ObjectMapper json;
    public AgentUsage(AgentClient engine,AgentStore db,ObjectMapper json){this.engine=engine;this.db=db;this.json=json;}
    public JsonNode load(String owner,String project){
        try {JsonNode result=engine.get(owner,project,"/v1/usage"+(project==null?"":"?projectId="+AgentClient.segment(project)));if(result!=null&&result.path("summary").isObject()&&result.path("tasks").isArray())return result;}
        catch(RuntimeException ignored) { /* Keep configuration available; unavailable is never zero. */ }
        return json.createObjectNode().put("unavailable",true);
    }
    public Map<String,Object> empty(){return map("inputTokens",0L,"outputTokens",0L,"cacheReadTokens",0L,"cacheWriteTokens",0L,"totalTokens",0L,"callCount",0L,"unknownCalls",0L,"pendingCalls",0L,"usageKnown",true,"cost",null,"tasks",0,"activeRuns",0,"successRate",null);}
    public Map<String,Object> unavailable(){Map<String,Object> result=empty();for(String field:Arrays.asList("inputTokens","outputTokens","cacheReadTokens","cacheWriteTokens","totalTokens","callCount","unknownCalls","pendingCalls","activeRuns","tasks"))result.put(field,null);result.put("usageKnown",false);result.put("unavailable",true);return result;}
    public Map<String,Object> value(JsonNode node){if(node==null||!node.isObject())return empty();Map<String,Object> result=empty();result.putAll(json.convertValue(node,Map.class));result.put("cost",null);return result;}
    public Map<String,Object> scoped(JsonNode data,String group,String id){if(data.path("unavailable").asBoolean())return unavailable();for(JsonNode node:data.path(group))if(id.equals(node.path("id").asText()))return value(node);return empty();}
    public List<Map<String,Object>> tasks(String owner,JsonNode data,String project){
        Map<String,JsonNode> remote=new HashMap<>();for(JsonNode task:data.path("tasks"))remote.put(task.path("taskId").asText(),task);
        List<Map<String,Object>> result=new ArrayList<>();
        String sql="SELECT t.*,p.name AS project_name,p.workbench_id FROM nw_agent_task t JOIN nw_project p ON p.id=t.project_id WHERE t.owner_id=? AND p.owner_id=? AND t.deleted_at IS NULL"+(project==null?"":" AND t.project_id=?")+" ORDER BY t.updated_at DESC,t.id DESC";
        for(Map<String,Object> row:project==null?db.rows(sql,owner,owner):db.rows(sql,owner,owner,project)){
            JsonNode task=remote.get(str(row,"id"));Map<String,Object> usage=task==null?unavailable():value(task);
            result.add(map("id",row.get("id"),"projectId",row.get("project_id"),"project",row.get("project_name"),"workbenchId",row.get("workbench_id"),"sessionId",row.get("session_id"),"title",row.get("title"),"status",task==null?"unavailable":task.path("status").asText("idle"),"createdAt",time(row.get("created_at")),"updatedAt",task==null?time(row.get("updated_at")):task.path("updatedAt").asText(),"usage",usage,"tokens",usage.get("totalTokens"),"context",decode(json,row.get("context_json"))));
        }
        return result;
    }
    public Map<String,Object> projectStats(JsonNode data,String project,List<Map<String,Object>> tasks){Map<String,Object> result=scoped(data,"projects",project);result.put("tasks",tasks.size());result.put("tokens",result.get("totalTokens"));return result;}
    public void projects(String owner,List<Map<String,Object>> projects){JsonNode data=load(owner,null);List<Map<String,Object>> all=tasks(owner,data,null);for(Map<String,Object> project:projects){String id=str(project,"id");List<Map<String,Object>> selected=new ArrayList<>();for(Map<String,Object> task:all)if(id.equals(task.get("projectId")))selected.add(task);project.put("stats",projectStats(data,id,selected));project.put("sessions",selected);project.put("usage",projectUsage(data,id));}}
    public Map<String,Object> projectUsage(JsonNode data,String project){Map<String,Object> result=scoped(data,"projects",project);List<Object> days=new ArrayList<>();for(JsonNode day:data.path("projectDaily"))if(project.equals(day.path("projectId").asText()))days.add(value(day));result.put("daily",days);return result;}
    public Map<String,Object> add(List<Map<String,Object>> values){
        Map<String,Object> result=empty();boolean available=true,known=true;long calls=0,unknown=0,pending=0;int taskCount=0,active=0;
        for(Map<String,Object> value:values){available&=!Boolean.TRUE.equals(value.get("unavailable"));known&=Boolean.TRUE.equals(value.get("usageKnown"));calls+=number(value,"callCount");unknown+=number(value,"unknownCalls");pending+=number(value,"pendingCalls");taskCount+=number(value,"tasks");active+=number(value,"activeRuns");}
        if(!available)return unavailable();
        for(String key:Arrays.asList("inputTokens","outputTokens","cacheReadTokens","cacheWriteTokens","totalTokens")){long total=0;boolean measured=false;for(Map<String,Object> value:values){Object n=value.get(key);if(n instanceof Number){total+=((Number)n).longValue();measured|=number(value,"callCount")>0;}}result.put(key,calls>0&&!measured?null:total);}
        result.putAll(map("callCount",calls,"unknownCalls",unknown,"pendingCalls",pending,"usageKnown",known,"tasks",taskCount,"activeRuns",active));return result;
    }
    private long number(Map<String,Object> row,String key){Object n=row.get(key);return n instanceof Number?((Number)n).longValue():0;}
    public void workbenches(String owner,List<Map<String,Object>> workbenches){
        JsonNode data=load(owner,null);List<Map<String,Object>> tasks=tasks(owner,data,null);
        Map<String,String> projectWorkbench=new HashMap<>();for(Map<String,Object> p:db.rows("SELECT id,workbench_id FROM nw_project WHERE owner_id=?",owner))projectWorkbench.put(str(p,"id"),str(p,"workbench_id"));
        String today=LocalDate.now(ZoneOffset.ofHours(8)).toString();
        for(Map<String,Object> wb:workbenches){
            String id=str(wb,"id");List<Map<String,Object>> values=new ArrayList<>();
            for(Map.Entry<String,String> p:projectWorkbench.entrySet())if(id.equals(p.getValue()))values.add(scoped(data,"projects",p.getKey()));
            Map<String,Object> summary=data.path("unavailable").asBoolean()?unavailable():add(values);
            Map<String,List<Map<String,Object>>> days=new TreeMap<>();
            for(JsonNode day:data.path("projectDaily"))if(id.equals(projectWorkbench.get(day.path("projectId").asText())))days.computeIfAbsent(day.path("date").asText(),key->new ArrayList<>()).add(value(day));
            List<Object> daily=new ArrayList<>();Object tokenToday=data.path("unavailable").asBoolean()?null:0L;
            for(Map.Entry<String,List<Map<String,Object>>> day:days.entrySet()){Map<String,Object> combined=add(day.getValue());combined.put("date",day.getKey());combined.put("tokens",combined.get("totalTokens"));daily.add(combined);if(today.equals(day.getKey()))tokenToday=combined.get("totalTokens");}
            int count=0;for(Map<String,Object> task:tasks)if(id.equals(task.get("workbenchId")))count++;
            summary.put("tasks",count);summary.put("tokens",summary.get("totalTokens"));summary.put("daily",daily);
            wb.put("taskStats",summary);wb.put("stats",map("running",summary.get("activeRuns"),"tokenToday",tokenToday));
        }
    }
    public void expertProfiles(String owner,List<Map<String,Object>> experts){JsonNode data=load(owner,null);for(Map<String,Object> expert:experts){Map<String,Object> stats=scoped(data,"experts",str(expert,"id"));stats.put("tokens",stats.get("totalTokens"));expert.put("stats",stats);}}
    public Map<String,Object> expert(String owner,String expert,int offset){
        JsonNode data;
        try{data=engine.get(owner,null,"/v1/experts/"+AgentClient.segment(expert)+"/tasks?offset="+offset+"&limit=50");if(data==null||!data.path("summary").isObject())throw new IllegalStateException();}
        catch(RuntimeException error){return map("tasks",Collections.emptyList(),"taskTotal",null,"hasMore",false,"usage",withDaily(unavailable(),json.createArrayNode()),"stats",unavailable());}
        Map<String,Object> statistics=value(data.path("summary"));statistics.put("tokens",statistics.get("totalTokens"));
        Map<String,Map<String,Object>> owned=new HashMap<>();for(Map<String,Object> task:db.rows("SELECT t.id,t.title,t.project_id,p.name AS project_name FROM nw_agent_task t JOIN nw_project p ON p.id=t.project_id WHERE t.owner_id=? AND p.owner_id=? AND t.deleted_at IS NULL",owner,owner))owned.put(str(task,"id"),task);
        List<Object> list=new ArrayList<>();for(JsonNode node:data.path("tasks")){Map<String,Object> task=owned.get(node.path("taskId").asText());if(task==null)continue;Map<String,Object> item=value(node);item.putAll(map("id",task.get("id"),"title",task.get("title"),"project",task.get("project_name"),"projectId",task.get("project_id"),"time",node.path("participatedAt").asText(),"tokens",node.get("totalTokens")));list.add(item);}
        Map<String,Object> detail=withDaily(statistics,data.path("daily"));detail.put("taskStates",data.path("taskStates").isArray()?data.get("taskStates"):Collections.emptyList());
        return map("tasks",list,"taskTotal",data.path("taskTotal").asInt(),"offset",offset,"hasMore",data.path("hasMore").asBoolean(),"usage",detail,"stats",statistics);
    }
    private Map<String,Object> withDaily(Map<String,Object> usage,JsonNode days){
        Map<String,JsonNode> byDate=new HashMap<>();for(JsonNode day:days)byDate.put(day.path("date").asText(),day);
        List<Object> daily=new ArrayList<>();LocalDate today=LocalDate.now(ZoneOffset.ofHours(8));for(int i=13;i>=0;i--){String date=today.minusDays(i).toString();JsonNode day=byDate.get(date);Map<String,Object> value=day==null?(Boolean.TRUE.equals(usage.get("unavailable"))?unavailable():empty()):value(day);value.put("date",date);value.put("tokens",value.get("totalTokens"));daily.add(value);}
        Map<String,Object> result=new LinkedHashMap<>(usage);result.put("daily",daily);result.put("executionAvailable",!Boolean.TRUE.equals(usage.get("unavailable")));return result;
    }
}
