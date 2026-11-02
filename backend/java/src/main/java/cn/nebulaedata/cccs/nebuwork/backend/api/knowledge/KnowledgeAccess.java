package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.springframework.core.env.Environment;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.net.URI;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;

/** Configuration administration and content ownership are deliberately separate. */
@Service
public class KnowledgeAccess {
    final JdbcTemplate sql; private final Environment env; private final ObjectMapper json;
    public KnowledgeAccess(JdbcTemplate sql,Environment env,ObjectMapper json){this.sql=sql;this.env=env;this.json=json;}
    public JdbcTemplate jdbc(){return sql;}
    public boolean admin(String actor){return actor!=null&&!actor.isEmpty()&&Arrays.stream(env.getProperty("nebu.knowledge.admin-ids","").split(",")).map(String::trim).anyMatch(actor::equals);}
    public void requireAdmin(String actor){if(!admin(actor))throw new ApiException(403,"仅指定管理员可以配置、测试和分配知识库连接");}
    public Object settings(String actor){return map("canEdit",admin(actor),"actorId",actor);}
    public Map<String,Object> one(String query,Object... args){List<Map<String,Object>> rows=sql.queryForList(query,args);return rows.isEmpty()?null:rows.get(0);}
    public void lock(){sql.queryForObject("SELECT id FROM nw_knowledge_guard WHERE id=1 FOR UPDATE",Integer.class);}
    public Map<String,Object> connection(String id){return required(one("SELECT * FROM nw_knowledge_connection WHERE id=?",id));}
    public List<Map<String,Object>> all(){return sql.queryForList("SELECT * FROM nw_knowledge_connection ORDER BY created_at,id");}
    public String serviceKey(Map<String,Object> c){
        URI u=KnowledgeNetworkPolicy.endpoint(string(c,"endpoint"));
        String path=u.normalize().getRawPath().replaceAll("/+$","");
        if(Arrays.asList("nebulae-v100-rest",NebulaeV101RestDriver.ID).contains(c.get("driver"))&&path.endsWith("/api/v1"))path=path.substring(0,path.length()-7);
        int port=u.getPort()<0?("https".equalsIgnoreCase(u.getScheme())?443:80):u.getPort();
        // Remote KB IDs are globally unique within one service; API-key tenant aliases
        // must not create a second owner for the same KB.
        return hash(u.getScheme().toLowerCase(Locale.ROOT)+"://"+u.getHost().toLowerCase(Locale.ROOT)+":"+port+path);
    }
    public Map<String,Object> library(Map<String,Object> c,String kb){return one("SELECT * FROM nw_knowledge_library WHERE service_key=? AND collection_hash=?",serviceKey(c),hash(kb));}
    public Map<String,Object> register(Map<String,Object> c,String kb,String owner){
        Map<String,Object> old=library(c,kb);
        if(old!=null){if(owner!=null&&!owner.equals(old.get("owner_id")))throw new ApiException(409,"此远端知识库已有归属或历史访问记录，请由管理员处理");return old;}
        sql.update("INSERT INTO nw_knowledge_library(id,service_key,collection_hash,collection_id,connection_id,owner_id) VALUES(?,?,?,?,?,?)",id("klib"),serviceKey(c),hash(kb),kb,c.get("id"),owner);
        return library(c,kb);
    }
    public boolean allowed(String actor,Map<String,Object> c,String kb,boolean write){
        Map<String,Object> l=library(c,kb);if(l==null)return false;
        if(actor.equals(l.get("owner_id")))return true;
        return !write&&one("SELECT library_id FROM nw_knowledge_library_access WHERE library_id=? AND owner_id=?",l.get("id"),actor)!=null;
    }
    public void require(String actor,Map<String,Object> c,String kb,boolean write){
        if(kb==null||kb.isEmpty()||!allowed(actor,c,kb,write))throw new ApiException(404,"知识库不存在或不属于当前账号");
        if(!bool(c.get("enabled")))throw new ApiException(409,"知识库连接已禁用");
    }
    public boolean visible(String actor,Map<String,Object> c){
        if(bool(c.get("published")))return true;
        String key=serviceKey(c);
        return one("SELECT l.id FROM nw_knowledge_library l WHERE l.service_key=? AND (l.owner_id=? OR EXISTS(SELECT 1 FROM nw_knowledge_library_access a WHERE a.library_id=l.id AND a.owner_id=?))",key,actor,actor)!=null;
    }
    private void legacy(String owner,String connection,String kb){
        Map<String,Object> c=one("SELECT * FROM nw_knowledge_connection WHERE id=?",connection);if(c==null||bool(c.get("legacy_migrated"))||kb.isEmpty())return;
        Map<String,Object> l=register(c,kb,null);
        if(one("SELECT library_id FROM nw_knowledge_library_access WHERE library_id=? AND owner_id=?",l.get("id"),owner)==null)
            sql.update("INSERT INTO nw_knowledge_library_access(library_id,owner_id) VALUES(?,?)",l.get("id"),owner);
    }
    /** Idempotent lazy backfill includes immutable releases, not only live drafts. */
    @Transactional(propagation=org.springframework.transaction.annotation.Propagation.REQUIRES_NEW) public void migrateLegacy(){
        if(one("SELECT id FROM nw_knowledge_connection WHERE legacy_migrated=FALSE LIMIT 1")==null)return;
        lock();
        for(Map<String,Object> r:sql.queryForList("SELECT r.* FROM nw_knowledge_reference r JOIN nw_knowledge_connection c ON c.id=r.connection_id WHERE c.legacy_migrated=FALSE"))
            legacy(string(r,"owner_id"),string(r,"connection_id"),string(r,"collection_id"));
        for(Map<String,Object> v:sql.queryForList("SELECT DISTINCT k.owner_id,v.snapshot_json FROM nw_knowledge_publication k JOIN nw_ontology_version v ON v.id=k.version_id JOIN nw_knowledge_connection c ON c.id=k.connection_id WHERE c.legacy_migrated=FALSE")){
            try{for(JsonNode r:json.readTree(string(v,"snapshot_json")).path("knowledgeBases"))legacy(string(v,"owner_id"),r.path("connectionId").asText(),r.path("collectionId").asText());}
            catch(Exception e){throw new ApiException(500,"历史知识引用迁移失败，未开放额外权限");}
        }
        sql.update("UPDATE nw_knowledge_connection SET legacy_migrated=TRUE WHERE legacy_migrated=FALSE");
    }
    public List<Map<String,Object>> references(Map<String,Object> c,String kb){
        Set<String> aliases=new HashSet<>();for(Map<String,Object> a:all())if(serviceKey(c).equals(serviceKey(a)))aliases.add(string(a,"id"));
        List<Map<String,Object>> result=new ArrayList<>();
        for(Map<String,Object> r:sql.queryForList("SELECT * FROM nw_knowledge_reference"))if(aliases.contains(string(r,"connection_id"))&&(kb==null||kb.equals(r.get("collection_id"))))
            result.add(map("kind",r.get("scope_kind"),"id",r.get("scope_id"),"ownerId",r.get("owner_id"),"name",r.get("scope_id"),"collectionId",r.get("collection_id")));
        for(Map<String,Object> v:sql.queryForList("SELECT v.*,w.owner_id,w.name FROM nw_ontology_version v JOIN nw_workbench w ON w.id=v.workbench_id")){
            try{for(JsonNode r:json.readTree(string(v,"snapshot_json")).path("knowledgeBases"))if(aliases.contains(r.path("connectionId").asText())&&(kb==null||kb.equals(r.path("collectionId").asText())))
                result.add(map("kind","publication","id",v.get("workbench_id"),"name",v.get("name"),"version",v.get("version_number"),"ownerId",v.get("owner_id")));}
            catch(Exception e){throw new ApiException(500,"无法核对发布版本引用，操作已停止");}
        }
        return result;
    }
    public void unused(Map<String,Object> c,String kb){if(!references(c,kb).isEmpty())throw new ApiException(409,"知识库仍被草稿、发布版本或项目引用，请先处理引用；历史发布引用也会阻止删除");}
    public void assign(String actor,Map<String,Object> c,String kb,String owner){
        requireAdmin(actor);lock();Map<String,Object> l=library(c,kb);
        if(one("SELECT id FROM nw_knowledge_creation_job WHERE collection_id=? AND status<>'completed'",kb)!=null)throw new ApiException(409,"此知识库属于待恢复的 AI 创建任务，请由原发起人恢复");
        for(Map<String,Object> pending:sql.queryForList("SELECT o.result_json FROM nw_knowledge_creation_job j JOIN nw_knowledge_operation o ON o.id=j.receipt_id WHERE j.status<>'completed' AND o.result_json IS NOT NULL")){
            try{JsonNode result=json.readTree(string(pending,"result_json"));if(kb.equals((result.has("data")?result.path("data"):result).path("id").asText()))throw new ApiException(409,"此知识库属于待恢复的 AI 创建任务，请由原发起人恢复");}
            catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(500,"创建回执无法核对，分配已停止");}
        }
        for(Map<String,Object> pending:sql.queryForList("SELECT o.result_json,c.endpoint,c.driver FROM nw_knowledge_operation o JOIN nw_knowledge_connection c ON c.id=o.connection_id WHERE o.operation='kb.create' AND o.status='received'")){
            try{if(serviceKey(c).equals(serviceKey(pending))&&kb.equals(NebulaeV100RestDriver.data(json.readTree(string(pending,"result_json"))).path("id").asText()))throw new ApiException(409,"此知识库的创建记录待原发起者恢复，不能分配");}
            catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(500,"待恢复操作无法核对");}
        }
        if(l==null)l=register(c,kb,owner);
        else {if(Objects.equals(l.get("owner_id"),owner))return;if(l.get("owner_id")!=null){unused(c,kb);sql.update("DELETE FROM nw_knowledge_library_access WHERE library_id=?",l.get("id"));}sql.update("UPDATE nw_knowledge_library SET owner_id=? WHERE id=?",owner,l.get("id"));}
    }
}
