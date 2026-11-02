package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;

@Service
public class MemoryConfigurationService {
    private final MemoryConfigurationStore store;
    private final MemorySettings settings;
    private final MemoryStore db;
    private final Environment env;
    private final ObjectMapper json;
    private final HindsightClient client;
    public MemoryConfigurationService(MemoryConfigurationStore store,MemorySettings settings,MemoryStore db,Environment env,ObjectMapper json,HindsightClient client) {
        this.store=store;this.settings=settings;this.db=db;this.env=env;this.json=json;this.client=client;
    }
    boolean canEdit(String actor) {
        return actor!=null&&!actor.isEmpty()&&Arrays.stream(env.getProperty("nebu.memory.admin-ids","").split(","))
            .map(String::trim).anyMatch(actor::equals);
    }
    private void admin(String actor) { if (!canEdit(actor)) throw new ApiException(403,"仅指定的记忆管理员可以修改或测试全系统配置"); }
    public Object read(String actor) { return view(actor,store.read(false)); }
    private Object view(String actor,Map<String,Object> row) {
        MemorySettings.Connection c=settings.from(row);
        Map<String,Object> result=map("canEdit",canEdit(actor),"actorId",actor,"configured",bool(row.get("configured")),"enabled",c.enabled);
        if (canEdit(actor)) result.putAll(map("revision",number(row,"revision"),"baseUrl",c.baseUrl,"hasApiKey",c.hasApiKey,
            "recallTimeoutMs",c.recallMs,"requestTimeoutMs",c.requestMs,"recallMaxTokens",c.tokens,
            "originLocked",store.originLocked(),"updatedBy",row.get("updated_by"),"updatedAt",time(row.get("updated_at"))));
        return result;
    }
    private int integer(JsonNode body,String name,int min,int max) {
        JsonNode n=body.path(name);
        if (!n.isIntegralNumber()||!n.canConvertToInt()||n.intValue()<min||n.intValue()>max) throw new ApiException(422,name+" 必须是 "+min+"–"+max+" 的整数");
        return n.intValue();
    }
    private MemorySettings.Connection draft(JsonNode body,Map<String,Object> row) {
        if (body==null||!body.isObject()) throw new ApiException(422,"配置必须是对象");
        Set<String> fields=new HashSet<>(Arrays.asList("revision","enabled","baseUrl","apiKey","clearApiKey","recallTimeoutMs","requestTimeoutMs","recallMaxTokens"));
        body.fieldNames().forEachRemaining(k->{if(!fields.contains(k))throw new ApiException(422,"不支持的记忆配置字段");});
        if (!body.path("revision").canConvertToLong()||body.path("revision").asLong()<0) throw new ApiException(422,"无效配置版本");
        revision(row,body);
        if (!body.path("enabled").isBoolean()||(body.has("clearApiKey")&&!body.path("clearApiKey").isBoolean())) throw new ApiException(422,"开关必须是布尔值");
        String url=MemoryEndpoint.normalize(text(body,"baseUrl",2048,true));
        MemorySettings.Connection before=settings.from(row);
        boolean changed=!url.equals(MemoryEndpoint.normalize(before.baseUrl));
        if (changed&&store.originLocked()) throw new ApiException(409,"已有记忆范围，切换服务前需迁移原有 Bank 和待处理操作；当前页面不执行服务迁移");
        String supplied=text(body,"apiKey",8192,false);
        if (supplied.chars().anyMatch(ch->ch<32||ch==127)) throw new ApiException(422,"访问密钥不能含控制字符");
        boolean clear=body.path("clearApiKey").asBoolean(false);
        if (clear&&!supplied.isEmpty()) throw new ApiException(422,"不能同时清除和填写访问密钥");
        if (changed&&before.hasApiKey&&supplied.isEmpty()&&!clear) throw new ApiException(422,"更换服务地址时，请重新填写访问密钥或明确清除，避免发送原服务凭据");
        // Keep stored ciphertext lazy: reads, disabling, and budget changes do not require decryption.
        return new MemorySettings.Connection(body.path("enabled").asBoolean(),url,
            integer(body,"recallTimeoutMs",500,10000),integer(body,"requestTimeoutMs",1000,30000),integer(body,"recallMaxTokens",100,6000),
            !clear&&(!supplied.isEmpty()||before.hasApiKey),()->clear?"":(!supplied.isEmpty()?supplied:before.apiKey()));
    }
    @Transactional public Object save(String actor,JsonNode body,String requestKey) {
        admin(actor); key(requestKey);
        // The singleton lock serializes destination changes with first-scope creation.
        Map<String,Object> row=store.read(true);
        String digest=fingerprint(json.valueToTree(map("operation","memory-settings","body",body)));
        db.update("INSERT INTO nw_memory_request(owner_id,request_key,request_hash) VALUES(?,?,?) ON DUPLICATE KEY UPDATE request_key=request_key",actor,requestKey,digest);
        Map<String,Object> request=db.one("SELECT * FROM nw_memory_request WHERE owner_id=? AND request_key=? FOR UPDATE",actor,requestKey);
        sameHash(request,digest);
        if (request.get("result_json")!=null) return decode(json,request.get("result_json"));
        MemorySettings.Connection c=draft(body,row);
        String action=body.path("clearApiKey").asBoolean()?"clear":(text(body,"apiKey",8192,false).isEmpty()?"keep":"replace");
        Object encrypted=bool(row.get("configured"))&&"keep".equals(action)?row.get("api_key_cipher"):store.encrypt(c.apiKey());
        db.update("UPDATE nw_memory_settings SET configured=TRUE,enabled=?,base_url=?,api_key_cipher=?,recall_timeout_ms=?,request_timeout_ms=?,recall_max_tokens=?,revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=1",
            c.enabled,c.baseUrl,encrypted,c.recallMs,c.requestMs,c.tokens,actor);
        Map<String,Object> saved=store.read(false); Object result=view(actor,saved);
        db.update("INSERT INTO nw_memory_settings_audit(revision,actor,settings_json,credential_action) VALUES(?,?,?,?)",number(saved,"revision"),actor,encode(json,result),action);
        db.update("UPDATE nw_memory_request SET result_json=? WHERE owner_id=? AND request_key=?",encode(json,result),actor,requestKey);
        return decode(json,encode(json,result));
    }
    public Object test(String actor,JsonNode body) {
        admin(actor);
        MemorySettings.Connection c=draft(body,store.read(false));
        long started=System.nanoTime();
        try {
            // Official readiness contract uses HTTP 200/503; its JSON payload has no fixed schema.
            client.request(c,"GET","/health",null,Math.min(c.requestMs,10000));
            return map("reachable",true,"latencyMs",(System.nanoTime()-started)/1000000,
                "message","健康接口可达；此测试未写入记忆，也未验证访问密钥及提取、召回效果");
        } catch(HindsightClient.Failure failure) { throw new ApiException(502,failure.getMessage()); }
    }
}
