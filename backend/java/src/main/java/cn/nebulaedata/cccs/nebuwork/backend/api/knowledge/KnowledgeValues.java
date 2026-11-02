package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

final class KnowledgeValues {
    private KnowledgeValues() {}
    static String id(String prefix) { return prefix+"-"+UUID.randomUUID().toString().replace("-",""); }
    static String string(Map<String,Object> row,String key) { return Objects.toString(row.get(key),""); }
    static long number(Map<String,Object> row,String key) { return ((Number)row.get(key)).longValue(); }
    static boolean bool(Object value) { return Boolean.TRUE.equals(value)||(value instanceof Number&&((Number)value).intValue()!=0); }
    static String text(JsonNode body,String key,int max,boolean required) {
        JsonNode value=body.path(key);
        if(!value.isMissingNode()&&!value.isNull()&&!value.isTextual()) throw new ApiException(422,key+" 必须为文本");
        String result=value.asText("");
        if(result.length()>max||(required&&result.trim().isEmpty())) throw new ApiException(422,key+" 不能为空或超出长度限制");
        return result; // Opaque remote IDs must not be trimmed, decoded or reconstructed.
    }
    static void fields(JsonNode body,String... fields) {
        if(body==null||!body.isObject()) throw new ApiException(422,"请求必须为 JSON 对象");
        Set<String> allowed=new HashSet<>(Arrays.asList(fields));
        body.fieldNames().forEachRemaining(key->{if(!allowed.contains(key))throw new ApiException(422,"不支持的字段："+key);});
    }
    static long revision(JsonNode body) {
        JsonNode n=body.path("revision");
        if(!n.isIntegralNumber()||!n.canConvertToLong()||n.asLong()<1) throw new ApiException(422,"缺少有效 revision");
        return n.asLong();
    }
    static void changed(int n) { if(n!=1)throw new ApiException(409,"知识库配置已变化，请重新加载"); }
    static <T> T required(T value) { if(value==null)throw new ApiException(404,"知识库资源不存在或不可访问");return value; }
    static String hash(String value) {
        try {StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)))s.append(String.format("%02x",b&255));return s.toString();}
        catch(Exception e){throw new IllegalStateException(e);}
    }
}

