package cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.networknt.schema.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

final class ServiceSupport {
    static final String KEY="[A-Za-z][A-Za-z0-9_-]{0,79}";
    static String id(){return UUID.randomUUID().toString();}
    static String random(){byte[] b=new byte[32];new SecureRandom().nextBytes(b);return Base64.getUrlEncoder().withoutPadding().encodeToString(b);}
    static String hash(String s){try{byte[] b=MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte v:b)out.append(String.format("%02x",v&255));return out.toString();}catch(Exception e){throw new IllegalStateException(e);}}
    static String str(Map<String,Object> r,String k){return Objects.toString(r.get(k),"");}
    static long number(Map<String,Object> r,String k){return ((Number)r.get(k)).longValue();}
    static void require(boolean yes,int status,String message){if(!yes)throw new ApiException(status,message);}
    static String text(JsonNode n,String key,int max){JsonNode v=n.path(key);require(v.isTextual()&&!v.asText().trim().isEmpty()&&v.asText().length()<=max,422,"无效字段："+key);return v.asText();}
    static JsonNode parse(ObjectMapper json,Object value){try{return cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.decode(json,value);}catch(Exception e){throw new ApiException(500,"服务记录无法读取");}}
    static void fields(JsonNode n,String... allowed){require(n.isObject(),422,"配置必须为对象");Set<String> keys=new HashSet<>(Arrays.asList(allowed));n.fieldNames().forEachRemaining(k->require(keys.contains(k),422,"不支持的字段："+k));}
    static void requestKey(String key){require(key!=null&&key.matches("[A-Za-z0-9_.:-]{1,128}"),422,"需要稳定的 Idempotency-Key");}
    static boolean contains(JsonNode list,String value){for(JsonNode n:list)if(value.equals(n.asText()))return true;return false;}
    static JsonNode item(JsonNode definition,String group,String key){for(JsonNode n:definition.path(group))if(key.equals(n.path("key").asText()))return n;throw new ApiException(404,"服务能力或页面不存在");}
    static void schema(JsonNode schema,JsonNode value){
        require(schema.isObject()||schema.isBoolean(),422,"需要有效的 JSON Schema");
        // References must be local: schema validation must never fetch a network resource.
        localReferences(schema);
        try{Set<ValidationMessage> errors=JsonSchemaFactory.getInstance(SpecVersion.VersionFlag.V7).getSchema(schema).validate(value);require(errors.isEmpty(),422,"数据不符合接口契约："+errors.stream().limit(4).map(Object::toString).reduce((a,b)->a+"; "+b).orElse(""));}
        catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(422,"JSON Schema 无效");}
    }
    static void localReferences(JsonNode n){if(n.isObject()){for(String k:Arrays.asList("$ref","$id"))if(n.has(k))require(n.get(k).isTextual()&&n.get(k).asText().startsWith("#"),422,"Schema 只允许文档内引用");}if(n.isContainerNode())for(JsonNode child:n)localReferences(child);}
    static Object canonical(JsonNode n){if(n.isObject()){Map<String,Object> r=new TreeMap<>();n.fields().forEachRemaining(e->r.put(e.getKey(),canonical(e.getValue())));return r;}if(n.isArray()){List<Object> r=new ArrayList<>();n.forEach(v->r.add(canonical(v)));return r;}return n;}
    static String fingerprint(ObjectMapper json,JsonNode n){try{return hash(json.writeValueAsString(canonical(n)));}catch(Exception e){throw new ApiException(422,"请求无法编码");}}
    private ServiceSupport(){}
}
