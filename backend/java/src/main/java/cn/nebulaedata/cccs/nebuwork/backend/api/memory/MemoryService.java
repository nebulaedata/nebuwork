package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import javax.annotation.PreDestroy;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Supplier;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;

@Service
public class MemoryService {
    private final MemoryStore db;
    private final MemoryScopes scopes;
    private final MemorySettings settings;
    private final ObjectMapper json;
    private final HindsightClient client;
    private final ExecutorService recalls = new ThreadPoolExecutor(4, 4, 0, TimeUnit.SECONDS,
            new ArrayBlockingQueue<>(64), r -> { Thread t = new Thread(r, "memory-recall"); t.setDaemon(true); return t; }, new ThreadPoolExecutor.AbortPolicy());
    public MemoryService(MemoryStore db, MemoryScopes scopes, MemorySettings settings, ObjectMapper json, HindsightClient client) {
        this.db = db; this.scopes = scopes; this.settings = settings; this.json = json; this.client = client;
    }
    @PreDestroy public void close() { recalls.shutdownNow(); }
    public String scopeId(String owner, String kind, String object) { return hash(owner + "\n" + kind + "\n" + object); }
    Map<String,Object> ensureScope(String owner, String kind, String object) {
        settings.lockDestination();
        String id = scopeId(owner, kind, object);
        String bank = "nw-" + hash(settings.instance() + "\n" + id);
        db.update("INSERT INTO nw_memory_scope(id,owner_id,kind,object_id,bank_id) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE id=id", id, owner, kind, object, bank);
        return db.scope(id);
    }
    public Map<String,Object> list(String owner, String kind, String object, int offset) {
        Map<String,Object> scope = scopes.authorize(owner, kind, object, false);
        if (offset < 0 || offset > 100000) throw new ApiException(422, "无效分页");
        List<Map<String,Object>> rows = db.rows("SELECT e.*,s.owner_id,s.kind,s.object_id,s.bank_id FROM nw_memory_entry e JOIN nw_memory_scope s ON s.id=e.scope_id WHERE e.scope_id=? AND (e.state<>'deleted' OR e.sync_state<>'ready') ORDER BY e.created_at DESC,e.id LIMIT 51 OFFSET ?", scopeId(owner,kind,object), offset);
        boolean more = rows.size() > 50;
        List<Map<String,Object>> items = new ArrayList<>();
        for (Map<String,Object> e : rows.subList(0,Math.min(50,rows.size()))) items.add(view(e));
        return map("scope",scope,"items",items,"hasMore",more,"nextOffset",offset+items.size(),"enabled",settings.enabled());
    }
    public List<Map<String,Object>> targets(String owner) { return scopes.targets(owner); }
    public List<Map<String,Object>> cleanup(String owner) {
        List<Map<String,Object>> result=new ArrayList<>();
        for(Map<String,Object> e:db.rows("SELECT e.id,e.title,e.revision,e.sync_state,e.error_message,s.kind FROM nw_memory_entry e JOIN nw_memory_scope s ON s.id=e.scope_id WHERE s.owner_id=? AND e.state='deleted' AND e.sync_state<>'ready' ORDER BY e.updated_at DESC LIMIT 100",owner))
            result.add(map("id",e.get("id"),"title",e.get("title"),"revision",e.get("revision"),"syncState",e.get("sync_state"),"error",e.get("error_message"),"kind",e.get("kind")));
        return result;
    }
    private Map<String,Object> retryableEntry(String owner,String id,boolean lock) {
        Map<String,Object> entry=db.entry(id,lock);
        if(entry==null || !owner.equals(entry.get("owner_id"))) throw new ApiException(404,"记忆不存在");
        // A tombstone only permits cleanup, including after its task has been deleted.
        if(!"deleted".equals(entry.get("state"))) scopes.authorize(owner,str(entry,"kind"),str(entry,"object_id"),true);
        return entry;
    }
    public Map<String,Object> detail(String owner, String id) {
        Map<String,Object> e = owned(owner,id,false,false), result = view(e);
        List<Object> history = new ArrayList<>();
        for (Map<String,Object> v : db.rows("SELECT revision,actor,action_name,body_json,created_at FROM nw_memory_version WHERE entry_id=? ORDER BY revision DESC LIMIT 100",id))
            history.add(map("revision",v.get("revision"),"actor",v.get("actor"),"action",v.get("action_name"),"createdAt",time(v.get("created_at")),"entry",decode(json,v.get("body_json"))));
        result.put("history",history);
        List<Object> facts = new ArrayList<>(); String extraction = "not_ready";
        if (settings.enabled() && "active".equals(e.get("state")) && "ready".equals(e.get("sync_state"))) {
            try {
                JsonNode response = client.request("GET",HindsightClient.bank(str(e,"bank_id"))+"/memories/list?document_id="+str(e,"document_id")+"&state=active&limit=50",null,settings.recallMs());
                Map<String,Object> scope = scopes.authorize(owner,str(e,"kind"),str(e,"object_id"),false);
                for (JsonNode fact : response.path("items")) {
                    if (!fact.isObject()) continue;
                    ObjectNode normalized = fact.deepCopy(); normalized.set("type",fact.path("fact_type"));
                    Map<String,Object> valid = validatedFact(owner,scope,normalized);
                    if (valid != null) facts.add(valid);
                }
                extraction = facts.isEmpty()?"empty":"ready";
            } catch (Exception ignored) { extraction = "unavailable"; }
        }
        result.put("facts",facts); result.put("extractionStatus",extraction); return result;
    }
    Map<String,Object> owned(String owner, String id, boolean write, boolean lock) {
        Map<String,Object> e = db.entry(id,lock);
        if (e == null || !owner.equals(e.get("owner_id"))) throw new ApiException(404,"记忆不存在");
        scopes.authorize(owner,str(e,"kind"),str(e,"object_id"),write); return e;
    }
    public Map<String,Object> view(Map<String,Object> e) {
        JsonNode source = decode(json,e.get("source_json"));
        String sourceTask = source.path("taskId").asText("");
        boolean removed = !sourceTask.isEmpty() && db.one("SELECT id FROM nw_agent_task WHERE id=? AND deleted_at IS NULL",sourceTask) == null;
        return map("id",e.get("id"),"kind",e.get("kind"),"scopeId",e.get("object_id"),"title",e.get("title"),"content",e.get("content_md"),
                "state",e.get("state"),"revision",e.get("revision"),"syncState",e.get("sync_state"),"syncedRevision",e.get("synced_revision"),
                "source",source,"sourceTaskDeleted",removed,"automatic",bool(e.get("automatic")),"error",e.get("error_message"),
                "createdAt",time(e.get("created_at")),"updatedAt",time(e.get("updated_at")));
    }
    private void fields(JsonNode b, String... allowed) {
        if (b == null || !b.isObject()) throw new ApiException(422,"记忆请求必须是对象");
        Set<String> names = new HashSet<>(Arrays.asList(allowed));
        b.fieldNames().forEachRemaining(k -> { if (!names.contains(k)) throw new ApiException(422,"不支持的记忆字段: " + k); });
    }
    private Object once(String owner, String requestKey, String operation, JsonNode body, Supplier<Object> action) {
        key(requestKey);
        String digest = fingerprint(json.valueToTree(map("operation",operation,"body",body)));
        db.update("INSERT INTO nw_memory_request(owner_id,request_key,request_hash) VALUES(?,?,?) ON DUPLICATE KEY UPDATE request_key=request_key",owner,requestKey,digest);
        Map<String,Object> request = db.one("SELECT * FROM nw_memory_request WHERE owner_id=? AND request_key=? FOR UPDATE",owner,requestKey);
        sameHash(request,digest);
        if (request.get("result_json") != null) return decode(json,request.get("result_json"));
        Object result = action.get();
        db.update("UPDATE nw_memory_request SET result_json=? WHERE owner_id=? AND request_key=?",encode(json,result),owner,requestKey);
        return result;
    }
    @Transactional public Object create(String owner,String kind,String object,JsonNode body,String requestKey) {
        scopes.authorize(owner,kind,object,true); fields(body,"title","content");
        return once(owner,requestKey,"create:"+kind+":"+object,body,() -> {
            String state = Arrays.asList("workbench","expert").contains(kind) ? "draft" : "active";
            return createEntry(owner,kind,object,id(),text(body,"title",300,true),text(body,"content",50000,true),json.valueToTree(map("type","manual","actor",owner)),state,false,null);
        });
    }
    @Transactional public Map<String,Object> propose(String owner,String kind,String object,String id,String title,String content,JsonNode source,String run) {
        scopes.authorize(owner,kind,object,true);
        return createEntry(owner,kind,object,id,title,content,source,"draft",false,run);
    }
    @Transactional public Object updateAgentDraft(String owner,String id,JsonNode body,String key,String task,String run){
        owned(owner,id,true,false);fields(body,"revision","title","content");
        return once(owner,key,"agent-draft:"+id,body,()->{
            Map<String,Object> entry=owned(owner,id,true,true);revision(entry,body);
            if(!"draft".equals(entry.get("state")))throw new ApiException(403,"智能体只能编辑待审核草稿");
            ObjectNode source=decode(json,entry.get("source_json")).deepCopy();if(!source.has("originType"))source.put("originType",source.path("type").asText());
            source.put("type","agent_edit");source.put("requiresReview",true);source.put("taskId",task);source.put("runId",run);source.remove("editedBy");source.put("editedAt",Instant.now().toString());
            db.update("UPDATE nw_memory_entry SET title=?,content_md=?,source_json=?,source_run_id=?,automatic=FALSE,revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=?",text(body,"title",300,true),redact(text(body,"content",50000,true)),source.toString(),run,id);
            Map<String,Object> changed=db.entry(id,false);version(changed,owner,"agent-draft-edit");return view(changed);
        });
    }
    public Map<String,Object> createEntry(String owner,String kind,String object,String id,String title,String content,JsonNode source,String state,boolean automatic,String run) {
        Map<String,Object> scope = ensureScope(owner,kind,object);
        db.update("INSERT INTO nw_memory_entry(id,scope_id,title,content_md,source_json,state,document_id,automatic,source_run_id,sync_state) VALUES(?,?,?,?,?,?,?,?,?,?)",id,scope.get("id"),title,redact(content),source.toString(),state,"memory-"+id,automatic,run,"active".equals(state)?"pending":"not_required");
        Map<String,Object> e = db.entry(id,false);
        version(e,owner,"create");
        if ("active".equals(state)) enqueue(e,"retain");
        return view(e);
    }
    @Transactional public Object change(String owner,String id,String action,JsonNode body,String requestKey) {
        // Check access even for idempotent replays; a removed membership cannot replay private data.
        Map<String,Object> initial = db.entry(id,false);
        if (initial == null || !owner.equals(initial.get("owner_id"))) throw new ApiException(404,"记忆不存在");
        scopes.authorize(owner,str(initial,"kind"),str(initial,"object_id"),true);
        fields(body,"revision","title","content");
        return once(owner,requestKey,action+":"+id,body,() -> {
            Map<String,Object> e = owned(owner,id,true,true); revision(e,body);
            String state = str(e,"state"), title = str(e,"title"), content = str(e,"content_md");
            if ("deleted".equals(state)) throw new ApiException(409,"已删除的记忆只能重试清理");
            ObjectNode source=decode(json,e.get("source_json")).deepCopy();
            switch (action) {
                case "edit":
                    title = text(body,"title",300,true); content = redact(text(body,"content",50000,true));
                    source.put("editedBy",owner); source.put("editedAt",Instant.now().toString());
                    boolean review = Arrays.asList("workbench","expert").contains(str(e,"kind")) || decode(json,e.get("source_json")).path("requiresReview").asBoolean();
                    state = review ? "draft" : "active"; break;
                case "approve": if (!"draft".equals(state)) throw new ApiException(409,"只有待审核记忆可以发布"); state="active"; source.put("approvedBy",owner); source.put("approvedAt",Instant.now().toString()); break;
                case "reject": if (!"draft".equals(state)) throw new ApiException(409,"只有待审核记忆可以拒绝"); state="rejected"; break;
                case "disable": if (!"active".equals(state)) throw new ApiException(409,"只有生效记忆可以停用"); state="disabled"; break;
                case "delete": state="deleted"; break;
                default: throw new ApiException(422,"不支持的记忆操作");
            }
            db.update("UPDATE nw_memory_entry SET title=?,content_md=?,source_json=?,state=?,automatic=FALSE,revision=revision+1,sync_state='pending',error_message=NULL,updated_at=CURRENT_TIMESTAMP(6) WHERE id=?",title,content,source.toString(),state,id);
            e=db.entry(id,false); version(e,owner,action); enqueue(e,"active".equals(state)?"retain":"delete");
            return view(db.entry(id,false));
        });
    }
    @Transactional public Object promote(String owner,String id,JsonNode body,String requestKey) {
        Map<String,Object> source=owned(owner,id,false,false);
        fields(body,"revision","kind","scopeId","title","content");
        String kind=text(body,"kind",16,true), object=text(body,"scopeId",160,true);
        if ("task".equals(kind)) throw new ApiException(422,"提升目标不能是其他任务");
        scopes.authorize(owner,kind,object,true);
        return once(owner,requestKey,"promote:"+id,body,() -> {
            Map<String,Object> latest=owned(owner,id,false,true); revision(latest,body);
            if (!"active".equals(latest.get("state"))) throw new ApiException(409,"请先审核来源记忆");
            ObjectNode provenance=decode(json,source.get("source_json")).deepCopy();
            boolean review=Arrays.asList("user","workbench","expert").contains(kind);
            provenance.put("type","promotion"); provenance.put("entryId",id); provenance.put("entryRevision",number(latest,"revision")); provenance.put("requiresReview",review);
            provenance.put("promotedBy",owner); provenance.put("promotedAt",Instant.now().toString());
            return createEntry(owner,kind,object,id(),text(body,"title",300,true),text(body,"content",50000,true),provenance,review?"draft":"active",false,str(source,"source_run_id"));
        });
    }
    @Transactional public Object retry(String owner,String id,JsonNode body,String requestKey) {
        retryableEntry(owner,id,false); fields(body,"revision");
        return once(owner,requestKey,"retry:"+id,body,() -> {
            Map<String,Object> e=retryableEntry(owner,id,true); revision(e,body);
            if (db.update("UPDATE nw_memory_job SET state='pending',attempts=0,error_message=NULL,next_attempt_at=CURRENT_TIMESTAMP(6) WHERE entry_id=? AND state='failed'",id)==0)
                throw new ApiException(409,"没有失败的记忆同步任务");
            db.update("UPDATE nw_memory_entry SET sync_state='pending',error_message=NULL WHERE id=?",id);
            return view(db.entry(id,false));
        });
    }
    public void version(Map<String,Object> e,String owner,String action) {
        db.update("INSERT INTO nw_memory_version(entry_id,revision,actor,action_name,body_json) VALUES(?,?,?,?,?)",e.get("id"),e.get("revision"),owner,action,encode(json,view(e)));
    }
    public void enqueue(Map<String,Object> e,String kind) {
        Object payload=map("bankId",e.get("bank_id"),"documentId",e.get("document_id"),"content",e.get("content_md"),"scopeKind",e.get("kind"),"entryId",e.get("id"),"revision",e.get("revision"));
        db.update("INSERT INTO nw_memory_job(id,entry_id,revision,kind,payload_json,operation_id) VALUES(?,?,?,?,?,?)",id(),e.get("id"),e.get("revision"),kind,encode(json,payload),UUID.randomUUID().toString());
        if(db.one("SELECT id FROM nw_memory_job WHERE entry_id=? AND state='failed' LIMIT 1",e.get("id"))!=null)
            db.update("UPDATE nw_memory_entry SET sync_state='failed',error_message='早期版本同步失败，请修复配置后重试' WHERE id=?",e.get("id"));
    }
    public Map<String,Object> searchScope(String owner,String kind,String object,JsonNode body) {
        fields(body,"query");
        return search(owner,Collections.singletonList(scopes.authorize(owner,kind,object,false)),text(body,"query",4000,true));
    }
    /** Network work is deliberately outside business transactions. The whole fan-out shares one deadline. */
    public Map<String,Object> search(String owner,List<Map<String,Object>> allowed,String query) {
        if (!settings.enabled()) return recallResult("disabled",Collections.emptyList(),Collections.emptyList());
        long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(settings.recallMs());
        List<Future<JsonNode>> futures=new ArrayList<>(); List<Map<String,Object>> queried=new ArrayList<>(); List<Object> problems=new ArrayList<>();
        for (Map<String,Object> scope:allowed) {
            String kind=str(scope,"kind"), object=str(scope,"scopeId");
            try { scopes.authorize(owner,kind,object,false); } catch (ApiException e) { problems.add(map("kind",kind,"scopeId",object,"status","revoked")); continue; }
            Map<String,Object> stored=db.scope(scopeId(owner,kind,object));
            if (stored==null) continue;
            if(db.one("SELECT id FROM nw_memory_entry WHERE scope_id=? AND state='active' AND (sync_state<>'ready' OR synced_revision<>revision) LIMIT 1",stored.get("id"))!=null)
                problems.add(map("kind",kind,"scopeId",object,"status","sync_pending"));
            if (db.one("SELECT id FROM nw_memory_entry WHERE scope_id=? AND state='active' AND sync_state='ready' AND synced_revision=revision LIMIT 1",stored.get("id"))==null) continue;
            try {
                Future<JsonNode> future=recalls.submit(() -> {
                    int remaining=(int)TimeUnit.NANOSECONDS.toMillis(deadline-System.nanoTime());
                    if(remaining<=0) throw new HindsightClient.Failure(0);
                    return client.request("POST",HindsightClient.bank(str(stored,"bank_id"))+"/memories/recall",map("query",query,"types",Arrays.asList("world","experience"),"budget","low","max_tokens",settings.tokens(),"query_timestamp",Instant.now().toString()),remaining);
                });
                futures.add(future); queried.add(scope);
            } catch (RejectedExecutionException e) { problems.add(map("kind",kind,"scopeId",object,"status","busy")); }
        }
        List<Object> results=new ArrayList<>(); Set<String> seen=new HashSet<>(); int budget=settings.tokens();
        for(int i=0;i<futures.size();i++) {
            Map<String,Object> scope=queried.get(i); Future<JsonNode> future=futures.get(i);
            try {
                long remaining=Math.max(1,TimeUnit.NANOSECONDS.toMillis(deadline-System.nanoTime()));
                JsonNode response=future.get(future.isDone()?1:remaining,TimeUnit.MILLISECONDS);
                scopes.authorize(owner,str(scope,"kind"),str(scope,"scopeId"),false);
                if(!response.path("results").isArray()) throw new HindsightClient.Failure(502);
                boolean unverified=false, trimmed=false;
                for(JsonNode fact:response.path("results")) {
                    Map<String,Object> item=validatedFact(owner,scope,fact);
                    if(item==null) { unverified=true; continue; }
                    if(!seen.add(str(item,"entryId")+":"+str(item,"text"))) continue;
                    int cost=encode(json,item).getBytes(StandardCharsets.UTF_8).length; // Conservative upper bound, includes metadata.
                    if(cost>budget) { trimmed=true; continue; }
                    budget-=cost; results.add(item);
                }
                if(unverified) problems.add(map("kind",scope.get("kind"),"scopeId",scope.get("scopeId"),"status","source_unverified"));
                if(trimmed) problems.add(map("kind",scope.get("kind"),"scopeId",scope.get("scopeId"),"status","budget_exhausted"));
            } catch(Exception e) {
                if(e instanceof InterruptedException) Thread.currentThread().interrupt();
                problems.add(map("kind",scope.get("kind"),"scopeId",scope.get("scopeId"),"status","unavailable"));
            } finally { if(!future.isDone()) future.cancel(true); }
        }
        return recallResult(problems.isEmpty()?(results.isEmpty()?"empty":"ready"):(results.isEmpty()?"unavailable":"partial"),results,problems);
    }
    Map<String,Object> validatedFact(String owner,Map<String,Object> scope,JsonNode fact) {
        if(!Arrays.asList("world","experience").contains(fact.path("type").asText()) || !fact.path("text").isTextual()) return null;
        String entry=fact.path("metadata").path("entry_id").asText("");
        Map<String,Object> e=db.entry(entry,false);
        if(e==null || !owner.equals(e.get("owner_id")) || !scopeId(owner,str(scope,"kind"),str(scope,"scopeId")).equals(e.get("scope_id"))
                || !"active".equals(e.get("state")) || !"ready".equals(e.get("sync_state")) || number(e,"revision")!=number(e,"synced_revision")
                || !String.valueOf(number(e,"revision")).equals(fact.path("metadata").path("revision").asText())
                || !e.get("document_id").equals(fact.path("document_id").asText())) return null;
        return map("entryId",entry,"revision",e.get("revision"),"kind",e.get("kind"),"scopeId",e.get("object_id"),"title",e.get("title"),"text",fact.path("text").asText(),"source",decode(json,e.get("source_json")));
    }
    public Map<String,Object> recallResult(String status,List<?> results,List<?> problems) {
        return map("status",status,"results",results,"problems",problems,"retrievedAt",Instant.now().toString());
    }
    public static String redact(String content) {
        return content.replaceAll("(?i)(bearer\\s+)[A-Za-z0-9._~+/-]{12,}","$1[REDACTED]")
                .replaceAll("(?i)((?:api[_-]?key|access[_-]?token|password|authorization)\\s*[:=]\\s*[\"']?)[^\\s\"',;]+","$1[REDACTED]");
    }
}
