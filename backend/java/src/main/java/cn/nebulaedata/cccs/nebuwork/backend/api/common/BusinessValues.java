package cn.nebulaedata.cccs.nebuwork.backend.api.common;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.*;

public final class BusinessValues {
 private BusinessValues(){}
 public static final Set<String> TERMINAL=new HashSet<>(Arrays.asList("completed","failed","cancelled"));
 public static String id(){return UUID.randomUUID().toString().replace("-","");}
 public static String str(Map<String,Object> r,String k){Object v=r.get(k);return v==null?null:v instanceof byte[]?new String((byte[])v,StandardCharsets.UTF_8):v.toString();}
 public static long number(Map<String,Object> r,String k){Object v=r.get(k);return v instanceof Number?((Number)v).longValue():0;}
 public static boolean bool(Object v){return v instanceof Number?((Number)v).intValue()!=0:Boolean.parseBoolean(String.valueOf(v));}
 public static Object time(Object v){return v instanceof Timestamp?((Timestamp)v).toInstant().toString():v;}
 public static Timestamp stamp(JsonNode v){if(v==null||v.isNull()||v.asText().isEmpty())return null;try{return Timestamp.from(Instant.parse(v.asText()));}catch(Exception e){return Timestamp.from(java.time.LocalDateTime.parse(v.asText().replace(' ','T')).toInstant(java.time.ZoneOffset.UTC));}}
 public static String text(JsonNode b,String name,int max,boolean required){JsonNode v=b==null?null:b.get(name);if(v!=null&&!v.isNull()&&!v.isTextual())throw new ApiException(422,name+" 必须是文本");String s=v==null||v.isNull()?"":v.asText().trim();if((required&&s.isEmpty())||s.length()>max||s.indexOf('\0')>=0)throw new ApiException(422,name+" 为空或超出长度限制");return s;}
 public static String key(String s){if(s==null||!s.matches("[A-Za-z0-9_.:-]{8,160}"))throw new ApiException(422,"缺少有效的 Idempotency-Key");return s;}
 public static String encode(ObjectMapper j,Object v){try{return j.writeValueAsString(v);}catch(Exception e){throw new IllegalStateException("Task data encoding failed");}}
 public static JsonNode decode(ObjectMapper j,Object v){try{if(v==null)return j.createObjectNode();if(v instanceof JsonNode)return (JsonNode)v;String raw=v instanceof byte[]?new String((byte[])v,StandardCharsets.UTF_8):v.toString();JsonNode node=j.readTree(raw);if(node.isTextual()&&(node.asText().startsWith("{")||node.asText().startsWith("[")))node=j.readTree(node.asText());return node;}catch(Exception e){throw new IllegalStateException("Business JSON decoding failed",e);}}
 public static String hash(String s){try{byte[] b=MessageDigest.getInstance("SHA-256").digest(s.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte v:b)out.append(String.format("%02x",v&255));return out.toString();}catch(Exception e){throw new IllegalStateException(e);}}
 public static JsonNode canonical(JsonNode n){if(n.isObject()){ObjectNode o=JsonNodeFactory.instance.objectNode();List<String> keys=new ArrayList<>();n.fieldNames().forEachRemaining(keys::add);Collections.sort(keys);for(String k:keys)o.set(k,canonical(n.get(k)));return o;}if(n.isArray()){ArrayNode a=JsonNodeFactory.instance.arrayNode();n.forEach(v->a.add(canonical(v)));return a;}return n;}
 public static String fingerprint(JsonNode n){return hash(canonical(n).toString());}
 public static Map<String,Object> required(Map<String,Object> row){if(row==null)throw new ApiException(404,"任务对象不存在");return row;}
 public static void sameHash(Map<String,Object> row,String hash){if(!hash.equals(row.get("request_hash")))throw new ApiException(409,"该请求编号已用于不同内容");}
 public static void revision(Map<String,Object> row,JsonNode body){if(!body.path("revision").isIntegralNumber()||number(row,"revision")!=body.path("revision").asLong())throw new ApiException(409,"数据已变化，请重新加载后保存");}
}
