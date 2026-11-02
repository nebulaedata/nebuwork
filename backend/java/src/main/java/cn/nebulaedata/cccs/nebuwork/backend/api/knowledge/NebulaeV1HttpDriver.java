package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Component;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;

@Component
public class NebulaeV1HttpDriver implements KnowledgeDriver {
    static final List<String> TOOLS=Arrays.asList("common_knowledge_list","common_knowledge_list_documents","common_knowledge_search","common_knowledge_answer","common_knowledge_get_document");
    private final KnowledgeMcpClient client;private final ObjectMapper json;
    public NebulaeV1HttpDriver(KnowledgeMcpClient client,ObjectMapper json){this.client=client;this.json=json;}
    @Override public String id(){return "nebulae-v1-http";}
    @Override public Map<String,Object> descriptor(){return map("id",id(),"name","Nebulae V1 HTTP","transport","streamable_http","capabilities",Arrays.asList("collections","documents","search","answer","document"));}
    @Override public JsonNode execute(String endpoint,Map<String,String> headers,String operation,String collectionId,JsonNode input){
        return client.execute(endpoint,headers,session->{
            Set<String> discovered=new HashSet<>();for(JsonNode tool:session.tools())discovered.add(tool.path("name").asText());
            if(!discovered.containsAll(TOOLS))throw new ApiException(422,"该 MCP 缺少 Nebulae V1 所需的五个只读知识库工具");
            JsonNode listed=session.call("common_knowledge_list",map());JsonNode collections=listed.path("collections");
            if(!collections.isArray())throw new ApiException(502,"知识库集合目录格式无效");
            ArrayNode normalized=json.createArrayNode();Set<String> seen=new HashSet<>();
            for(JsonNode c:collections){
                String cid=remoteText(c,"id",8192,true),name=remoteText(c,"name",500,false),status=remoteText(c,"indexingStatus",64,false);
                if(!seen.add(cid))throw new ApiException(502,"知识库集合 ID 重复");
                String description=remoteText(c,"description",20000,false);
                JsonNode count=c.path("documentCount");
                boolean hasCount=count.isIntegralNumber()&&count.canConvertToLong()&&count.asLong()>=0&&count.asLong()<=9007199254740991L;
                normalized.add(json.valueToTree(map("id",cid,"name",name.isEmpty()?cid:name,"indexingStatus",status.isEmpty()?"unknown":status,
                    "description",description,"documentCount",hasCount?count.asLong():null,"documentCountSource",hasCount?"reported":null)));
            }
            if("collections".equals(operation)){
                if(input.has("allowedCollectionIds")){Set<String> allowed=new HashSet<>();input.path("allowedCollectionIds").forEach(n->allowed.add(n.asText()));ArrayNode visible=json.createArrayNode();for(JsonNode n:normalized)if(allowed.contains(n.path("id").asText()))visible.add(n);normalized=visible;}
                if(input.path("includeDocumentCounts").asBoolean(false))populateDocumentCounts(session,normalized);
                return json.valueToTree(map("collections",normalized,"tools",TOOLS));
            }
            if(collectionId==null||collectionId.isEmpty()||!seen.contains(collectionId))throw new ApiException(409,"所选知识库已不存在或不可见，请刷新连接目录");
            if("capabilities".equals(operation)){
                Map<String,Object> caps=new LinkedHashMap<>();for(String capability:Arrays.asList("document","search","wiki","graph","gallery","preview")){boolean supported=Arrays.asList("document","search").contains(capability);caps.put(capability,map("supported",supported,"enabled",supported,"available",supported?"unknown":"unsupported"));}return json.valueToTree(map("type","document","capabilities",caps));
            }
            if(input.hasNonNull("contentKind")&&!"document".equals(input.path("contentKind").asText()))throw new ApiException(422,"此驱动不支持指定内容类型");
            if(!Arrays.asList("documents","document","search","answer").contains(operation))throw new ApiException(422,"此驱动不支持该知识库能力");
            if("documents".equals(operation))return documents(session,collectionId);
            if("document".equals(operation)){
                String documentId=text(input,"documentId",8192,true);boolean member=false;
                for(JsonNode d:documents(session,collectionId).path("documents"))if(documentId.equals(d.path("id").asText()))member=true;
                if(!member)throw new ApiException(404,"该文档不在所选知识库的可见文档列表中");
                JsonNode result=session.call("common_knowledge_get_document",map("documentId",documentId)),document=result.path("document");
                if(document.isNull())return result;
                if(!document.isObject()||!documentId.equals(document.path("id").asText())||(document.hasNonNull("collectionId")&&!collectionId.equals(document.path("collectionId").asText())))
                    throw new ApiException(502,"知识库返回了范围不匹配的文档");
                scrub(result);return result;
            }
            if(!"search".equals(operation)&&!"answer".equals(operation))throw new ApiException(422,"不支持的知识库操作");
            String query=text(input,"query",8000,true);int topK=5;
            if(input.has("topK")){JsonNode n=input.path("topK");if(!n.isIntegralNumber()||!n.canConvertToInt()||n.asInt()<1||n.asInt()>20)throw new ApiException(422,"topK 必须为 1～20 的整数");topK=n.asInt();}
            if("search".equals(operation)){
                JsonNode result=session.call("common_knowledge_search",map("query",query,"collections",Collections.singletonList(collectionId),"topK",topK));
                validateSearch(result,collectionId);scrub(result);return result;
            }
            JsonNode result=session.call("common_knowledge_answer",map("question",query,"collections",Collections.singletonList(collectionId),"topK",topK,"requireCitations",true));
            validateSearch(result.path("search"),collectionId);
            if(!result.path("citations").isArray())throw new ApiException(502,"知识库证据引用格式无效");
            for(JsonNode citation:result.path("citations"))if(!collectionId.equals(citation.path("collectionId").asText()))throw new ApiException(502,"知识库返回了范围不匹配的引用");
            scrub(result);return result;
        });
    }
    private void populateDocumentCounts(KnowledgeMcpClient.Session session,ArrayNode collections){
        boolean timedOut=false;
        for(JsonNode item:collections){
            ObjectNode collection=(ObjectNode)item;
            if(collection.hasNonNull("documentCount"))continue;
            if(timedOut){collection.put("documentCountError","文件数读取超时，请刷新重试");continue;}
            try{
                JsonNode result=documents(session,collection.path("id").asText());
                Set<String> ids=new HashSet<>();for(JsonNode document:result.path("documents"))ids.add(document.path("id").asText());
                // The public tool has no pagination contract; this is a visible count, not an asserted total.
                collection.put("documentCount",ids.size());collection.put("documentCountSource","visible");
                if(result.path("partial").asBoolean(false)||result.path("warnings").size()>0)
                    collection.put("documentCountWarning","文档列表可能不完整，文件数仅统计本次返回的可见文档");
            }catch(ApiException e){
                timedOut=e.status==504;
                collection.put("documentCountError",timedOut?"文件数读取超时，请刷新重试":"文件数暂不可用，请刷新重试");
            }
        }
    }
    private JsonNode documents(KnowledgeMcpClient.Session session,String collectionId){
        JsonNode result=session.call("common_knowledge_list_documents",map("collectionId",collectionId));
        if(!result.path("documents").isArray())throw new ApiException(502,"知识库文档目录格式无效");
        for(JsonNode d:result.path("documents")){
            remoteText(d,"id",8192,true);
            if(d.hasNonNull("collectionId")&&!collectionId.equals(d.path("collectionId").asText()))throw new ApiException(502,"知识库返回了范围不匹配的文档目录");
            if(d.isObject())((ObjectNode)d).remove("extractedText");
        }
        scrub(result);return result;
    }
    private void validateSearch(JsonNode result,String collectionId){
        if(!result.isObject()||!result.path("results").isArray())throw new ApiException(502,"知识库检索结果格式无效");
        for(JsonNode hit:result.path("results"))if(!collectionId.equals(hit.path("citation").path("collectionId").asText()))throw new ApiException(502,"知识库检索返回了范围不匹配的证据");
        if(result.has("collections"))for(JsonNode c:result.path("collections"))if(!collectionId.equals(c.path("id").asText()))throw new ApiException(502,"知识库检索返回了范围不匹配的集合");
    }
    private String remoteText(JsonNode n,String field,int max,boolean required){
        try{return text(n,field,max,required);}catch(ApiException e){throw new ApiException(502,"知识库返回了无效的 "+field);}
    }
    private void scrub(JsonNode node){
        if(node.isObject()){((ObjectNode)node).remove("sourceUri");node.elements().forEachRemaining(this::scrub);}
        else if(node.isArray())node.elements().forEachRemaining(this::scrub);
    }
}
