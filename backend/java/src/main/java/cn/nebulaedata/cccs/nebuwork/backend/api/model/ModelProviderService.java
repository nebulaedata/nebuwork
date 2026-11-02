package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

@Service
public class ModelProviderService {
    private final ModelProviderMapper db;
    private final ModelSecretCipher cipher;
    private final ModelCatalogClient catalog;
    private final ObjectMapper json;
    private final TransactionTemplate transactions;
    public ModelProviderService(ModelProviderMapper db,ModelSecretCipher cipher,ModelCatalogClient catalog,ObjectMapper json,PlatformTransactionManager manager) {
        this.db=db; this.cipher=cipher; this.catalog=catalog; this.json=json; this.transactions=new TransactionTemplate(manager);
    }
    private static String id() { return UUID.randomUUID().toString().replace("-",""); }
    private static String hash(String value) {
        try {
            byte[] bytes=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
            StringBuilder result=new StringBuilder(); for(byte b:bytes) result.append(String.format("%02x",b&255)); return result.toString();
        } catch(java.security.NoSuchAlgorithmException e) { throw new IllegalStateException("SHA-256 unavailable"); }
    }
    private Map<String,Object> owned(String owner,String provider) {
        Map<String,Object> result=db.owned(owner,provider);
        if(result==null) throw new ApiException(404,"模型配置不存在");
        return result;
    }
    private Object time(Object value) { return value instanceof Timestamp?((Timestamp)value).toInstant().toString():value; }
    private boolean bool(Object value) { return value instanceof Number?((Number)value).intValue()!=0:Boolean.parseBoolean(String.valueOf(value)); }
    private Map<String,Object> profile(Map<String,Object> row) {
        return map("id",row.get("id"),"type",row.get("provider_type"),"baseUrl",row.get("base_url"),"model",row.get("model_name"),
            "hasApiKey",true,"status",row.get("test_status"),"lastTestedAt",time(row.get("last_tested_at")),
            "lastLatencyMs",row.get("last_latency_ms"),"lastModelFound",row.get("last_model_found")==null?null:bool(row.get("last_model_found")),
            "createdAt",time(row.get("created_at")),"updatedAt",time(row.get("updated_at")));
    }
    private Map<String,Object> settingsView(Map<String,Object> row) {
        if(row==null) return map("defaultProviderId",null,"auditFallbackProviderId",null,"retainAuditTrail",true,
            "autoArchiveArtifacts",true,"autoMemoryBackflow",true,"revision",0L,"updatedAt",null);
        return map("defaultProviderId",row.get("default_provider_id"),"auditFallbackProviderId",row.get("audit_fallback_provider_id"),
            "retainAuditTrail",bool(row.get("retain_audit_trail")),"autoArchiveArtifacts",bool(row.get("auto_archive_artifacts")),
            "autoMemoryBackflow",bool(row.get("auto_memory_backflow")),"revision",((Number)row.get("revision")).longValue(),"updatedAt",time(row.get("updated_at")));
    }
    private void audit(String owner,String type,String object,String action,Map<String,Object> change) {
        try {
            db.audit(map("id",id(),"actor",owner,"type",type,"object",object,"action",action,"change",json.writeValueAsString(change)));
        } catch(com.fasterxml.jackson.core.JsonProcessingException e) { throw new IllegalStateException("无法序列化模型配置审计"); }
    }
    private Map<String,Object> lock(String owner) { db.ensureSettings(owner); return settingsView(db.lockSettings(owner)); }

