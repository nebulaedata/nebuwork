package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Component;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeRestClient.segment;

@Component
public class NebulaeV100RestDriver implements KnowledgeDriver {
    final KnowledgeRestClient client;final ObjectMapper json;
    public NebulaeV100RestDriver(KnowledgeRestClient client,ObjectMapper json){this.client=client;this.json=json;}
    public String id(){return "nebulae-v100-rest";}
    public Map<String,Object> descriptor(){return map("id",id(),"name","Nebulae V100","transport","rest","knowledgeBaseTypes",Arrays.asList("document","faq","wiki"),"capabilities",Arrays.asList("collections","documents","document","search","manage","create","faq","wiki","upload","capabilities","chunk","graph","gallery","preview"));}
    static JsonNode data(JsonNode n){return n.has("data")?n.get("data"):n;}
    static int integer(JsonNode n,String key,int fallback,int max){if(!n.has(key))return fallback;JsonNode v=n.get(key);if(!v.isIntegralNumber()||!v.canConvertToInt()||v.asInt()<1||v.asInt()>max)throw new ApiException(422,key+" 超出范围");return v.asInt();}
    static String paging(JsonNode n){return "page="+integer(n,"page",1,1000000)+"&page_size="+integer(n,"pageSize",20,100);}
    static String query(JsonNode n,String... names){StringBuilder s=new StringBuilder(paging(n));for(String key:names)if(n.hasNonNull(key)&&!n.path(key).asText().isEmpty())s.append('&').append(key).append('=').append(segment(n.path(key).asText()));return s.toString();}
    static String kb(String id){return "/knowledge-bases/"+segment(id);}
    static String wiki(String id){return "/knowledgebase/"+segment(id)+"/wiki";}
    static JsonNode array(JsonNode n,String... keys){if(n.isArray())return n;if(n.path("data").isArray())return n.path("data");for(String key:keys)if(n.path(key).isArray())return n.path(key);throw new ApiException(502,"知识库列表格式无效");}
    public static void scrub(JsonNode n){
        if(n.isObject()){List<String> remove=new ArrayList<>();n.fieldNames().forEachRemaining(k->{String x=k.toLowerCase(Locale.ROOT);if(x.contains("password")||x.contains("secret")||x.contains("api_key")||x.equals("apikey")||x.contains("credential")||x.equals("token")||x.equals("base_url")||x.equals("baseurl")||x.equals("storage_config")||x.contains("access_key")||x.equals("authorization")||x.equals("tenant_id")||x.equals("tenantid")||x.equals("file_url")||x.equals("download_url")||x.equals("signed_url")||x.equals("file_path"))remove.add(k);});remove.forEach(((ObjectNode)n)::remove);}
        if(n.isContainerNode())n.forEach(NebulaeV100RestDriver::scrub);
    }
    public JsonNode execute(String endpoint,Map<String,String> headers,String operation,String collectionId,JsonNode input){return client.execute(endpoint,headers,s->{JsonNode out=read(s,operation,collectionId,input);scrub(out);return out;});}
    JsonNode detail(KnowledgeRestClient.Session s,String collection){JsonNode d=data(s.request("GET",kb(collection),null));if(!collection.equals(d.path("id").asText()))throw new ApiException(502,"知识库返回了错误的资源");return d;}
    JsonNode document(KnowledgeRestClient.Session s,String collection,String id){JsonNode d=data(s.request("GET","/knowledge/"+segment(id),null));if(!collection.equals(d.path("knowledge_base_id").asText())||!id.equals(d.path("id").asText()))throw new ApiException(404,"文档不属于当前知识库");return d;}
    private JsonNode read(KnowledgeRestClient.Session s,String operation,String collection,JsonNode input){
        if("collections".equals(operation)){
            ArrayNode out=json.createArrayNode();Set<String> seen=new HashSet<>();
            for(int page=1;page<=100;page++){
                JsonNode response=s.request("GET","/knowledge-bases?page="+page+"&page_size=100",null),rows=array(data(response),"items","knowledge_bases");
                for(JsonNode r:rows){String id=text(r,"id",8192,true);if(!seen.add(id))throw new ApiException(502,"知识库目录分页重复");JsonNode count=r.get("knowledge_count");
                    ObjectNode c=json.valueToTree(map("id",id,"name",r.path("name").asText(id),"description",r.path("description").asText(),"type",r.path("type").asText("document"),"indexingStatus","unknown","capabilities",r.path("capabilities"),"documentCount",count!=null&&count.isIntegralNumber()&&count.asLong()>=0?count:null,"documentCountSource",count!=null&&count.isIntegralNumber()?"reported":null));out.add(c);}
                if(!response.has("total")||out.size()>=response.path("total").asLong())return json.valueToTree(map("collections",out,"tools",Collections.emptyList()));
                if(rows.isEmpty())throw new ApiException(502,"知识库目录分页不完整");
            }throw new ApiException(502,"知识库目录超过分页限制");
        }
        JsonNode library=detail(s,collection);
        if("library".equals(operation))return json.valueToTree(map("id",collection,"name",library.path("name").asText(collection),"description",library.path("description").asText(),"type",library.path("type").asText("document"),"documentCount",library.get("knowledge_count"),"indexingStatus","unknown"));
        if("document".equals(operation)&&!input.path("chunkId").asText().isEmpty())return new KnowledgeViews(this,json).read(s,"chunk",collection,input,library);
        if(KnowledgeViews.OPERATIONS.contains(operation))return new KnowledgeViews(this,json).read(s,operation,collection,input,library);
        String kind=input.path("contentKind").asText(library.path("type").asText("document"));
        if(!Arrays.asList("document","faq","wiki").contains(kind))throw new ApiException(422,"内容类型无效");
        if("documents".equals(operation)){
            if(input.hasNonNull("query")&&!input.has("keyword")){input=input.deepCopy();((ObjectNode)input).set("keyword",input.get("query"));}
            JsonNode raw=s.request("GET","wiki".equals(kind)?wiki(collection)+"/pages?"+query(input,"folder_id"):"faq".equals(kind)?kb(collection)+"/faq/entries?"+paging(input):kb(collection)+"/knowledge?"+query(input,"keyword"),null),d=data(raw);
            ArrayNode items=json.createArrayNode();for(JsonNode r:array(d,"pages","entries","items")){
                String id="wiki".equals(kind)?r.path("slug").asText():r.path("id").asText();
                ObjectNode item=json.valueToTree(map("id",id,"title",r.path("title").asText(r.path("standard_question").asText(r.path("file_name").asText(id))),"contentKind",kind,"parseStatus",r.path("parse_status").asText(),"folderPath",r.path("folder_path").asText(),"fileName",r.path("file_name").asText()));new KnowledgeViews(this,json).readerMetadata(item,r);items.add(item);
            }
            return pageResult("documents",items,raw,d,input);
        }
        if("document".equals(operation)){
            String id=text(input,"documentId",8192,true);JsonNode d;String content;JsonNode page=null;
            if("wiki".equals(kind)){d=data(s.request("GET",wiki(collection)+"/pages/"+KnowledgeRestClient.slug(id),null));content=d.path("content").asText();}
            else if("faq".equals(kind)){d=data(s.request("GET",kb(collection)+"/faq/entries/"+segment(id),null));content=d.path("standard_question").asText()+"\n"+join(d.path("answers"));}
            else{d=document(s,collection,id);if("manual".equals(d.path("type").asText())&&d.path("metadata").has("content"))content=d.path("metadata").path("content").asText();else{page=s.request("GET","/chunks/"+segment(id)+"?"+paging(input),null);StringBuilder b=new StringBuilder();for(JsonNode chunk:array(data(page),"items"))if(!input.path("requireEnabled").asBoolean()||!chunk.has("is_enabled")||chunk.path("is_enabled").asBoolean())b.append(chunk.path("content").asText()).append("\n\n");content=b.toString();}}
            ObjectNode result=json.valueToTree(map("document",map("id",id,"collectionId",collection,"title",d.path("title").asText(d.path("standard_question").asText(id)),"extractedText",content,"contentKind",kind,"folderPath",d.path("folder_path").asText(),"fileName",d.path("file_name").asText(),"fileType",d.path("file_type").asText(),"sourceHash",KnowledgeViews.sourceHash(d),"version",d.path("version"),"sourceRefs",d.path("source_refs"),"outLinks",d.path("out_links"),"inLinks",d.path("in_links"),"inLinkTitles",d.path("in_link_titles")),"page",integer(input,"page",1,1000000),"pageSize",integer(input,"pageSize",20,100)));
            new KnowledgeViews(this,json).readerMetadata((ObjectNode)result.path("document"),d);
            if("wiki".equals(kind))((ObjectNode)result.path("document")).set("sources",new KnowledgeViews(this,json).wikiSources(s,collection,d.path("source_refs")));
            if(page!=null){ArrayNode safe=json.createArrayNode();for(JsonNode chunk:array(data(page),"items"))if(!input.path("requireEnabled").asBoolean()||!chunk.has("is_enabled")||chunk.path("is_enabled").asBoolean())safe.add(new KnowledgeViews(this,json).safeChunk(chunk));result.set("chunks",safe);result.set("total",page.path("total"));result.put("hasMore",(long)integer(input,"page",1,1000000)*integer(input,"pageSize",20,100)<page.path("total").asLong());}return result;
        }
        if(!"search".equals(operation))throw new ApiException(422,"Nebulae V100 支持检索，不调用远端聊天生成答案");
        String q=text(input,"query",8000,true);int top=integer(input,"topK",5,20);JsonNode raw;
        if("wiki".equals(kind))raw=s.request("POST","/wiki-search",json.valueToTree(map("query",q,"knowledge_base_ids",Collections.singletonList(collection),"limit",top)));
        else if("faq".equals(kind))raw=s.request("POST",kb(collection)+"/faq/search",json.valueToTree(map("query_text",q,"match_count",top)));
        else raw=s.request("POST","/knowledge-search",json.valueToTree(map("query",q,"knowledge_base_ids",Collections.singletonList(collection),"match_count",top)));
        ArrayNode hits=json.createArrayNode();int i=0;for(JsonNode hit:array(data(raw),"results")){
            if(!collection.equals(hit.path("knowledge_base_id").asText()))throw new ApiException(502,"检索返回了范围不匹配的证据");
            String id="wiki".equals(kind)?hit.path("slug").asText():"faq".equals(kind)?hit.path("id").asText():hit.path("knowledge_id").asText();
            if(id.isEmpty())throw new ApiException(502,"检索证据缺少资源标识");
            ObjectNode h=json.valueToTree(map("text","wiki".equals(kind)?hit.path("match_snippet").asText(hit.path("summary").asText()):"faq".equals(kind)?hit.path("standard_question").asText()+"\n"+join(hit.path("answers")):hit.path("content").asText(),"citation",map("id","N"+(++i),"collectionId",collection,"documentId",id,"contentKind",kind,"chunkId",hit.path("chunk_id").asText("document".equals(kind)?hit.path("id").asText():""),"title",hit.path("knowledge_title").asText(hit.path("title").asText(hit.path("standard_question").asText(id))),"sourceLocators",hit.path("source_locators"))));
            if(hit.path("score").isNumber())h.set("score",hit.get("score"));hits.add(h);if(hits.size()>=top)break;
        }
        return json.valueToTree(map("query",q,"results",hits,"partial",false,"warnings",Collections.emptyList()));
    }
    private JsonNode pageResult(String key,JsonNode rows,JsonNode raw,JsonNode d,JsonNode input){long total=raw.path("total").asLong(d.path("total").asLong(rows.size()));return json.valueToTree(map(key,rows,"total",total,"page",integer(input,"page",1,1000000),"pageSize",integer(input,"pageSize",20,100),"hasMore",(long)integer(input,"page",1,1000000)*integer(input,"pageSize",20,100)<total));}
    static String join(JsonNode rows){StringJoiner out=new StringJoiner("\n\n");if(rows.isArray())rows.forEach(n->out.add(n.asText()));return out.toString();}
    static ObjectNode pick(JsonNode input,String... keys){fields(input,keys);return ((ObjectNode)input).deepCopy();}
    static final String[] FAQ_FIELDS={"standard_question","similar_questions","negative_questions","answers","answer_strategy","tag_id","tag_name","is_enabled","is_recommended"};
    private ObjectNode camelConfig(JsonNode source){
        ObjectNode out=json.createObjectNode();if(source.isObject())source.fields().forEachRemaining(e->{String[] words=e.getKey().split("_");StringBuilder key=new StringBuilder(words[0]);for(int i=1;i<words.length;i++)key.append(Character.toUpperCase(words[i].charAt(0))).append(words[i].substring(1));out.set(key.toString(),e.getValue());});return out;
    }
    private JsonNode resources(KnowledgeRestClient.Session s,String collection,JsonNode input){
        pick(input,"embedding_model_id","summary_model_id","storage_backend_id");JsonNode current=detail(s,collection);
        ObjectNode request=json.createObjectNode();
        request.put("llmModelId",input.path("summary_model_id").asText(current.path("summary_model_id").asText()));
        if(request.path("llmModelId").asText().isEmpty())throw new ApiException(422,"修改模型或存储前须选择摘要模型");
        request.put("embeddingModelId",input.path("embedding_model_id").asText(current.path("embedding_model_id").asText()));
        request.put("storageBackendId",input.path("storage_backend_id").asText(current.path("storage_backend_id").asText()));
        request.put("storageProvider",current.path("storage_provider_config").path("provider").asText("local"));
        request.set("documentSplitting",camelConfig(current.path("chunking_config")));
        request.set("nodeExtract",camelConfig(current.path("extract_config")));
        request.set("questionGeneration",camelConfig(current.path("question_generation_config")));
        request.set("vlm_config",current.path("vlm_config"));request.set("asr_config",current.path("asr_config"));
        request.set("multimodal",json.valueToTree(map("enabled",current.path("vlm_config").path("enabled").asBoolean())));
        return s.request("PUT","/initialization/config/"+segment(collection),request);
    }
    JsonNode manage(KnowledgeRestClient.Session s,String op,String collection,JsonNode a){
        String k=collection==null||collection.isEmpty()?"":kb(collection),w=collection==null||collection.isEmpty()?"":wiki(collection);JsonNode payload=a.path("payload");if(payload.isMissingNode())payload=json.createObjectNode();
        String resource=a.path("resourceId").asText();
        switch(op){
            case "models": case "storage": case "vectors": {
                JsonNode raw=s.request("GET","models".equals(op)?"/models":"storage".equals(op)?"/storage-backends":"/vector-stores",null);ArrayNode out=json.createArrayNode();
                for(JsonNode r:array(data(raw),"items","models","backends","stores")){
                    String id=r.path("id").asText();
                    // Virtual environment stores describe the default engines; they cannot be bound by ID.
                    if("vectors".equals(op)&&("env".equals(r.path("source").asText())||id.startsWith("__env_")))continue;
                    String name=r.path("display_name").asText().trim();if(name.isEmpty())name=r.path("name").asText().trim();if(name.isEmpty())name=id;
                    String type=r.path("type").asText();if(type.isEmpty())type=r.path("vectors".equals(op)?"engine_type":"provider").asText();
                    out.add(json.valueToTree(map("id",id,"name",name,"type",type)));
                }return out;
            }
            case "kb.create": {
                KnowledgeCreationConfig.safeCreate(payload);
                ObjectNode request=(ObjectNode)pick(payload,"name","description","type","embedding_model_id","summary_model_id","chunking_config","indexing_strategy","faq_config","wiki_config","vector_store_id","storage_backend_id","storage_provider_config","extract_config","vlm_config","asr_config","image_processing_config");
                // Accept cached forms from before virtual stores were excluded from the selector.
                String store=request.path("vector_store_id").asText().trim();
                if(store.isEmpty()||store.startsWith("__env_"))request.remove("vector_store_id");
                return s.request("POST","/knowledge-bases",request);
            }
            case "kb.get":return detail(s,collection);
            case "kb.resources":return resources(s,collection,payload);
            case "kb.update":return s.request("PUT",k,pick(payload,"name","description","config"));
            case "kb.delete":return s.request("DELETE",k,null);
            case "documents.list":return s.request("GET",k+"/knowledge?"+query(a,"keyword","parse_status","source"),null);
            case "document.manual":return s.request("POST",k+"/knowledge/manual",pick(payload,"title","content","status","tag_ids","process_config"));
            case "document.url":return s.request("POST",k+"/knowledge/url",pick(payload,"url","title"));
            case "document.get":return document(s,collection,resource);
            case "document.update":document(s,collection,resource);return s.request("PUT","/knowledge/manual/"+segment(resource),pick(payload,"title","content","status"));
            case "document.delete":document(s,collection,resource);return s.request("DELETE","/knowledge/"+segment(resource),null);
            case "document.reparse":case "document.cancel":case "document.stages": {
                document(s,collection,resource);String suffix=op.endsWith("reparse")?"reparse":op.endsWith("cancel")?"cancel-parse":"stages";
                return s.request(op.endsWith("stages")?"GET":"POST","/knowledge/"+segment(resource)+"/"+suffix,null);
            }
            case "faq.list":return s.request("GET",k+"/faq/entries?"+query(a,"keyword","search_field","is_enabled","tag_id","sort_order"),null);
            case "faq.get":return s.request("GET",k+"/faq/entries/"+segment(resource),null);
            case "faq.create":return s.request("POST",k+"/faq/entry",pick(payload,FAQ_FIELDS));
            case "faq.update":return s.request("PUT",k+"/faq/entries/"+segment(resource),pick(payload,FAQ_FIELDS));
            case "faq.delete":return s.request("DELETE",k+"/faq/entries",pick(payload,"ids"));
            case "faq.fields":return s.request("PUT",k+"/faq/entries/fields",pick(payload,"by_id","by_tag","exclude_ids"));
            case "faq.tags":return s.request("PUT",k+"/faq/entries/tags",pick(payload,"updates"));
            case "faq.import":{
                ObjectNode p=pick(payload,"entries","mode","dry_run");if(!p.path("entries").isArray()||p.path("entries").size()>10000)throw new ApiException(422,"FAQ 导入需要不超过 10000 条的数组");
                for(JsonNode entry:p.path("entries"))pick(entry,FAQ_FIELDS);return s.request("POST",k+"/faq/entries",p);
            }
            case "tags.list":return s.request("GET",k+"/tags?"+paging(a),null);
            case "tags.create":return s.request("POST",k+"/tags",pick(payload,"name","color"));
            case "tags.update":return s.request("PUT",k+"/tags/"+segment(resource),pick(payload,"name","color"));
            case "tags.delete":return s.request("DELETE",k+"/tags/"+segment(resource),null);
            case "wiki.pages":return s.request("GET",w+"/pages?"+query(a,"query","folder_id","page_type","status"),null);
            case "wiki.get":return s.request("GET",w+"/pages/"+KnowledgeRestClient.slug(resource),null);
            case "wiki.create":return s.request("POST",w+"/pages",pick(payload,"slug","title","content","folder_id","page_type"));
            case "wiki.update":return s.request("PUT",w+"/pages/"+KnowledgeRestClient.slug(resource),pick(payload,"title","content","page_type","version"));
            case "wiki.delete":return s.request("DELETE",w+"/pages/"+KnowledgeRestClient.slug(resource),null);
            case "wiki.move":return s.request("PUT",w+"/move-page",pick(payload,"slug","folder_id"));
            case "wiki.folders":return s.request("GET",w+"/folders?"+query(a,"parent_id"),null);
            case "wiki.folder.create":return s.request("POST",w+"/folders",pick(payload,"name","parent_id"));
            case "wiki.folder.update":return s.request("PUT",w+"/folders/"+segment(resource),pick(payload,"name","parent_id","move_parent"));
            case "wiki.folder.delete":return s.request("DELETE",w+"/folders/"+segment(resource),null);
            case "wiki.revisions":return s.request("GET",w+"/revisions/"+KnowledgeRestClient.slug(resource)+"?limit=50&offset="+((long)(integer(a,"page",1,1000000)-1)*50)+(a.has("version")?"&version="+integer(a,"version",1,Integer.MAX_VALUE):""),null);
            case "wiki.revert":return s.request("POST",w+"/revert",pick(payload,"slug","version"));
            case "wiki.index":return s.request("GET",w+"/index?limit=50"+(a.hasNonNull("cursor")&&!a.path("cursor").asText().isEmpty()?"&cursor="+segment(a.path("cursor").asText()):""),null);
            case "wiki.stats":case "wiki.lint":case "wiki.issues":return s.request("GET",w+"/"+op.substring(5),null);
            case "wiki.graph":return s.request("GET",w+"/graph?mode=overview&limit=500",null);
            case "wiki.links":return s.request("POST",w+"/rebuild-links",null);
            case "wiki.fix":return s.request("POST",w+"/auto-fix",null);
            case "wiki.issue":return s.request("PUT",w+"/issues/"+segment(resource)+"/status",pick(payload,"status"));
            default:throw new ApiException(422,"不支持的知识库管理操作");
        }
    }
}
