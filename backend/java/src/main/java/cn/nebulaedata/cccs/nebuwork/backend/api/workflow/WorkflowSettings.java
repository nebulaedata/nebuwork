package cn.nebulaedata.cccs.nebuwork.backend.api.workflow;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import com.fasterxml.jackson.databind.*;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import java.util.function.Supplier;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.workflow.WorkflowStore.*;

@Service
public class WorkflowSettings {
    public static final class Connection {
        public final boolean enabled;public final String baseUrl;public final int timeoutMs;public final boolean hasApiKey;
        private final Supplier<String> secret;
        Connection(boolean enabled,String url,int timeout,boolean hasKey,Supplier<String> key) { this.enabled=enabled;baseUrl=url;timeoutMs=timeout;hasApiKey=hasKey;secret=key; }
        String apiKey() { return secret.get(); }
    }
    private final WorkflowStore db;private final ModelSecretCipher cipher;private final Environment env;private final ObjectMapper json;private final WorkflowClient client;
    public WorkflowSettings(WorkflowStore db,ModelSecretCipher cipher,Environment env,ObjectMapper json,WorkflowClient client) { this.db=db;this.cipher=cipher;this.env=env;this.json=json;this.client=client; }
    public boolean canEdit(String actor) { return actor!=null&&!actor.isEmpty()&&Arrays.stream(env.getProperty("nebu.workflow.admin-ids","").split(",")).map(String::trim).anyMatch(actor::equals); }
    private void admin(String actor) { if(!canEdit(actor))throw new ApiException(403,"仅指定管理员可以修改或测试 Workflow 接入配置"); }
    public Connection current() { return from(db.settings(false)); }
    private Connection from(Map<String,Object> row) {
        if(flag(row.get("configured"))) {
            Object encrypted=row.get("api_key_cipher");
            return new Connection(flag(row.get("enabled")),str(row,"base_url"),(int)number(row,"request_timeout_ms"),encrypted!=null,
                ()->encrypted==null?"":cipher.decrypt("system-workflow","nebulae-3.5",encrypted.toString()));
        }
        String key=env.getProperty("nebu.workflow.api-key","");
        return new Connection(env.getProperty("nebu.workflow.enabled",Boolean.class,false),env.getProperty("nebu.workflow.base-url","http://127.0.0.1:8765"),15000,!key.isEmpty(),()->key);
    }
    public boolean originLocked() { return db.one("SELECT id FROM nw_workflow LIMIT 1")!=null; }
    public Map<String,Object> read(String actor) { return view(actor,db.settings(false)); }
    private Map<String,Object> view(String actor,Map<String,Object> row) {
        Connection c=from(row);Map<String,Object> v=map("canEdit",canEdit(actor),"actorId",actor,"configured",flag(row.get("configured")),"enabled",c.enabled);
        if(canEdit(actor))v.putAll(map("revision",number(row,"revision"),"baseUrl",c.baseUrl,"hasApiKey",c.hasApiKey,"originLocked",originLocked(),"requestTimeoutMs",c.timeoutMs,"updatedAt",Objects.toString(row.get("updated_at"),null)));
        return v;
    }
    private Connection draft(JsonNode body,Map<String,Object> row) {
        if(body==null||!body.isObject())throw new ApiException(422,"配置必须是对象");
        Set<String> allowed=new HashSet<>(Arrays.asList("revision","enabled","baseUrl","apiKey","clearApiKey","requestTimeoutMs"));
        body.fieldNames().forEachRemaining(k->{if(!allowed.contains(k))throw new ApiException(422,"不支持的 Workflow 配置字段");});
        if(!body.path("revision").isIntegralNumber()||!body.path("revision").canConvertToLong()||body.path("revision").asLong()!=number(row,"revision"))throw new ApiException(409,"配置已变化，请重新加载后保存");
        if(!body.path("enabled").isBoolean()||(body.has("clearApiKey")&&!body.path("clearApiKey").isBoolean()))throw new ApiException(422,"开关必须为布尔值");
        String url=WorkflowEndpoint.normalize(text(body,"baseUrl",2048,true));Connection old=from(row);
        boolean changed=!url.equals(WorkflowEndpoint.normalize(old.baseUrl));
        if(changed&&originLocked())throw new ApiException(409,"已有工作流记录，切换服务前需要迁移工作流及任务数据");
        String key=text(body,"apiKey",8192,false);boolean clear=body.path("clearApiKey").asBoolean();
        if(key.chars().anyMatch(c->c<33||c>126)||clear&&!key.isEmpty())throw new ApiException(422,"访问密钥需使用不含空白的 ASCII 字符，且不能同时选择清除");
        if(changed&&old.hasApiKey&&key.isEmpty()&&!clear)throw new ApiException(422,"更换地址时必须重新填写或明确清除访问密钥");
        JsonNode timeout=body.path("requestTimeoutMs");if(!timeout.isIntegralNumber()||!timeout.canConvertToInt()||timeout.intValue()<1000||timeout.intValue()>60000)throw new ApiException(422,"请求超时范围为 1000–60000 毫秒");
        return new Connection(body.path("enabled").asBoolean(),url,timeout.intValue(),!clear&&(!key.isEmpty()||old.hasApiKey),()->clear?"":key.isEmpty()?old.apiKey():key);
    }
    @Transactional public Object save(String actor,JsonNode body,String key) {
        admin(actor);Map<String,Object> row=db.settings(true);Map<String,Object> request=reserve(actor,key,"settings",body);
        if(request.get("result_json")!=null)return decode(request.get("result_json"));
        Connection c=draft(body,row);String action=body.path("clearApiKey").asBoolean()?"clear":text(body,"apiKey",8192,false).isEmpty()?"keep":"replace";
        Object encrypted=flag(row.get("configured"))&&"keep".equals(action)?row.get("api_key_cipher"):c.hasApiKey?cipher.encrypt("system-workflow","nebulae-3.5",c.apiKey()):null;
        db.update("UPDATE nw_workflow_settings SET configured=TRUE,enabled=?,base_url=?,api_key_cipher=?,request_timeout_ms=?,revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=1",c.enabled,c.baseUrl,encrypted,c.timeoutMs,actor);
        Object result=view(actor,db.settings(false));
        db.update("INSERT INTO nw_workflow_settings_audit(revision,actor,settings_json,credential_action) VALUES(?,?,?,?)",number(db.settings(false),"revision"),actor,encode(result),action);
        finish(actor,key,result);return decode(encode(result));
    }
    public Object test(String actor,JsonNode body) {
        admin(actor);Connection c=draft(body,db.settings(false));long start=System.nanoTime();JsonNode health=client.request(c,"GET","/api/v1/health",null);
        if(!"nebulae-workflow".equals(health.path("service").asText())||health.path("integration_version").asInt()!=1)throw new ApiException(502,"请部署支持 NebuWork 接入的 Workflow 3.5 服务");
        if(!"ok".equals(health.path("status").asText())||!health.path("scheduler").asBoolean())throw new ApiException(502,"Workflow 服务可达，但调度器未就绪");
        return map("reachable",true,"latencyMs",(System.nanoTime()-start)/1000000,"message","服务身份、接入接口与调度器检查通过；未创建任务，配置尚未保存");
    }
    public Connection requireEnabled() { Connection c=current();if(!c.enabled)throw new ApiException(409,"Workflow 接入未启用，请联系管理员在设置中配置");return c; }
    public Map<String,Object> reserve(String actor,String key,String operation,Object body) {
        if(key==null||!key.matches("[A-Za-z0-9_-]{8,100}"))throw new ApiException(422,"缺少有效的 Idempotency-Key");
        String hash=hash(encode(map("operation",operation,"body",body)));
        db.update("INSERT INTO nw_workflow_request(owner_id,request_key,request_hash) VALUES(?,?,?) ON DUPLICATE KEY UPDATE request_key=request_key",actor,key,hash);
        Map<String,Object> row=db.one("SELECT * FROM nw_workflow_request WHERE owner_id=? AND request_key=? FOR UPDATE",actor,key);
        if(!hash.equals(row.get("request_hash")))throw new ApiException(409,"操作编号已用于不同请求");return row;
    }
    public void finish(String actor,String key,Object result) { db.update("UPDATE nw_workflow_request SET result_json=? WHERE owner_id=? AND request_key=?",encode(result),actor,key); }
    public String encode(Object v) { try{return json.writeValueAsString(v);}catch(Exception e){throw new IllegalStateException(e);} }
    public JsonNode decode(Object v) { return cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.decode(json,v); }
    static String text(JsonNode body,String name,int max,boolean required) {
        JsonNode v=body.get(name);if(v!=null&&!v.isNull()&&!v.isTextual())throw new ApiException(422,name+" 必须是文本");
        String s=v==null||v.isNull()?"":v.asText().trim();if(s.length()>max||required&&s.isEmpty())throw new ApiException(422,name+" 不能为空或超过长度限制");return s;
    }
    private String hash(String text) { try { byte[] bytes=MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));StringBuilder b=new StringBuilder();for(byte v:bytes)b.append(String.format("%02x",v));return b.toString(); }catch(Exception e){throw new IllegalStateException(e);} }
}
