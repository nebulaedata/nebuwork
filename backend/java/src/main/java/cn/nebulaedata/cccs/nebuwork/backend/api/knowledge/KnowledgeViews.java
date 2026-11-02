package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.NebulaeV100RestDriver.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeRestClient.segment;

/** Read-only content projections shared by browsers and the engine. No arbitrary proxy. */
final class KnowledgeViews {
    static final Set<String> OPERATIONS=new HashSet<>(Arrays.asList("capabilities","chunk","graph","gallery","wiki.folders","wiki.graph","wiki.stats"));
    private final NebulaeV100RestDriver driver;private final ObjectMapper json;
    KnowledgeViews(NebulaeV100RestDriver driver,ObjectMapper json){this.driver=driver;this.json=json;}
    JsonNode read(KnowledgeRestClient.Session s,String operation,String collection,JsonNode input,JsonNode library){
        if("capabilities".equals(operation)){
            JsonNode index=library.path("indexing_strategy");String type=library.path("type").asText("document");
            return json.valueToTree(map("type",type,"capabilities",map("document",cap(true,!"faq".equals(type)),"search",cap(true,index.path("vector_enabled").asBoolean()||index.path("keyword_enabled").asBoolean()||"faq".equals(type)),"wiki",cap(true,"wiki".equals(type)||index.path("wiki_enabled").asBoolean()),"graph",cap(true,index.path("graph_enabled").asBoolean()),"gallery",cap(true,library.path("vlm_config").path("enabled").asBoolean()),"preview",cap(true,true))));
        }
        if("chunk".equals(operation)){
            String id=text(input,"chunkId",512,true);JsonNode chunk=chunk(s,collection,id);String doc=chunk.path("knowledge_id").asText();if(input.path("requireEnabled").asBoolean()&&chunk.has("is_enabled")&&!chunk.path("is_enabled").asBoolean())throw new ApiException(404,"分块已停用");
            if(input.hasNonNull("documentId")&&!doc.equals(input.path("documentId").asText()))throw new ApiException(404,"分块不属于当前文档");
            JsonNode document=driver.document(s,collection,doc);ObjectNode result=json.createObjectNode();result.set("chunk",safeChunk(chunk));result.set("citation",citation(collection,doc,chunk.path("id").asText(),document.path("title").asText(doc),"document",chunk.path("source_locators")));
            ((ObjectNode)result.path("citation")).put("sourceHash",sourceHash(document));((ObjectNode)result.path("citation")).set("version",document.path("version"));
            ArrayNode context=result.putArray("chunks");
            String parent=chunk.path("parent_chunk_id").asText();
            if(!parent.isEmpty()){JsonNode p=chunk(s,collection,parent);if(!doc.equals(p.path("knowledge_id").asText()))throw new ApiException(502,"来源分块不属于当前文档");if(!input.path("requireEnabled").asBoolean()||!p.has("is_enabled")||p.path("is_enabled").asBoolean())context.add(safeChunk(p));if(!chunk.path("source_locators").isArray()||chunk.path("source_locators").size()==0)((ObjectNode)result.path("citation")).set("sourceLocators",p.path("source_locators"));}
            context.add(safeChunk(chunk));
            for(String key:Arrays.asList("pre_chunk_id","next_chunk_id")){String neighbor=chunk.path(key).asText();if(!neighbor.isEmpty()){JsonNode n=chunk(s,collection,neighbor);if(doc.equals(n.path("knowledge_id").asText())&&(!input.path("requireEnabled").asBoolean()||!n.has("is_enabled")||n.path("is_enabled").asBoolean()))context.add(safeChunk(n));}}
            try{JsonNode images=chunk.path("image_info").isTextual()?json.readTree(chunk.path("image_info").asText()):chunk.path("image_info");if(images!=null&&images.isArray()&&images.size()==1)result.put("imageDigest",images.get(0).path("sha256").asText());}catch(Exception ignored){}
            result.set("document",json.valueToTree(map("id",doc,"title",document.path("title").asText(doc),"fileName",document.path("file_name").asText(),"fileType",document.path("file_type").asText(),"sourceHash",sourceHash(document),"contentKind","document","folderPath",document.path("folder_path").asText())));readerMetadata((ObjectNode)result.path("document"),document);return result;
        }
        if("graph".equals(operation)){
            ObjectNode request=json.createObjectNode();request.put("mode",input.path("mode").asText(input.path("query").asText().isEmpty()?"overview":"query"));request.put("query",text(input,"query",8000,false));request.put("node_id",text(input,"nodeId",512,false));request.put("limit",integer(input,"limit",50,200));
            JsonNode raw=data(s.request("POST",kb(collection)+"/graph/query",request));if(!raw.path("nodes").isArray()||!raw.path("edges").isArray()||!raw.path("sources").isArray())throw new ApiException(502,"图谱响应格式无效");ObjectNode result=json.createObjectNode();result.set("nodes",raw.path("nodes"));result.set("edges",raw.path("edges"));result.put("truncated",raw.path("truncated").asBoolean());ArrayNode sources=result.putArray("sources");
            for(JsonNode source:raw.path("sources")){if(!collection.equals(source.path("knowledge_base_id").asText()))throw new ApiException(502,"图谱返回了跨库来源");String doc=text(source,"knowledge_id",512,true),chunk=text(source,"chunk_id",512,true);sources.add(json.valueToTree(map("text",source.path("content").asText(),"citation",citation(collection,doc,chunk,source.path("title").asText(doc),"document",source.path("source_locators")),"sourceKind","graph")));}return result;
        }
        if("gallery".equals(operation)){
            JsonNode config=data(s.request("GET",kb(collection)+"/gallery-config",null));ObjectNode result=json.createObjectNode();result.set("config",config);
            if("config".equals(input.path("mode").asText()))return result;
            ObjectNode request=json.createObjectNode();request.put("keyword",text(input,"query",8000,false));request.put("page",integer(input,"page",1,1000000));request.put("page_size",integer(input,"pageSize",20,100));
            for(String[] pair:new String[][]{{"searchIn","search_in"},{"sortBy","sort_by"},{"sortOrder","sort_order"},{"isEnabled","is_enabled"},{"documentIds","knowledge_ids"},{"attrFilters","attr_filters"},{"attrRules","attr_rules"}})if(input.has(pair[0]))request.set(pair[1],input.get(pair[0]));
            JsonNode raw=s.request("POST",kb(collection)+"/images",request);ArrayNode items=result.putArray("items");
            for(JsonNode image:array(data(raw),"items")){String doc=text(image,"knowledge_id",512,true),chunk=text(image,"chunk_id",512,true),id=text(image,"id",1024,true);if(!id.startsWith(chunk+"#"))throw new ApiException(502,"画廊资源标识无效");
                items.add(json.valueToTree(map("id",id,"documentId",doc,"chunkId",chunk,"title",image.path("source_name").asText(doc),"caption",image.path("caption").asText(),"ocrText",image.path("ocr_text").asText(),"attributes",image.path("attrs"),"enabled",image.path("is_enabled").asBoolean(),"citation",citation(collection,doc,chunk,image.path("source_name").asText(doc),"document",json.createArrayNode()),"sourceKind","image")));
            }result.put("total",raw.path("total").asLong());result.put("page",request.path("page").asInt());result.put("hasMore",(long)request.path("page").asInt()*request.path("page_size").asInt()<raw.path("total").asLong());return result;
        }
        String path=wiki(collection);if("wiki.folders".equals(operation))path+="/folders?"+query(input,"parent_id");else if("wiki.graph".equals(operation))path+="/graph?mode=overview&limit=500";else if("wiki.stats".equals(operation))path+="/stats";else throw new ApiException(422,"不支持的只读操作");return data(s.request("GET",path,null));
    }
    JsonNode wikiSources(KnowledgeRestClient.Session s,String collection,JsonNode references){
        ArrayNode out=json.createArrayNode();int count=0;
        for(JsonNode ref:references){if(count++>=50)break;String[] parts=ref.asText().split("\\|",2);String id=parts[0].trim();if(id.isEmpty())continue;
            String title=parts.length>1?parts[1].trim():"来源文档";boolean available=true;
            try{JsonNode doc=driver.document(s,collection,id);title=doc.path("title").asText(doc.path("file_name").asText(title));}catch(ApiException error){if(error.status==404)available=false;else throw error;}
            out.add(json.valueToTree(map("documentId",id,"title",title,"available",available)));
        }return out;
    }
    private Map<String,Object> cap(boolean supported,boolean enabled){return map("supported",supported,"enabled",enabled,"available","unknown");}
    JsonNode chunk(KnowledgeRestClient.Session s,String collection,String id){JsonNode c=data(s.request("GET","/chunks/by-id/"+segment(id),null));if(!id.equals(c.path("id").asText())||!collection.equals(c.path("knowledge_base_id").asText()))throw new ApiException(404,"分块不属于当前知识库");return c;}
    JsonNode safeChunk(JsonNode c){ObjectNode n=json.createObjectNode();for(String key:Arrays.asList("id","content","chunk_index","chunk_type","parent_chunk_id","source_locators","content_revision"))if(c.has(key))n.set(key,c.get(key));return n;}
    ObjectNode citation(String collection,String doc,String chunk,String title,String kind,JsonNode locators){return json.valueToTree(map("collectionId",collection,"documentId",doc,"chunkId",chunk,"title",title,"contentKind",kind,"sourceLocators",locators.isArray()?locators:json.createArrayNode()));}
    static String sourceHash(JsonNode document){return document.path("file_hash").asText(document.path("metadata").path("source_hash").asText(document.path("source_hash").asText()));}
    // Project business display fields only. Internal parser/storage metadata stays server-side.
    void readerMetadata(ObjectNode target,JsonNode document){
        for(String[] pair:new String[][]{{"summary","summary"},{"page_type","pageType"},{"aliases","aliases"},{"created_at","createdAt"},{"updated_at","updatedAt"},{"file_size","fileSize"},{"parse_status","parseStatus"},{"folder_id","folderId"}})if(document.hasNonNull(pair[0]))target.set(pair[1],document.get(pair[0]));
        if(!target.hasNonNull("summary")&&document.hasNonNull("description"))target.set("summary",document.get("description"));
        JsonNode custom=document.path("custom_metadata");
        if(custom.isTextual())try{custom=json.readTree(custom.asText());}catch(Exception ignored){custom=json.createObjectNode();}
        if(custom.isObject()){custom=custom.deepCopy();NebulaeV100RestDriver.scrub(custom);target.set("customMetadata",custom);}
    }
}
