package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Service;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeCreationConfig.*;

@Service
public class KnowledgeCreationRemote {
    private final KnowledgeRestClient client;private final KnowledgeService knowledge;private final ObjectMapper json;
    public KnowledgeCreationRemote(KnowledgeRestClient client,KnowledgeService knowledge,ObjectMapper json){this.client=client;this.knowledge=knowledge;this.json=json;}
    static JsonNode data(JsonNode n){return n.has("data")?n.path("data"):n;}
    public JsonNode call(Map<String,Object> c,String method,String path,JsonNode body){return data(client.execute(string(c,"endpoint"),knowledge.headers(c),s->s.request(method,path,body)));}
    private JsonNode rows(Map<String,Object> c,String path){JsonNode n=call(c,"GET",path,null);check(n.isArray(),"远端资源目录格式无效");return n;}
    public ObjectNode resources(Map<String,Object> c){
        ObjectNode out=json.createObjectNode();
        for(String kind:Arrays.asList("models","storage","vectors","parsers")){
            String path="models".equals(kind)?"/models":"storage".equals(kind)?"/storage-backends":"vectors".equals(kind)?"/vector-stores":"/system/parser-engines";
            ArrayNode list=out.putArray(kind);
            for(JsonNode row:rows(c,path)){
                if("vectors".equals(kind)&&("env".equals(row.path("source").asText())||row.path("id").asText().startsWith("__env_")))continue;
                ObjectNode item=list.addObject();
                String name=row.path("display_name").asText();if(name.trim().isEmpty())name=row.path("name").asText(row.path("Name").asText());
                item.put("id",row.path("id").asText(row.path("Name").asText(name)));item.put("name",name.isEmpty()?item.path("id").asText():name);
                item.put("type",row.path("type").asText(row.path("engine_type").asText(row.path("provider").asText())));
                boolean image=false;for(JsonNode input:row.path("capabilities").path("input"))if("image".equals(input.asText()))image=true;
                item.put("supportsImage",image||row.path("parameters").path("supports_vision").asBoolean()||"VLLM".equals(row.path("type").asText()));
                item.put("available",row.path("available").asBoolean(row.path("Available").asBoolean(true))&&!Arrays.asList("downloading","download_failed","disabled").contains(row.path("status").asText()));
                if("parsers".equals(kind))item.set("fileTypes",row.has("FileTypes")?row.path("FileTypes"):row.path("file_types"));
            }
        }
        JsonNode system=call(c,"GET","/system/info",null);
        JsonNode generation=call(c,"GET","/initialization/generate/knowledge-base-config",null);
        out.put("graphEnabled",availableEngine(system.path("graph_database_engine").asText())&&generation.path("graph_available").asBoolean());
        out.put("graphAPOCMissing","apoc_unavailable".equals(generation.path("graph_error").asText()));
        out.put("vectorEnabled",availableEngine(system.path("vector_store_engine").asText()));
        out.put("keywordEnabled",availableEngine(system.path("keyword_index_engine").asText()));
        out.put("generationSupported",generation.path("schema_version").asInt()==1&&generation.path("accepts_create_id").asBoolean());
        return out;
    }
    private boolean availableEngine(String s){return !s.trim().isEmpty()&&!s.toLowerCase(Locale.ROOT).contains("not enabled")&&!s.equalsIgnoreCase("none")&&!s.contains("未配置")&&!s.contains("未启用");}
    private JsonNode selected(JsonNode rows,String id,String label){for(JsonNode r:rows)if(id.equals(r.path("id").asText())){check(r.path("available").asBoolean(),label+"当前不可用");return r;}throw new cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException(422,label+"不存在，请重新选择");}
    private void model(JsonNode r,String id,String type,String label){check(selected(r.path("models"),id,label).path("type").asText().equalsIgnoreCase(type),label+"类型不匹配");}
    public void validate(Map<String,Object> c,JsonNode config){
        technical(config);ObjectNode r=resources(c);check(r.path("generationSupported").asBoolean(),"远端尚未部署 AI 建库接口");
        model(r,config.path("generation_model_id").asText(),"KnowledgeQA","配置生成模型");model(r,config.path("embedding_model_id").asText(),"Embedding","Embedding 模型");model(r,config.path("summary_model_id").asText(),"KnowledgeQA","摘要模型");
        JsonNode idx=config.path("indexing_strategy");
        if(idx.path("wiki_enabled").asBoolean())model(r,config.path("wiki_config").path("synthesis_model_id").asText(),"KnowledgeQA","Wiki 模型");
        if(config.path("vlm_config").path("enabled").asBoolean())model(r,config.path("vlm_config").path("model_id").asText(),"VLLM","视觉模型");
        if(config.path("asr_config").path("enabled").asBoolean())model(r,config.path("asr_config").path("model_id").asText(),"ASR","语音模型");
        check(!idx.path("graph_enabled").asBoolean()||r.path("graphEnabled").asBoolean(),r.path("graphAPOCMissing").asBoolean()?"远端知识图谱服务缺少必需的 APOC 扩展，请管理员安装并启用":"远端知识图谱服务（Neo4j）未启用或连接失败");
        check(!idx.path("keyword_enabled").asBoolean()||r.path("keywordEnabled").asBoolean(),"远端未启用关键词索引");
        String vector=config.path("vector_store_id").asText(),storage=config.path("storage_backend_id").asText();
        if(!vector.isEmpty())selected(r.path("vectors"),vector,"向量存储");else check(!idx.path("vector_enabled").asBoolean()||r.path("vectorEnabled").asBoolean(),"空间默认向量存储不可用");
        if(!storage.isEmpty())selected(r.path("storage"),storage,"文件存储");
        for(JsonNode rule:config.path("chunking_config").path("parser_engine_rules")){
            JsonNode parser=selected(r.path("parsers"),rule.path("engine").asText(),"解析引擎 "+rule.path("engine").asText());
            for(JsonNode ft:rule.path("file_types")){boolean found=false;for(JsonNode t:parser.path("fileTypes"))if(t.asText().equals(ft.asText()))found=true;check(found,"解析引擎不支持文件类型 "+ft.asText());}
        }
        if(config.path("image_processing_config").path("image_vector_enabled").asBoolean()){
            JsonNode embed=call(c,"GET","/models/"+KnowledgeRestClient.segment(config.path("embedding_model_id").asText()),null);
            boolean acceptsImage=false;for(JsonNode input:embed.path("capabilities").path("input"))if("image".equals(input.asText()))acceptsImage=true;
            check(acceptsImage,"Embedding 模型尚未声明图片输入能力，请关闭图片向量检索");
        }
    }
    public JsonNode generate(Map<String,Object> c,JsonNode input,JsonNode config){ObjectNode request=json.createObjectNode();request.put("model_id",config.path("generation_model_id").asText());request.put("name",input.path("name").asText());request.put("description",input.path("description").asText());request.put("language","zh-CN");return data(client.generateConfiguration(string(c,"endpoint"),knowledge.headers(c),request));}
    public JsonNode create(Map<String,Object> c,JsonNode payload){safeCreate(payload);return call(c,"POST","/knowledge-bases",payload);}
    public JsonNode read(Map<String,Object> c,String id){return call(c,"GET","/knowledge-bases/"+KnowledgeRestClient.segment(id),null);}
    public void verify(JsonNode actual,JsonNode expected){
        for(String key:Arrays.asList("id","type","name","description","embedding_model_id","summary_model_id","indexing_strategy","wiki_config","vlm_config","extract_config","image_processing_config","chunking_config","asr_config","storage_backend_id","vector_store_id"))if(expected.has(key))subset(actual.path(key),expected.path(key),key);
    }
    private void subset(JsonNode actual,JsonNode expected,String path){
        if(actual.isMissingNode()||actual.isNull()){
            if(expected.isBoolean()&&!expected.asBoolean()||expected.isTextual()&&expected.asText().isEmpty()||expected.isArray()&&expected.size()==0)return;
        }
        if(expected.isObject())expected.fields().forEachRemaining(e->subset(actual.path(e.getKey()),e.getValue(),path+"."+e.getKey()));
        else if(expected.isArray()){check(actual.isArray()&&actual.size()==expected.size(),"远端保存配置与模板不一致："+path);for(int i=0;i<expected.size();i++)subset(actual.path(i),expected.path(i),path+"["+i+"]");}
        else check(actual.equals(expected),"远端保存配置与模板不一致："+path);
    }
}