    public List<Map<String,Object>> list(String owner) {
        List<Map<String,Object>> result=new ArrayList<>(); for(Map<String,Object> row:db.list(owner)) result.add(profile(row)); return result;
    }
    public Map<String,Object> settings(String owner) { return settingsView(db.settings(owner)); }
    @Transactional
    public Map<String,Object> selectForTask(String owner,String provider) {
        lock(owner);
        Map<String,Object> row=owned(owner,provider);
        if(!ModelCredentials.supportsExecution(String.valueOf(row.get("provider_type")))) throw new ApiException(422,"任务执行目前仅支持 OpenAI 兼容模型");
        return profile(row);
    }
    @Transactional
    public Map<String,Object> selectForExpert(String owner,String provider) {
        // Joins expert creation's transaction so deletion cannot race with binding this provider.
        lock(owner);
        Map<String,Object> selected=owned(owner,provider);
        return map("id",selected.get("id"),"model",selected.get("model_name"));
    }
    @Transactional
    public Map<String,Object> create(String owner,JsonNode body) {
        ModelCredentials value=ModelCredentials.parse(body,true);
        String provider=id();
        String secret=cipher.encrypt(owner,provider,value.apiKey);
        lock(owner);
        try {
            db.insert(map("id",provider,"owner",owner,"type",value.type,"url",value.baseUrl,"model",value.model,
                "fingerprint",hash(value.type+"\n"+value.endpoint.toASCIIString()+"\n"+value.model),"secret",secret));
        } catch(DuplicateKeyException e) { throw new ApiException(409,"相同厂商、地址和模型的配置已存在"); }
        Map<String,Object> result=profile(owned(owner,provider));
        audit(owner,"model_provider",provider,"create",result);
        return result;
    }
    @Transactional
    public void delete(String owner,String provider) {
        Map<String,Object> settings=lock(owner);
        owned(owner,provider);
        boolean changed=false;
        for(String key:Arrays.asList("defaultProviderId","auditFallbackProviderId")) {
            if(provider.equals(settings.get(key))) { settings.put(key,null); changed=true; }
        }
        if(changed) {
            settings.put("owner",owner);
            if(db.updateSettings(settings)!=1) throw new ApiException(409,"模型设置已变化，请重新加载");
            audit(owner,"model_settings",hash(owner),"clear_reference",map("deletedProviderId",provider));
        }
        int clearedExperts=db.clearExpertReferences(provider);
        if(db.delete(owner,provider)!=1) throw new ApiException(404,"模型配置不存在");
        audit(owner,"model_provider",provider,"delete",map("id",provider,"clearedDefaults",changed,"clearedExpertBindings",clearedExperts));
    }
    @Transactional
    public Map<String,Object> updateSettings(String owner,JsonNode body) {
        if(body==null||!body.isObject()||!body.path("revision").isIntegralNumber()||!body.path("revision").canConvertToLong()||body.path("revision").asLong()<0)
            throw new ApiException(422,"缺少有效的模型设置 revision");
        Set<String> fields=new HashSet<>(Arrays.asList("revision","defaultProviderId","auditFallbackProviderId","retainAuditTrail","autoArchiveArtifacts","autoMemoryBackflow"));
        body.fieldNames().forEachRemaining(field -> { if(!fields.contains(field)) throw new ApiException(422,"不支持的模型设置字段"); });
        if(body.size()<2) throw new ApiException(422,"没有需要保存的模型设置");
        Map<String,Object> next=lock(owner);
        if(((Number)next.get("revision")).longValue()!=body.path("revision").asLong()) throw new ApiException(409,"模型设置已被其他操作修改，请重新加载后保存");
        for(String field:Arrays.asList("defaultProviderId","auditFallbackProviderId")) {
            if(!body.has(field)) continue;
            String provider=body.get(field).isNull()?null:ModelCredentials.text(body,field,64,true);
            if(provider!=null) owned(owner,provider);
            next.put(field,provider);
        }
        for(String field:Arrays.asList("retainAuditTrail","autoArchiveArtifacts","autoMemoryBackflow")) {
            if(!body.has(field)) continue;
            if(!body.get(field).isBoolean()) throw new ApiException(422,"开关必须为布尔值");
            next.put(field,body.get(field).asBoolean());
        }
        next.put("owner",owner);
        if(db.updateSettings(next)!=1) throw new ApiException(409,"模型设置已变化，请重新加载");
        Map<String,Object> result=settings(owner);
        audit(owner,"model_settings",hash(owner),"update",result);
        return result;
    }
    public Map<String,Object> discover(JsonNode body) { return catalog.fetch(ModelCredentials.parse(body,false)); }
    private Map<String,Object> test(ModelCredentials value) {
        Map<String,Object> directory=catalog.fetch(value);
        return map("connected",true,"modelFound",((List<?>)directory.get("models")).contains(value.model),"latencyMs",directory.get("latencyMs"));
    }
    public Map<String,Object> testDraft(JsonNode body) { return test(ModelCredentials.parse(body,true)); }
    public Map<String,Object> testSaved(String owner,String provider) {
        Map<String,Object> row=owned(owner,provider);
        long started=System.nanoTime();
        Map<String,Object> result;
        try {
            String key=cipher.decrypt(owner,provider,String.valueOf(row.get("api_key_ciphertext")));
            ModelCredentials value=ModelCredentials.from(String.valueOf(row.get("provider_type")),String.valueOf(row.get("base_url")),key,String.valueOf(row.get("model_name")));
            result=test(value);
        }
        catch(ApiException error) {
            recordTest(owner,provider,false,Math.max(1,java.util.concurrent.TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started)),null,error.status);
            throw error;
        }
        recordTest(owner,provider,true,(Number)result.get("latencyMs"),(Boolean)result.get("modelFound"),null);
        result.putAll(profile(owned(owner,provider)));
        return result;
    }
    private void recordTest(String owner,String provider,boolean connected,Number latency,Boolean found,Integer errorStatus) {
        // Commit diagnostics before propagating a failed upstream request; no DB transaction spans HTTP.
        transactions.execute(status -> {
            if(db.tested(map("owner",owner,"id",provider,"status",connected?"connected":"error","latency",latency,"found",found))!=1)
                throw new ApiException(404,"模型配置已被删除");
            audit(owner,"model_provider",provider,"test",map("connected",connected,"modelFound",found,"latencyMs",latency,"errorStatus",errorStatus));
            return null;
        });
    }
}
