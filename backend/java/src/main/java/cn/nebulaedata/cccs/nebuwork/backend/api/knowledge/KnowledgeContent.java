package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.NebulaeV100RestDriver.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeRestClient.segment;

@Service
public class KnowledgeContent {
    @org.springframework.beans.factory.annotation.Autowired(required=false) private NebulaeV101RestDriver v101;
    private final KnowledgeAccess access;private final KnowledgeService knowledge;private final NebulaeV100RestDriver driver;private final ObjectMapper json;
    public KnowledgeContent(KnowledgeAccess access,KnowledgeService knowledge,NebulaeV100RestDriver driver,ObjectMapper json){this.access=access;this.knowledge=knowledge;this.driver=driver;this.json=json;}
    public KnowledgeRestClient.Binary catalog(String actor,String connectionId,String collection,JsonNode body,boolean media){
        fields(body,"collectionId","documentId","chunkId","imageId","download","sourceRefId","fileVersionId","parseVersionId");
        Map<String,Object> connection=access.connection(connectionId);access.require(actor,connection,collection,false);
        if(!bool(connection.get("enabled")))throw new ApiException(409,"知识库连接已禁用");
        if(NebulaeV101RestDriver.ID.equals(connection.get("driver")))return v101.client.execute(string(connection,"endpoint"),knowledge.headers(connection),s->{String documentId=text(body,"documentId",8192,true);v101.document(s,collection,documentId);if(!media)return s.download(NebulaeV101RestDriver.doc(documentId)+(body.path("download").asBoolean()?"/download":"/preview")+NebulaeV101RestDriver.versions(body));String image=text(body,"imageId",1024,true);JsonNode asset=NebulaeV101RestDriver.data(s.request("GET","/images/"+segment(image),null));if(!documentId.equals(asset.path("knowledge_id").asText()))throw new ApiException(404,"图片不属于当前文档");for(String[] p:new String[][]{{"fileVersionId","file_version_id"},{"parseVersionId","parse_version_id"}})if(!body.path(p[0]).asText().isEmpty()&&!body.path(p[0]).asText().equals(asset.path(p[1]).asText()))throw new ApiException(409,"图片版本不匹配");return s.download("/images/"+segment(image)+"/content");});
        if(!driver.id().equals(connection.get("driver")))throw new ApiException(422,"此连接不支持原文件预览");
        String documentId=text(body,"documentId",8192,true);
        return driver.client.execute(string(connection,"endpoint"),knowledge.headers(connection),s->{
            driver.document(s,collection,documentId);
            if(!media)return s.download("/knowledge/"+segment(documentId)+(body.path("download").asBoolean()?"/download":"/preview"));
            String chunkId=text(body,"chunkId",512,true),imageId=text(body,"imageId",1024,true);
            JsonNode chunk=new KnowledgeViews(driver,json).chunk(s,collection,chunkId);
            if(!documentId.equals(chunk.path("knowledge_id").asText())||!imageId.startsWith(chunkId+"#"))throw new ApiException(404,"图片不属于当前文档");
            String index=imageId.substring(chunkId.length()+1);if(!index.matches("0|[1-9][0-9]{0,5}"))throw new ApiException(422,"图片标识无效");
            return s.download(kb(collection)+"/images/"+segment(chunkId)+"/"+index+"/content");
        });
    }
    public KnowledgeRestClient.Binary reference(String actor,String kind,String target,String reference,JsonNode body,boolean media){
        Map<String,Object> ref=knowledge.authorizedReference(actor,kind,target,reference);
        return catalog(actor,ref.get("connectionId").toString(),ref.get("collectionId").toString(),body,media);
    }
    private Map<String,Object> largeReference(String actor,JsonNode source){
        if("catalog".equals(source.path("scopeKind").asText())){Map<String,Object> ref=new HashMap<>();ref.put("connectionId",text(source,"connectionId",128,true));ref.put("collectionId",text(source,"collectionId",8192,true));return ref;}
        return knowledge.authorizedReference(actor,text(source,"scopeKind",32,true),text(source,"scopeId",128,true),text(source,"referenceId",512,true));
    }
    private <T>T large(String actor,JsonNode source,java.util.function.BiFunction<KnowledgeRestClient.Session,JsonNode,T> fn){
        Map<String,Object> ref=largeReference(actor,source),connection=access.connection(ref.get("connectionId").toString());String collection=ref.get("collectionId").toString();access.require(actor,connection,collection,false);
        if(NebulaeV101RestDriver.ID.equals(connection.get("driver"))&&bool(connection.get("enabled")))return v101.client.execute(string(connection,"endpoint"),knowledge.headers(connection),s->{
            String id=text(source,"documentId",8192,true);JsonNode d=v101.document(s,collection,id);String file=source.path("fileVersionId").asText(d.path("current_file_version_id").asText());
            if(source.hasNonNull("sourceRefId")){JsonNode fixed=v101.source(s,collection,source.path("sourceRefId").asText());if(!id.equals(fixed.path("knowledge_id").asText())||!file.equals(fixed.path("file_version_id").asText())||source.hasNonNull("parseVersionId")&&!source.path("parseVersionId").equals(fixed.path("parse_version_id")))throw new ApiException(409,"来源版本不匹配");}
            JsonNode version=null;for(JsonNode f:NebulaeV101RestDriver.data(s.request("GET",NebulaeV101RestDriver.doc(id)+"/versions",null)))if(file.equals(f.path("id").asText()))version=f;
            if(version==null)throw new ApiException(404,"文件版本不存在");ObjectNode metadata=json.createObjectNode();metadata.set("file_name",d.path("name"));metadata.set("file_type",d.path("file_type"));metadata.set("file_size",version.path("size"));metadata.set("file_hash",version.path("hash"));metadata.set("version",version.path("id"));metadata.put("_v101",true);return fn.apply(s,metadata);
        });
        if(!bool(connection.get("enabled"))||!driver.id().equals(connection.get("driver")))throw new ApiException(409,"知识库连接不可用");
        return driver.client.execute(string(connection,"endpoint"),knowledge.headers(connection),s->fn.apply(s,driver.document(s,collection,text(source,"documentId",8192,true))));
    }
    public JsonNode largeMetadata(String actor,JsonNode source){return large(actor,source,(s,d)->{Map<String,Object> m=new LinkedHashMap<>();m.put("name",d.path("file_name").asText(d.path("title").asText("document")));m.put("size",d.path("file_size").asLong(-1));m.put("fileType",d.path("file_type").asText());m.put("sourceHash",KnowledgeViews.sourceHash(d));m.put("version",d.path("version"));return json.valueToTree(m);});}
    public void largeStream(String actor,JsonNode source,String range,javax.servlet.http.HttpServletResponse response){large(actor,source,(s,d)->{String expected=source.path("expectedHash").asText();if(!expected.isEmpty()&&!expected.equals(KnowledgeViews.sourceHash(d)))throw new ApiException(409,"原文件版本已变化，请重新打开来源");if(d.path("_v101").asBoolean()){Map<String,String> headers=new HashMap<>();if(range!=null)headers.put("Range",range);s.forward("GET",NebulaeV101RestDriver.doc(text(source,"documentId",8192,true))+"/download?file_version_id="+segment(d.path("version").asText()),false,null,-1,null,headers,response,()->{try{Map<String,Object> ref=largeReference(actor,source),c=access.connection(ref.get("connectionId").toString());return bool(c.get("enabled"))&&access.allowed(actor,c,ref.get("collectionId").toString(),false);}catch(ApiException denied){return false;}});}else s.streamPreview("/knowledge/"+segment(text(source,"documentId",8192,true))+"/preview",range,response);return null;});}
}
