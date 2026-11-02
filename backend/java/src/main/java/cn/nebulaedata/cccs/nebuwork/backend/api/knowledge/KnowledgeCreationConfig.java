package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;

/** Strict separation of administrator infrastructure and generated business instructions. */
final class KnowledgeCreationConfig {
    private KnowledgeCreationConfig(){}
    static void check(boolean condition,String message){if(!condition)throw new ApiException(422,message);}
    static String word(JsonNode n,String k,int max,boolean required){return text(n,k,max,required).trim();}
    static void flag(JsonNode n,String k){check(n.path(k).isBoolean(),k+" 必须为开关");}
    static void count(JsonNode n,String k,int min,int max){check(n.path(k).isIntegralNumber()&&n.path(k).asLong()>=min&&n.path(k).asLong()<=max,k+" 超出允许范围");}
    static ObjectNode technical(JsonNode n){
        fields(n,"generation_model_id","embedding_model_id","summary_model_id","chunking_config","indexing_strategy","wiki_config","vlm_config","asr_config","image_processing_config","storage_backend_id","vector_store_id");
        for(String k:Arrays.asList("generation_model_id","embedding_model_id","summary_model_id"))word(n,k,200,true);
        JsonNode idx=n.path("indexing_strategy");fields(idx,"vector_enabled","keyword_enabled","wiki_enabled","graph_enabled");
        for(String k:Arrays.asList("vector_enabled","keyword_enabled","wiki_enabled","graph_enabled"))flag(idx,k);
        check(idx.path("vector_enabled").asBoolean()||idx.path("keyword_enabled").asBoolean()||idx.path("wiki_enabled").asBoolean()||idx.path("graph_enabled").asBoolean(),"至少启用一种索引");
        JsonNode wiki=n.path("wiki_config");fields(wiki,"synthesis_model_id","extraction_granularity","max_pages_per_ingest");
        word(wiki,"synthesis_model_id",200,idx.path("wiki_enabled").asBoolean());
        check(Arrays.asList("focused","standard","exhaustive").contains(wiki.path("extraction_granularity").asText()),"Wiki 提取粒度无效");count(wiki,"max_pages_per_ingest",0,10000);
        JsonNode vlm=n.path("vlm_config");fields(vlm,"enabled","model_id","description_language");flag(vlm,"enabled");word(vlm,"model_id",200,vlm.path("enabled").asBoolean());word(vlm,"description_language",32,false);
        JsonNode image=n.path("image_processing_config");fields(image,"image_attrs_enabled","image_vector_enabled");flag(image,"image_attrs_enabled");flag(image,"image_vector_enabled");
        check(!image.path("image_vector_enabled").asBoolean()||idx.path("vector_enabled").asBoolean(),"图片向量检索需要开启向量索引");
        JsonNode asr=n.path("asr_config");fields(asr,"enabled","model_id","language");flag(asr,"enabled");word(asr,"model_id",200,asr.path("enabled").asBoolean());word(asr,"language",32,false);
        JsonNode chunk=n.path("chunking_config");fields(chunk,"chunk_size","chunk_overlap","parser_engine_rules","strategy","enable_parent_child","parent_chunk_size");
        count(chunk,"chunk_size",64,32000);count(chunk,"chunk_overlap",0,31999);check(chunk.path("chunk_overlap").asInt()<chunk.path("chunk_size").asInt(),"分块重叠必须小于分块大小");
        if(chunk.has("strategy"))check(Arrays.asList("legacy","auto","heading","heuristic","recursive").contains(chunk.path("strategy").asText()),"分块策略无效");
        if(chunk.has("enable_parent_child"))flag(chunk,"enable_parent_child");if(chunk.has("parent_chunk_size"))count(chunk,"parent_chunk_size",64,64000);
        check(chunk.path("parser_engine_rules").isArray()&&chunk.path("parser_engine_rules").size()<=50,"请配置解析引擎路由");Set<String> fileTypes=new HashSet<>();
        for(JsonNode rule:chunk.path("parser_engine_rules")){
            fields(rule,"engine","file_types","xlsx_first_row_as_header");word(rule,"engine",100,true);
            check(rule.path("file_types").isArray()&&rule.path("file_types").size()>0,"解析规则需要文件类型");
            for(JsonNode ft:rule.path("file_types"))check(ft.isTextual()&&ft.asText().matches("[a-z0-9]{1,16}")&&fileTypes.add(ft.asText()),"文件类型无效或重复");
            if(rule.has("xlsx_first_row_as_header"))flag(rule,"xlsx_first_row_as_header");
        }
        word(n,"storage_backend_id",200,false);String vector=word(n,"vector_store_id",200,false);check(!vector.startsWith("__env_"),"空间默认向量存储无需填写资源 ID");
        return ((ObjectNode)n).deepCopy();
    }
    static ObjectNode business(JsonNode n){
        fields(n,"name","description","wiki_config","vlm_config","extract_config");
        word(n,"name",200,true);word(n,"description",4000,true);
        JsonNode wiki=n.path("wiki_config");fields(wiki,"content_instructions","extraction_instructions");word(wiki,"content_instructions",4000,true);word(wiki,"extraction_instructions",4000,true);
        fields(n.path("vlm_config"),"custom_instructions");word(n.path("vlm_config"),"custom_instructions",4000,true);
        JsonNode graph=n.path("extract_config");fields(graph,"custom_instructions","text","tags","nodes","relations");word(graph,"custom_instructions",4000,true);word(graph,"text",5000,true);
        for(String key:Arrays.asList("tags","nodes","relations"))check(graph.path(key).isArray()&&graph.path(key).size()>0&&graph.path(key).size()<=100,"图谱配置缺少有效 "+key);
        Set<String> tags=new HashSet<>(),nodes=new HashSet<>(),relations=new HashSet<>();
        for(JsonNode tag:graph.path("tags"))check(tag.isTextual()&&!tag.asText().trim().isEmpty()&&tag.asText().length()<=100&&tags.add(tag.asText()),"关系类型无效或重复");
        for(JsonNode node:graph.path("nodes")){
            fields(node,"name","attributes");String name=word(node,"name",200,true);check(nodes.add(name),"示例实体必须唯一");
            check(node.path("attributes").isArray()&&node.path("attributes").size()<=50,"实体属性无效");for(JsonNode a:node.path("attributes"))check(a.isTextual()&&!a.asText().trim().isEmpty()&&a.asText().length()<=1000,"实体属性无效");
        }
        for(JsonNode r:graph.path("relations")){
            fields(r,"node1","node2","type");String a=word(r,"node1",200,true),b=word(r,"node2",200,true),t=word(r,"type",100,true);
            check(nodes.contains(a)&&nodes.contains(b)&&tags.contains(t)&&relations.add(a+"\n"+b+"\n"+t),"图谱示例存在无效或重复关系");
        }
        ObjectNode result=((ObjectNode)n).deepCopy();String example=graph.path("text").asText();
        if(!example.contains("不作为真实知识入库"))example="虚构配置示例（不作为真实知识入库）：\n"+example;
        check(example.length()<=5000,"图谱示例文本超出长度限制");((ObjectNode)result.get("extract_config")).put("text",example);return result;
    }
    static ObjectNode assemble(JsonNode config,JsonNode generated,String suppliedName){
        ObjectNode result=technical(config);result.remove("generation_model_id");ObjectNode b=business(generated);
        result.put("type","document");result.put("name",suppliedName.isEmpty()?b.path("name").asText():suppliedName);result.set("description",b.get("description"));
        ((ObjectNode)result.get("wiki_config")).setAll((ObjectNode)b.get("wiki_config"));((ObjectNode)result.get("vlm_config")).setAll((ObjectNode)b.get("vlm_config"));
        ObjectNode graph=((ObjectNode)b.get("extract_config")).deepCopy();graph.put("enabled",result.path("indexing_strategy").path("graph_enabled").asBoolean());result.set("extract_config",graph);
        for(String k:Arrays.asList("storage_backend_id","vector_store_id"))if(result.path(k).asText().isEmpty())result.remove(k);
        return result;
    }
    static void safeCreate(JsonNode n){
        if(n.has("vlm_config"))fields(n.get("vlm_config"),"enabled","model_id","description_language","custom_instructions");
        if(n.has("asr_config"))fields(n.get("asr_config"),"enabled","model_id","language");
        if(n.has("storage_provider_config"))fields(n.get("storage_provider_config"),"provider");
    }
}
