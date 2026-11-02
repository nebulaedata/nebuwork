package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import java.sql.Timestamp;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeCreationConfig.*;

/** Durable creation coordinator. No HTTP or model call runs inside a database transaction. */
@Service
public class KnowledgeCreationService {
    private final KnowledgeAccess access;private final KnowledgeCreationRemote remote;private final KnowledgeOperations operations;
    private final KnowledgeService knowledge;private final ObjectMapper json;private final TransactionTemplate tx;
    public KnowledgeCreationService(KnowledgeAccess access,KnowledgeCreationRemote remote,KnowledgeOperations operations,KnowledgeService knowledge,ObjectMapper json,PlatformTransactionManager manager){this.access=access;this.remote=remote;this.operations=operations;this.knowledge=knowledge;this.json=json;this.tx=new TransactionTemplate(manager);}
    private JsonNode parse(Map<String,Object> row,String key){try{return json.readTree(string(row,key));}catch(Exception e){throw new ApiException(500,"创建配置记录无法读取");}}
    // A workspace-scoped API key can change the target even when the URL and tenant header stay unchanged.
    private String target(Map<String,Object> c){return hash(KnowledgeRestClient.normalize(string(c,"endpoint"))+"\n"+string(c,"tenant_id")+"\n"+string(c,"driver")+"\n"+json.valueToTree(new TreeMap<>(knowledge.headers(c))).toString());}
    private Map<String,Object> connection(String id,boolean published){Map<String,Object> c=access.connection(id);check("nebulae-v100-rest".equals(c.get("driver")),"此连接不支持 AI 建库");if(!bool(c.get("enabled"))||published&&!bool(c.get("published")))throw new ApiException(403,"知识库连接未开放或已停用");return c;}
    private Map<String,Object> template(String id){return required(access.one("SELECT * FROM nw_knowledge_template WHERE id=?",id));}
    private Map<String,Object> version(String id,long revision){return required(access.one("SELECT * FROM nw_knowledge_template_version WHERE template_id=? AND revision=?",id,revision));}
    private Map<String,Object> owned(String actor,String id){return required(access.one("SELECT * FROM nw_knowledge_creation_job WHERE owner_id=? AND id=?",actor,id));}
    public Object resources(String actor,String connection){access.requireAdmin(actor);return remote.resources(connection(connection,false));}
    public Object validateTemplate(String actor,String connection,JsonNode config){access.requireAdmin(actor);remote.validate(connection(connection,false),technical(config));return map("valid",true);}
    private Object dto(Map<String,Object> t,boolean admin){
        Map<String,Object> v=version(string(t,"id"),number(t,"revision"));JsonNode config=parse(v,"config_json");
        Map<String,Object> out=map("id",t.get("id"),"connectionId",t.get("connection_id"),"name",t.get("name"),"revision",t.get("revision"),"enabled",bool(t.get("enabled")),"isDefault",bool(t.get("is_default")),"capabilities",map("rag",config.path("indexing_strategy").path("vector_enabled").asBoolean()||config.path("indexing_strategy").path("keyword_enabled").asBoolean(),"wiki",config.path("indexing_strategy").path("wiki_enabled").asBoolean(),"graph",config.path("indexing_strategy").path("graph_enabled").asBoolean(),"image",config.path("vlm_config").path("enabled").asBoolean()));
        if(admin)out.put("config",config);return out;
    }
    public Object templates(String actor,String connectionId){
        boolean admin=connectionId!=null;if(admin)access.requireAdmin(actor);List<Object> out=new ArrayList<>();
        for(Map<String,Object> t:access.jdbc().queryForList("SELECT * FROM nw_knowledge_template ORDER BY is_default DESC,name,id")){
            if(admin){if(connectionId.equals(t.get("connection_id")))out.add(dto(t,true));}
            else{Map<String,Object> c=access.one("SELECT * FROM nw_knowledge_connection WHERE id=?",t.get("connection_id"));Map<String,Object> v=version(string(t,"id"),number(t,"revision"));if(c!=null&&bool(c.get("enabled"))&&bool(c.get("published"))&&bool(t.get("enabled"))&&target(c).equals(v.get("target_hash")))out.add(dto(t,false));}
        }return out;
    }
    public Object templateDetail(String actor,String id){access.requireAdmin(actor);return dto(template(id),true);}
    public Object saveTemplate(String actor,String connectionId,String templateId,JsonNode body){
        access.requireAdmin(actor);fields(body,"name","revision","enabled","isDefault","config");String name=word(body,"name",200,true);flag(body,"enabled");flag(body,"isDefault");ObjectNode config=technical(body.path("config"));
        Map<String,Object> c=connection(connectionId,false);String fingerprint=target(c);boolean enabled=body.path("enabled").asBoolean(),isDefault=body.path("isDefault").asBoolean();check(!isDefault||enabled,"默认模板必须启用");if(enabled)remote.validate(c,config);
        return tx.execute(status->{
            access.lock();check(fingerprint.equals(target(connection(connectionId,false))),"校验期间连接目标发生变化，请重新校验");String id=templateId==null?id("ktpl"):templateId;long next=1;
            if(templateId!=null){Map<String,Object> old=template(id);check(connectionId.equals(old.get("connection_id")),"模板不属于此连接");if(number(old,"revision")!=revision(body))changed(0);next=number(old,"revision")+1;}
            if(isDefault)access.jdbc().update("UPDATE nw_knowledge_template SET is_default=FALSE WHERE connection_id=?",connectionId);
            if(templateId==null)access.jdbc().update("INSERT INTO nw_knowledge_template(id,connection_id,name,revision,enabled,is_default) VALUES(?,?,?,?,?,?)",id,connectionId,name,next,enabled,isDefault);
            else access.jdbc().update("UPDATE nw_knowledge_template SET name=?,revision=?,enabled=?,is_default=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=?",name,next,enabled,isDefault,id);
            access.jdbc().update("INSERT INTO nw_knowledge_template_version(template_id,revision,config_json,target_hash,created_by) VALUES(?,?,?,?,?)",id,next,config.toString(),fingerprint,actor);
            knowledge.audit(actor,id,"creation_template_saved",map("revision",next,"enabled",enabled));return dto(template(id),true);
        });
    }
    public Object submit(String actor,JsonNode body){
        fields(body,"templateId","revision","name","description","preview","requestKey");String templateId=word(body,"templateId",64,true),key=word(body,"requestKey",100,true);check(key.matches("[A-Za-z0-9_-]{8,100}"),"缺少有效操作编号");word(body,"name",200,false);word(body,"description",4000,true);flag(body,"preview");long rev=revision(body);
        ObjectNode input=json.createObjectNode().put("templateId",templateId).put("revision",rev).put("name",word(body,"name",200,false)).put("description",word(body,"description",4000,true)).put("preview",body.path("preview").asBoolean());String digest=hash(input.toString());
        return tx.execute(status->{access.lock();Map<String,Object> old=access.one("SELECT * FROM nw_knowledge_creation_job WHERE owner_id=? AND request_key=?",actor,key);if(old!=null){if(!digest.equals(old.get("request_hash")))throw new ApiException(409,"此操作编号已用于其他需求，请重新打开创建表单");return jobDto(actor,old);}
            Map<String,Object> t=template(templateId);if(!bool(t.get("enabled")))throw new ApiException(403,"模板已停用");if(number(t,"revision")!=rev)throw new ApiException(409,"模板已更新，请刷新模板后提交");Map<String,Object> c=connection(string(t,"connection_id"),true),v=version(templateId,rev);check(target(c).equals(v.get("target_hash")),"连接目标已变化，请管理员重新校验模板");
            String id=id("kcj");access.jdbc().update("INSERT INTO nw_knowledge_creation_job(id,owner_id,connection_id,template_id,template_revision,request_key,request_hash,target_hash,config_json,input_json,status,step) VALUES(?,?,?,?,?,?,?,?,?,?,'queued','preflight')",id,actor,c.get("id"),templateId,rev,key,digest,target(c),v.get("config_json"),input.toString());
            knowledge.audit(actor,id,"knowledge_creation_queued",map("templateId",templateId,"revision",rev));return jobDto(actor,owned(actor,id));
        });
    }
    private Map<String,Object> current(Map<String,Object> job,boolean requireTemplate){
        Map<String,Object> c=connection(string(job,"connection_id"),true);check(target(c).equals(job.get("target_hash")),"连接目标已变化，创建任务已停止");if(requireTemplate&&!bool(template(string(job,"template_id")).get("enabled")))throw new ApiException(403,"模板已停用，创建任务已停止");return c;
    }
    private Object jobDto(String actor,Map<String,Object> row){
        Map<String,Object> c=access.one("SELECT * FROM nw_knowledge_connection WHERE id=?",row.get("connection_id"));String kb=string(row,"collection_id");boolean visible=c!=null&&bool(c.get("enabled"))&&target(c).equals(row.get("target_hash"))&&(kb.isEmpty()?bool(c.get("published")):access.allowed(actor,c,kb,false));
        return map("id",row.get("id"),"connectionId",row.get("connection_id"),"templateId",row.get("template_id"),"templateRevision",row.get("template_revision"),"status",row.get("status"),"step",row.get("step"),"error",row.get("error_message"),"collectionId",visible?kb:null,"business",visible&&row.get("business_json")!=null?parse(row,"business_json"):null,"name",visible?parse(row,"input_json").path("name").asText():null,"description",visible?parse(row,"input_json").path("description").asText():null,"createdAt",row.get("created_at"));
    }
    public Object job(String actor,String id){return jobDto(actor,owned(actor,id));}
    public Object jobs(String actor){List<Object> out=new ArrayList<>();for(Map<String,Object> j:access.jdbc().queryForList("SELECT * FROM nw_knowledge_creation_job WHERE owner_id=? ORDER BY created_at DESC LIMIT 100",actor))out.add(jobDto(actor,j));return out;}
    public Object confirm(String actor,String id,JsonNode body){
        fields(body,"business");ObjectNode business=business(body.path("business"));
        return tx.execute(status->{access.lock();Map<String,Object> j=owned(actor,id);current(j,true);if(!"preview".equals(j.get("status")))throw new ApiException(409,"任务已提交或不处于预览状态");ObjectNode payload=assemble(parse(j,"config_json"),business,parse(j,"input_json").path("name").asText());
            access.jdbc().update("UPDATE nw_knowledge_creation_job SET business_json=?,payload_json=?,status='queued',step='validate',updated_at=CURRENT_TIMESTAMP(6) WHERE id=?",business.toString(),payload.toString(),id);return job(actor,id);});
    }
    public Object retry(String actor,String id,boolean recover){
        return tx.execute(status->{access.lock();Map<String,Object> j=owned(actor,id);current(j,!recover);String state=string(j,"status");
            if(recover){check(Arrays.asList("unknown","failed").contains(state),"任务不需要恢复");Map<String,Object> receipt=string(j,"receipt_id").isEmpty()?null:operations.owned(actor,string(j,"receipt_id"));check(receipt!=null&&(operations.result(receipt)!=null||!string(j,"collection_id").isEmpty()),"未保存远端创建标识，请管理员核对；禁止重复创建或自行填写远端 ID");access.jdbc().update("UPDATE nw_knowledge_creation_job SET status='queued',step='recover',error_message=NULL WHERE id=?",id);}
            else{check("failed".equals(state)&&string(j,"receipt_id").isEmpty(),"此任务可能已创建远端库，请使用恢复入口");access.jdbc().update("UPDATE nw_knowledge_creation_job SET status='queued',step='preflight',error_message=NULL WHERE id=?",id);}
            return job(actor,id);});
    }
    public List<String> due(){
        // An expired create lease is never replayed; generation can be retried explicitly.
        access.jdbc().update("UPDATE nw_knowledge_creation_job SET status=CASE WHEN receipt_id IS NULL THEN 'failed' ELSE 'unknown' END,error_message='处理已中断，请重试生成或核对原创建结果',lease_token=NULL WHERE status='running' AND lease_until<CURRENT_TIMESTAMP(6)");
        return access.jdbc().queryForList("SELECT id FROM nw_knowledge_creation_job WHERE status='queued' ORDER BY created_at LIMIT 2",String.class);
    }
    private void lease(String id,String token,String step){changed(access.jdbc().update("UPDATE nw_knowledge_creation_job SET step=?,lease_until=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND status='running' AND lease_token=?",step,new Timestamp(System.currentTimeMillis()+1000000),id,token));}
    private void finish(String id,String token,String state,String step,String error){changed(access.jdbc().update("UPDATE nw_knowledge_creation_job SET status=?,step=?,error_message=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND lease_token=?",state,step,error,id,token));}
    public void process(String id){
        String token=id("lease");Boolean claimed=tx.execute(s->{access.lock();return access.jdbc().update("UPDATE nw_knowledge_creation_job SET status='running',lease_token=?,lease_until=? WHERE id=? AND status='queued'",token,new Timestamp(System.currentTimeMillis()+1000000),id)==1;});if(!Boolean.TRUE.equals(claimed))return;
        Map<String,Object> j=access.one("SELECT * FROM nw_knowledge_creation_job WHERE id=?",id);String actor=string(j,"owner_id");
        try{
            Map<String,Object> c=current(j,string(j,"receipt_id").isEmpty());JsonNode config=parse(j,"config_json"),input=parse(j,"input_json");JsonNode payload;
            if(string(j,"receipt_id").isEmpty()){
                lease(id,token,"preflight");remote.validate(c,config);
                if(j.get("business_json")==null){lease(id,token,"generating");ObjectNode b=business(remote.generate(c,input,config));current(j,true);if(!input.path("name").asText().isEmpty())b.put("name",input.path("name").asText());changed(access.jdbc().update("UPDATE nw_knowledge_creation_job SET business_json=? WHERE id=? AND lease_token=?",b.toString(),id,token));j.put("business_json",b.toString());if(input.path("preview").asBoolean()){finish(id,token,"preview","preview",null);return;}}
                if(input.path("preview").asBoolean()&&j.get("payload_json")==null){finish(id,token,"preview","preview",null);return;}
                lease(id,token,"validate");payload=assemble(config,parse(j,"business_json"),input.path("name").asText());c=current(j,true);remote.validate(c,config);
                String remoteId=j.get("payload_json")==null?"":parse(j,"payload_json").path("id").asText();if(remoteId.isEmpty())remoteId=UUID.randomUUID().toString();((ObjectNode)payload).put("id",remoteId);
                changed(access.jdbc().update("UPDATE nw_knowledge_creation_job SET payload_json=?,collection_id=? WHERE id=? AND lease_token=?",payload.toString(),remoteId,id,token));j.put("collection_id",remoteId);
                // Claim remote dispatch under the same guard as connection and template mutations.
                Map<String,Object> receipt=tx.execute(s->{access.lock();current(j,true);lease(id,token,"creating");return operations.begin(actor,string(j,"connection_id"),"","aicreate-"+id,"kb.create",payload);});
                String receiptId=string(receipt,"id");changed(access.jdbc().update("UPDATE nw_knowledge_creation_job SET receipt_id=? WHERE id=? AND lease_token=?",receiptId,id,token));j.put("receipt_id",receiptId);
                if(Boolean.TRUE.equals(receipt.get("claimed"))){JsonNode created=remote.create(c,payload);check(payload.path("id").asText().equals(created.path("id").asText()),"远端创建 ID 与原操作不一致，请管理员核对");operations.received(receiptId,json.createObjectNode().put("id",created.path("id").asText()));}
            }else payload=parse(j,"payload_json");
            Map<String,Object> receipt=operations.owned(actor,string(j,"receipt_id"));JsonNode created=operations.result(receipt);if(created==null&&!string(j,"collection_id").isEmpty()){lease(id,token,"verifying");JsonNode found=remote.read(current(j,false),string(j,"collection_id"));remote.verify(found,payload);created=json.createObjectNode().put("id",string(j,"collection_id"));operations.received(string(j,"receipt_id"),created);}if(created==null)throw new ApiException(409,"远端创建结果尚不明确，禁止重复提交，请核对原操作");String kb=KnowledgeCreationRemote.data(created).path("id").asText();check(!kb.isEmpty(),"创建回执缺少知识库 ID");
            changed(access.jdbc().update("UPDATE nw_knowledge_creation_job SET collection_id=? WHERE id=? AND lease_token=?",kb,id,token));lease(id,token,"verifying");c=current(j,false);remote.verify(remote.read(c,kb),payload);
            lease(id,token,"registering");tx.execute(s->{access.lock();Map<String,Object> now=current(j,false);access.register(now,kb,actor);operations.finish(string(j,"receipt_id"));finish(id,token,"completed","completed",null);knowledge.audit(actor,kb,"ai_knowledge_created",map("jobId",id,"templateId",j.get("template_id"),"revision",j.get("template_revision")));return null;});
        }catch(Exception failure){
            Map<String,Object> latest=access.one("SELECT * FROM nw_knowledge_creation_job WHERE id=?",id);boolean sent=latest!=null&&!string(latest,"receipt_id").isEmpty();
            String message=failure instanceof ApiException?failure.getMessage():"创建处理失败，请重试或恢复原任务";if(message.length()>900)message=message.substring(0,900);
            access.jdbc().update("UPDATE nw_knowledge_creation_job SET status=?,error_message=?,lease_token=NULL,lease_until=NULL,updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND lease_token=?",sent?"unknown":"failed",message,id,token);
        }
    }
}
