package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.expert.ExpertMapper;
import cn.nebulaedata.cccs.nebuwork.backend.api.workbench.WorkbenchMapper;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.annotation.Isolation;
import java.sql.Timestamp;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;

/** Account-owned configuration; never provisions runtime MCP tools. */
@Service
public class KnowledgeService {
    private final KnowledgeAccess access;
    private final cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentSettings taskSettings;
    private final KnowledgeMapper db;private final ExpertMapper experts;private final WorkbenchMapper workbenches;
    private final ObjectMapper json;private final KnowledgeSecretCipher cipher;private final Map<String,KnowledgeDriver> drivers=new LinkedHashMap<>();
    public KnowledgeService(KnowledgeMapper db,ExpertMapper experts,WorkbenchMapper workbenches,ObjectMapper json,KnowledgeSecretCipher cipher,List<KnowledgeDriver> drivers,cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentSettings taskSettings,KnowledgeAccess access){
        this.access=access;this.taskSettings=taskSettings;this.db=db;this.experts=experts;this.workbenches=workbenches;this.json=json;this.cipher=cipher;for(KnowledgeDriver d:drivers)this.drivers.put(d.id(),d);
    }
    public List<Map<String,Object>> drivers(){List<Map<String,Object>> out=new ArrayList<>();drivers.values().forEach(d->out.add(d.descriptor()));return out;}
    public List<Map<String,Object>> targets(String owner,String kind){
        List<Map<String,Object>> rows;
        if("expert".equals(kind))rows=experts.visibleExperts(owner);
        else if("workbench".equals(kind))rows=workbenches.workbenches(owner);
        else if("project".equals(kind))rows=workbenches.projects(owner,null);
        else throw new ApiException(422,"引用目标类型无效");
        List<Map<String,Object>> result=new ArrayList<>();for(Map<String,Object> row:rows)result.add(map("id",row.get("id"),"name",row.get("name")));return result;
    }
    private KnowledgeDriver driver(String id){KnowledgeDriver d=drivers.get(id);if(d==null)throw new ApiException(422,"不支持的知识库驱动");return d;}
    private JsonNode parse(Object value){try{return json.readTree(value.toString());}catch(Exception e){throw new ApiException(500,"知识库引用快照读取失败");}}
    private String encode(Object value){try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalStateException(e);}}
    void audit(String owner,String target,String action,Object changes){
        experts.audit(map("id",id("audit"),"actor",owner,"type","knowledge","object",target,"action",action,"change",encode(changes)));
    }
    private Map<String,Object> scope(String owner,String kind,String target,boolean lock){
        switch(kind){
            case "expert":
                if(lock)required(experts.lockExpert(target));
                return required(experts.visibleExpert(owner,target));
            case "workbench":return required(lock?workbenches.lockWorkbench(owner,target):workbenches.workbench(owner,target));
            case "project":
                Map<String,Object> p=required(workbenches.project(owner,target));
                if(lock){required(workbenches.lockWorkbench(owner,string(p,"workbench_id")));required(db.lockProject(owner,target));p=required(workbenches.project(owner,target));}
                return p;
            default:throw new ApiException(422,"知识库归属类型无效");
        }
    }
    private Map<String,Object> managed(String owner,String connection,boolean lock){
        access.migrateLegacy();if(lock)access.lock();Map<String,Object> row=access.connection(connection);
        if(!access.admin(owner)&&!access.visible(owner,row))throw new ApiException(404,"知识库连接不可用");return row;
    }
    private Map<String,Object> dto(String actor,Map<String,Object> row){
        Object tested=row.get("tested_at");
        if(!access.admin(actor))return map("id",row.get("id"),"scopeKind","system","scopeId","","name",row.get("name"),"driver",row.get("driver"),"driverName",driver(string(row,"driver")).descriptor().get("name"),"capabilities",driver(string(row,"driver")).descriptor().get("capabilities"),"enabled",bool(row.get("enabled")),"published",bool(row.get("published")),"testStatus",row.get("test_status"));
        return map("id",row.get("id"),"scopeKind",row.get("scope_kind"),"scopeId",row.get("scope_id"),"name",row.get("name"),"driver",row.get("driver"),"driverName",driver(string(row,"driver")).descriptor().get("name"),"capabilities",driver(string(row,"driver")).descriptor().get("capabilities"),
            "endpoint",row.get("endpoint"),"tenantId",row.get("tenant_id"),"published",bool(row.get("published")),"canEdit",true,"authType",row.get("auth_type"),"authHeader",row.get("auth_header"),"hasSecret",row.get("secret_cipher")!=null,
            "enabled",bool(row.get("enabled")),"revision",row.get("revision"),"testStatus",row.get("test_status"),"testMessage",row.get("test_message"),
            "testedAt",tested instanceof Timestamp?((Timestamp)tested).toInstant().toString():tested);
    }
    public List<Map<String,Object>> connections(String owner,String kind,String target){
        if(!"user".equals(kind))scope(owner,kind,target,false);else if(!target.isEmpty())throw new ApiException(422,"统一连接不属于业务对象");
        List<Map<String,Object>> out=new ArrayList<>();
        access.migrateLegacy();for(Map<String,Object> row:access.all())if(access.admin(owner)||access.visible(owner,row))out.add(dto(owner,row));
        return out;
    }
    private Map<String,Object> connectionInput(String owner,String id,String kind,String target,JsonNode body,Map<String,Object> old){
        fields(body,"name","driver","endpoint","authType","authHeader","secret","enabled","revision","tenantId","published");
        String selected=body.has("driver")?text(body,"driver",64,true):old==null?"":string(old,"driver");driver(selected);
        if(old!=null&&!selected.equals(string(old,"driver")))throw new ApiException(422,"已有连接不能切换驱动，请新增连接");
        String name=text(body,"name",160,true).trim(),url=KnowledgeNetworkPolicy.endpoint(text(body,"endpoint",2048,true)).toASCIIString();
        String auth=text(body,"authType",16,true),header=text(body,"authHeader",128,false).trim();
        String tenant=body.has("tenantId")?text(body,"tenantId",32,false).trim():old==null?"":string(old,"tenant_id");
        if(!tenant.isEmpty()&&!tenant.matches("[1-9][0-9]{0,19}"))throw new ApiException(422,"空间 ID 必须为正整数");
        if("nebulae-v100-rest".equals(selected)){url=KnowledgeRestClient.normalize(url);auth="header";header="X-API-Key";}else {tenant="";if(NebulaeV101RestDriver.ID.equals(selected))url=KnowledgeRestClient.normalize(url);}
        if(old!=null&&(!url.equals(string(old,"endpoint"))||!tenant.equals(string(old,"tenant_id")))){
            if(!access.references(old,null).isEmpty()||access.one("SELECT id FROM nw_knowledge_library WHERE service_key=?",access.serviceKey(old))!=null)throw new ApiException(409,"已有知识库或历史引用，不能切换服务地址或空间；请新增连接");
            if(!"none".equals(auth)&&!body.hasNonNull("secret"))throw new ApiException(422,"更换地址时必须重新填写凭据");
        }
        if(!Arrays.asList("none","bearer","header").contains(auth))throw new ApiException(422,"认证类型无效");
        if("header".equals(auth)){
            if(!header.matches("[A-Za-z][A-Za-z0-9-]{0,127}")||Arrays.asList("host","cookie","set-cookie","connection","proxy-authorization","proxy-authenticate","content-type","content-length","accept","accept-encoding","transfer-encoding","origin","referer","upgrade","te","trailer","expect").contains(header.toLowerCase(Locale.ROOT))
                ||header.toLowerCase(Locale.ROOT).startsWith("mcp-")||header.toLowerCase(Locale.ROOT).startsWith("sec-"))
                throw new ApiException(422,"自定义认证 Header 名称不允许使用协议或会话头");
        }else header="";
        String secret=body.has("secret")?text(body,"secret",4096,false):null;
        if(secret!=null&&(secret.indexOf('\r')>=0||secret.indexOf('\n')>=0||secret.indexOf('\0')>=0))throw new ApiException(422,"认证信息不能包含换行或空字符");
        String encrypted=null;
        if(!"none".equals(auth)){
            if(secret!=null&&!secret.isEmpty())encrypted=cipher.encrypt(owner,id,secret);
            else if(secret==null&&old!=null&&auth.equals(string(old,"auth_type"))&&header.equals(string(old,"auth_header")))encrypted=string(old,"secret_cipher");
            if(encrypted==null||encrypted.isEmpty())throw new ApiException(422,"请填写认证信息；编辑时不提交 secret 表示保留");
        }
        boolean enabled=old==null||bool(old.get("enabled"));
        if(body.has("enabled")){if(!body.path("enabled").isBoolean())throw new ApiException(422,"enabled 必须为布尔值");enabled=body.path("enabled").asBoolean();}
        boolean published=old!=null&&bool(old.get("published"));if(body.has("published")){if(!body.path("published").isBoolean())throw new ApiException(422,"published 必须为布尔值");published=body.path("published").asBoolean();}
        return map("id",id,"owner",owner,"kind",kind,"scope",target,"name",name,"driver",selected,"endpoint",url,"authType",auth,"authHeader",header,"cipher",encrypted,"enabled",enabled,"tenantId",tenant,"published",published);
    }
    private Map<String,Object> inputRow(Map<String,Object> p){
        return map("id",p.get("id"),"owner_id",p.get("owner"),"scope_kind",p.get("kind"),"scope_id",p.get("scope"),"name",p.get("name"),"driver",p.get("driver"),
            "endpoint",p.get("endpoint"),"auth_type",p.get("authType"),"auth_header",p.get("authHeader"),"secret_cipher",p.get("cipher"),"enabled",p.get("enabled"),"tenant_id",p.get("tenantId"));
    }
    private JsonNode remote(String owner,Map<String,Object> row,String operation,String collection,JsonNode input){
        if(!bool(row.get("enabled")))throw new ApiException(409,"知识库连接已禁用");
        return driver(string(row,"driver")).execute(string(row,"endpoint"),headers(row),operation,collection,input);
    }
    Map<String,String> headers(Map<String,Object> row){
        Map<String,String> headers=new LinkedHashMap<>();String auth=string(row,"auth_type");
        if(!"none".equals(auth)){
            String secret=cipher.decrypt(string(row,"owner_id"),string(row,"id"),string(row,"secret_cipher"));
            headers.put("bearer".equals(auth)?"Authorization":string(row,"auth_header"),"bearer".equals(auth)?"Bearer "+secret:secret);
        }
        if(!string(row,"tenant_id").isEmpty())headers.put("X-Tenant-ID",string(row,"tenant_id"));return headers;
    }
    @Transactional
    public Map<String,Object> createConnection(String owner,JsonNode body){
        access.requireAdmin(owner);access.lock();String id=id("kmcp");Map<String,Object> p=connectionInput("system-knowledge",id,"system","",body,null);db.insertConnection(p);
        audit(owner,id,"create_connection",map("scopeKind","system","driver",p.get("driver")));return dto(owner,access.connection(id));
    }
    @Transactional
    public Map<String,Object> updateConnection(String owner,String id,JsonNode body){
        access.requireAdmin(owner);Map<String,Object> old=managed(owner,id,true),p=connectionInput(string(old,"owner_id"),id,string(old,"scope_kind"),string(old,"scope_id"),body,old);
        p.put("revision",revision(body));changed(db.updateConnection(p));
        audit(owner,id,"update_connection",map("revision",revision(body)+1,"enabled",p.get("enabled")));return dto(owner,access.connection(id));
    }
    public JsonNode testDraft(String owner,JsonNode body){
        access.requireAdmin(owner);
        fields(body,"connection","connectionId");
        String existing=text(body,"connectionId",64,false);Map<String,Object> old=existing.isEmpty()?null:managed(owner,existing,false);
        String id=old==null?id("draft"):existing;
        Map<String,Object> p=connectionInput(old==null?"system-knowledge":string(old,"owner_id"),id,old==null?"system":string(old,"scope_kind"),old==null?"":string(old,"scope_id"),body.path("connection"),old);
        return remote(owner,inputRow(p),"collections",null,json.createObjectNode());
    }
    public Map<String,Object> testConnection(String owner,String id){
        access.requireAdmin(owner);
        Map<String,Object> row=managed(owner,id,false);long revision=number(row,"revision");
        try{
            JsonNode result=remote(owner,row,"collections",null,json.createObjectNode());
            db.testResult(string(row,"owner_id"),id,revision,"ready","连接正常");
            return map("connection",dto(owner,managed(owner,id,false)),"collections",result.path("collections"),"tools",result.path("tools"));
        }catch(ApiException e){db.testResult(string(row,"owner_id"),id,revision,"failed","连接测试失败，请检查远端配置");throw e;}
    }
    public JsonNode collections(String owner,String id,boolean includeDocumentCounts){
        Map<String,Object> c=managed(owner,id,false);List<String> permitted=new ArrayList<>();
        for(Map<String,Object> l:access.jdbc().queryForList("SELECT collection_id FROM nw_knowledge_library WHERE service_key=?",access.serviceKey(c)))if(access.allowed(owner,c,string(l,"collection_id"),false))permitted.add(string(l,"collection_id"));
        JsonNode result=remote(owner,c,"collections",null,json.valueToTree(map("includeDocumentCounts",includeDocumentCounts,"allowedCollectionIds",permitted)));ArrayNode filtered=json.createArrayNode();
        for(JsonNode item:result.path("collections"))if(access.allowed(owner,c,item.path("id").asText(),false)){ObjectNode copy=((ObjectNode)item).deepCopy();copy.put("canManage",access.allowed(owner,c,item.path("id").asText(),true)&&Arrays.asList("nebulae-v100-rest",NebulaeV101RestDriver.ID).contains(c.get("driver")));filtered.add(copy);}
        return json.valueToTree(map("collections",filtered));
    }
    public void authorizeLibrary(String actor,String connectionId,String collectionId,boolean write){Map<String,Object> c=access.connection(connectionId);if(!access.visible(actor,c))throw new cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException(404,"知识库连接不可用");access.require(actor,c,collectionId,write);}
    /** Bounded system-tool directory: page authorized local identities before reading remote metadata. */
    public Object collectionsPage(String owner,String connection,List<String> allowed,int limit,int offset){
        Map<String,Object> c=managed(owner,connection,false);limit=Math.max(1,Math.min(100,limit));
        if(allowed!=null&&allowed.isEmpty())return map("items",Collections.emptyList(),"hasMore",false,"nextOffset",null);
        List<Object> params=new ArrayList<>();params.add(access.serviceKey(c));params.add(owner);params.add(owner);
        String sql="SELECT l.collection_id FROM nw_knowledge_library l WHERE l.service_key=? AND (l.owner_id=? OR EXISTS(SELECT 1 FROM nw_knowledge_library_access a WHERE a.library_id=l.id AND a.owner_id=?))";
        if(allowed!=null){sql+=" AND l.collection_id IN ("+String.join(",",Collections.nCopies(allowed.size(),"?"))+")";params.addAll(allowed);}
        sql+=" ORDER BY l.created_at DESC,l.id LIMIT ? OFFSET ?";params.add(limit+1);params.add(offset);
        List<Map<String,Object>> rows=access.jdbc().queryForList(sql,params.toArray());boolean more=rows.size()>limit;List<Object> items=new ArrayList<>();
        for(Map<String,Object> row:rows.subList(0,Math.min(limit,rows.size()))){String id=string(row,"collection_id");access.require(owner,c,id,false);if(Arrays.asList("nebulae-v100-rest",NebulaeV101RestDriver.ID).contains(c.get("driver"))){ObjectNode item=remote(owner,c,"library",id,json.createObjectNode()).deepCopy();item.put("canManage",access.allowed(owner,c,id,true));items.add(item);}else items.add(map("id",id,"name",null,"metadataStatus","unsupported","reason","旧知识驱动没有按知识库 ID 查询目录详情的能力"));}
        return map("items",items,"hasMore",more,"nextOffset",more?offset+limit:null);
    }
    public Object settings(String actor){return access.settings(actor);}
    public JsonNode discover(String actor,String id){access.requireAdmin(actor);Map<String,Object> c=managed(actor,id,false);JsonNode out=remote(actor,c,"collections",null,json.createObjectNode());for(JsonNode r:out.path("collections")){Map<String,Object> l=access.library(c,r.path("id").asText());((ObjectNode)r).put("ownerId",l==null?"":string(l,"owner_id"));}return out;}
    @Transactional public Object assign(String actor,String id,JsonNode body){access.requireAdmin(actor);fields(body,"collectionId","ownerId");Map<String,Object> c=managed(actor,id,true);String kb=text(body,"collectionId",8192,true),owner=text(body,"ownerId",160,true);boolean found=false;for(JsonNode r:discover(actor,id).path("collections"))if(kb.equals(r.path("id").asText()))found=true;if(!found)throw new ApiException(404,"远端知识库不可见");access.assign(actor,c,kb,owner);audit(actor,id,"assign_library",map("collectionId",kb,"ownerId",owner));return map("assigned",true);}
    public List<Map<String,Object>> usages(String owner,String connection){
        access.requireAdmin(owner);
        return access.references(managed(owner,connection,false),null);
    }
    @Transactional
    public void deleteConnection(String owner,String id,long revision){
        access.requireAdmin(owner);Map<String,Object> row=managed(owner,id,true);if(number(row,"revision")!=revision)changed(0);access.unused(row,null);
        if(access.one("SELECT id FROM nw_knowledge_template WHERE connection_id=?",id)!=null||access.one("SELECT id FROM nw_knowledge_creation_job WHERE connection_id=?",id)!=null)throw new ApiException(409,"连接仍有创建模板或历史创建任务，请停用连接以保留配置记录");
        if(access.one("SELECT id FROM nw_knowledge_library WHERE connection_id=?",id)!=null||access.one("SELECT id FROM nw_knowledge_operation WHERE connection_id=? AND status<>'completed'",id)!=null)throw new ApiException(409,"连接仍有知识库登记或待核对操作，请保留连接或禁用");
        changed(db.deleteConnection(string(row,"owner_id"),id,revision));audit(owner,id,"delete_connection",map());
    }
    private Map<String,Object> referenceDto(Map<String,Object> r){
        return map("id",r.get("id"),"connectionId",r.get("connection_id"),"collectionId",r.get("collection_id"),"name",r.get("collection_name"),
            "indexingStatus",r.get("indexing_status"),"scopeKind",r.get("scope_kind"),"scopeId",r.get("scope_id"),"inherited",false);
    }
    private void decorate(String owner,Map<String,Object> ref){
        Map<String,Object> connection=access.one("SELECT * FROM nw_knowledge_connection WHERE id=?",ref.get("connectionId"));
        ref.put("connectionName",connection==null?"连接已失效":connection.get("name"));ref.put("driver",connection==null?"":connection.get("driver"));
        ref.put("enabled",connection!=null&&bool(connection.get("enabled"))&&access.allowed(owner,connection,ref.get("collectionId").toString(),false));
        ref.put("connectionStatus",connection==null?"missing":!bool(connection.get("enabled"))?"disabled":connection.get("test_status"));
    }
    public List<Map<String,Object>> references(String owner,String kind,String target){
        access.migrateLegacy();
        Map<String,Object> parent=scope(owner,kind,target,false);List<Map<String,Object>> out=new ArrayList<>();
        if("project".equals(kind)){
            JsonNode snapshot=parse(parent.get("snapshot_json"));
            for(JsonNode item:snapshot.path("knowledgeBases")){
                Map<String,Object> ref=json.convertValue(item,new com.fasterxml.jackson.core.type.TypeReference<Map<String,Object>>(){});
                ref.put("inherited",true);ref.put("sourceVersion",parent.get("version_number"));ref.put("sourceWorkbenchId",parent.get("workbench_id"));
                decorate(owner,ref);out.add(ref);
            }
        }
        for(Map<String,Object> row:db.references(owner,kind,target)){Map<String,Object> ref=referenceDto(row);decorate(owner,ref);out.add(ref);}
        return out;
    }
    public List<String> referenceIds(String owner,String kind,String target){
        List<String> out=new ArrayList<>();for(Map<String,Object> r:references(owner,kind,target))out.add(r.get("id").toString());return out;
    }
    public Map<String,Object> configuration(String owner,String kind,String target){
        Map<String,Object> parent=scope(owner,kind,target,false);
        Long revision;
        if("workbench".equals(kind))revision=number(parent,"revision");else revision=db.scopeRevision(owner,kind,target);
        return map("kind",kind,"id",target,"revision",revision==null?1:revision,"knowledgeBases",references(owner,kind,target),"connections",connections(owner,kind,target),"executionIntegrated","project".equals(kind)&&taskSettings.enabled());
    }
    private void touch(String owner,String kind,String target,long revision){
        Map<String,Object> parent=scope(owner,kind,target,true);
        if("workbench".equals(kind)){changed(workbenches.touch(owner,target,revision));return;}
        db.ensureScope(owner,kind,target);changed(db.touchScope(owner,kind,target,revision));
    }
    private Map<String,Object> bindable(String owner,String kind,String target,String connection){
        return managed(owner,connection,true);
    }
    private void insertReference(String owner,String kind,String target,Map<String,Object> connection,String collection){
        access.require(owner,connection,collection,false);
        for(Map<String,Object> current:references(owner,kind,target))if(collection.equals(current.get("collectionId"))&&connection.get("id").equals(current.get("connectionId")))
            throw new ApiException(409,"该知识库已引用");
        JsonNode selected=null;
        for(JsonNode item:remote(owner,connection,"collections",null,json.createObjectNode()).path("collections"))if(collection.equals(item.path("id").asText()))selected=item;
        if(selected==null)throw new ApiException(422,"所选知识库不在该连接的可见目录中");
        db.insertReference(map("id",id("kref"),"owner",owner,"kind",kind,"scope",target,"connection",connection.get("id"),"collection",collection,
            "hash",hash(collection),"name",selected.path("name").asText(),"status",selected.path("indexingStatus").asText("unknown")));
    }
    @Transactional(isolation=Isolation.READ_COMMITTED)
    public Map<String,Object> bind(String owner,String kind,String target,JsonNode body){
        access.migrateLegacy();access.lock();
        fields(body,"revision","connectionId","collectionId");touch(owner,kind,target,revision(body));
        String connection=text(body,"connectionId",64,true),collection=text(body,"collectionId",8192,true);
        insertReference(owner,kind,target,bindable(owner,kind,target,connection),collection);
        audit(owner,target,"bind",map("scopeKind",kind,"connectionId",connection,"collectionId",collection));return configuration(owner,kind,target);
    }
    @Transactional(isolation=Isolation.READ_COMMITTED)
    public Map<String,Object> createLocal(String owner,String kind,String target,JsonNode body){
        throw new ApiException(403,"连接统一由管理员配置，请选择已配置连接后创建或引用知识库");
    }
    @Transactional(isolation=Isolation.READ_COMMITTED)
    public Map<String,Object> unbind(String owner,String kind,String target,String ref,long revision){
        touch(owner,kind,target,revision);
        boolean own=false;for(Map<String,Object> r:db.references(owner,kind,target))if(ref.equals(r.get("id")))own=true;
        if(!own)throw new ApiException(409,"继承项只读或引用不存在");
        changed(db.deleteReference(owner,kind,target,ref));audit(owner,target,"unbind",map("scopeKind",kind,"referenceId",ref));return configuration(owner,kind,target);
    }
    public Map<String,Object> authorizedReference(String owner,String kind,String target,String reference){
        Map<String,Object> ref=null;for(Map<String,Object> r:references(owner,kind,target))if(reference.equals(r.get("id")))ref=r;
        required(ref);Map<String,Object> connection=access.connection(ref.get("connectionId").toString());access.require(owner,connection,ref.get("collectionId").toString(),false);
        return ref;
    }
    public JsonNode readReference(String owner,String kind,String target,String reference,String operation,JsonNode body){
        Map<String,Object> ref=authorizedReference(owner,kind,target,reference);
        return remote(owner,access.connection(ref.get("connectionId").toString()),operation,ref.get("collectionId").toString(),body);
    }
    public JsonNode readCatalog(String owner,String connection,String collection,String operation,JsonNode body){
        Map<String,Object> row=managed(owner,connection,false);
        access.require(owner,row,collection,false);
        if(collection==null||collection.trim().isEmpty())throw new ApiException(422,"请选择一个知识库");
        return remote(owner,row,operation,collection,body);
    }
    /** Called under the workbench transaction/lock; contains no endpoint or authentication data. */
    public List<Map<String,Object>> publicationReferences(String owner,String workbench){
        List<Map<String,Object>> result=new ArrayList<>();for(Map<String,Object> r:db.references(owner,"workbench",workbench))result.add(referenceDto(r));return result;
    }
    public void pinPublication(String owner,String version,List<Map<String,Object>> refs){
        Set<String> ids=new TreeSet<>();for(Map<String,Object> r:refs)ids.add(r.get("connectionId").toString());
        access.migrateLegacy();access.lock();
        for(Map<String,Object> r:refs)access.require(owner,access.connection(r.get("connectionId").toString()),r.get("collectionId").toString(),false);
        for(String id:ids)db.pin(owner,version,id);
    }
    public void removeWorkbenchDraft(String owner,String workbench){
        for(Map<String,Object> ref:db.references(owner,"workbench",workbench))db.deleteReference(owner,"workbench",workbench,string(ref,"id"));
        // Connections, including historical local connections, are administrator-managed.
    }
}
