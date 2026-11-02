package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.NebulaeV100RestDriver.data;

@Service
public class KnowledgeManagement {
    @org.springframework.beans.factory.annotation.Autowired(required=false) private KnowledgeV101Gateway v101Gateway;
    @org.springframework.beans.factory.annotation.Autowired(required=false) private NebulaeV101RestDriver v101;
    private final KnowledgeAccess access;private final KnowledgeService knowledge;private final NebulaeV100RestDriver driver;private final KnowledgeOperations operations;private final ObjectMapper json;
    private static final Set<String> READ=new HashSet<>(Arrays.asList("models","storage","vectors","kb.get","documents.list","document.get","document.stages","faq.list","faq.get","tags.list","wiki.pages","wiki.get","wiki.folders","wiki.revisions","wiki.index","wiki.stats","wiki.lint","wiki.issues","wiki.graph"));
    private static final Set<String> WRITE=new HashSet<>(Arrays.asList("kb.create","kb.update","kb.resources","kb.delete","document.manual","document.url","document.update","document.delete","document.reparse","document.cancel","faq.create","faq.update","faq.delete","faq.fields","faq.tags","faq.import","tags.create","tags.update","tags.delete","wiki.create","wiki.update","wiki.delete","wiki.move","wiki.folder.create","wiki.folder.update","wiki.folder.delete","wiki.revert","wiki.links","wiki.fix","wiki.issue"));
    public KnowledgeManagement(KnowledgeAccess access,KnowledgeService knowledge,NebulaeV100RestDriver driver,KnowledgeOperations operations,ObjectMapper json){this.access=access;this.knowledge=knowledge;this.driver=driver;this.operations=operations;this.json=json;}
    private Map<String,Object> connection(String actor,String id){Map<String,Object> c=access.connection(id);if(!access.visible(actor,c))throw new ApiException(404,"知识库连接不可用");if(!bool(c.get("enabled")))throw new ApiException(409,"连接已禁用");if(!driver.id().equals(c.get("driver")))throw new ApiException(422,"此驱动不支持远端内容管理");return c;}
    @Transactional public Object manage(String actor,String id,JsonNode body){
        if(NebulaeV101RestDriver.ID.equals(access.connection(id).get("driver")))return manageV101(actor,id,body);
        fields(body,"operation","collectionId","resourceId","payload","page","pageSize","keyword","query","parse_status","source","search_field","is_enabled","tag_id","sort_order","folder_id","page_type","status","parent_id","version","cursor","requestKey");
        access.migrateLegacy();access.lock();Map<String,Object> c=connection(actor,id);
        String op=text(body,"operation",64,true),kb=text(body,"collectionId",8192,false);boolean read=READ.contains(op);
        if("kb.references".equals(op)){access.require(actor,c,kb,false);List<Map<String,Object>> all=access.references(c,kb),own=new ArrayList<>();for(Map<String,Object> ref:all)if(actor.equals(ref.get("ownerId")))own.add(ref);return map("result",map("blocked",!all.isEmpty(),"references",own,"otherReferences",all.size()>own.size()));}
        if(Arrays.asList("models","storage","vectors","kb.create").contains(op)){if(!kb.isEmpty()&&!"kb.create".equals(op))access.require(actor,c,kb,false);else if(!bool(c.get("published")))throw new ApiException(403,"此连接尚未开放新建知识库");}
        else access.require(actor,c,kb,!read);
        if("kb.delete".equals(op))access.unused(c,kb);
        if(!read&&!WRITE.contains(op))throw new ApiException(422,"不支持的知识库管理操作");
        Map<String,Object> receipt=null;
        if(!read){
            ObjectNode request=((ObjectNode)body).deepCopy();request.remove("requestKey");
            receipt=operations.begin(actor,id,kb,text(body,"requestKey",100,true),op,request);
            if(!Boolean.TRUE.equals(receipt.get("claimed")))return recoverReceipt(actor,c,receipt);
        }
        JsonNode result=driver.client.execute(string(c,"endpoint"),knowledge.headers(c),s->driver.manage(s,op,kb,body));NebulaeV100RestDriver.scrub(result);
        if(receipt!=null){operations.received(string(receipt,"id"),result);complete(c,actor,op,kb,result);operations.finish(string(receipt,"id"));knowledge.audit(actor,kb.isEmpty()?id:kb,op,map("operationId",receipt.get("id")));}
        return map("result",result,"operationId",receipt==null?null:receipt.get("id"));
    }
    private void complete(Map<String,Object> c,String actor,String op,String kb,JsonNode result){
        if("kb.create".equals(op)){String remote=text(data(result),"id",8192,true);access.register(c,remote,actor);}
        if("kb.delete".equals(op)){Map<String,Object> l=access.library(c,kb);if(l!=null){access.jdbc().update("DELETE FROM nw_knowledge_library_access WHERE library_id=?",l.get("id"));access.jdbc().update("DELETE FROM nw_knowledge_library WHERE id=?",l.get("id"));}}
    }
    private Object recoverReceipt(String actor,Map<String,Object> c,Map<String,Object> row){
        JsonNode result=operations.result(row);if(result==null)throw new ApiException(409,"原操作结果尚不确定，请刷新远端列表核对，禁止自动重复提交。操作编号："+row.get("id"));
        if("completed".equals(row.get("status"))&&"kb.create".equals(row.get("operation")))access.require(actor,c,data(result).path("id").asText(),false);
        if(!"completed".equals(row.get("status"))){complete(c,actor,string(row,"operation"),string(row,"collection_id"),result);operations.finish(string(row,"id"));}
        Map<String,Object> response=map("result",result,"operationId",row.get("id"));
        if("document.upload".equals(row.get("operation")))response.put("outcome","duplicate".equals(result.path("uploadOutcome").asText())?"duplicate":"accepted");
        return response;
    }
    @Transactional public Object recover(String actor,String id){Map<String,Object> candidate=operations.owned(actor,id);if(NebulaeV101RestDriver.ID.equals(access.connection(string(candidate,"connection_id")).get("driver")))return v101Gateway.recover(actor,id);access.lock();Map<String,Object> row=operations.owned(actor,id),c=connection(actor,string(row,"connection_id"));if(string(row,"request_key").startsWith("aicreate-"))throw new ApiException(409,"请在我的创建任务中恢复，以核验模板及实际配置");if(!"kb.create".equals(row.get("operation")))access.require(actor,c,string(row,"collection_id"),true);return recoverReceipt(actor,c,row);}
    public Object listOperations(String actor){
        List<Map<String,Object>> out=new ArrayList<>();
        for(Map<String,Object> row:access.jdbc().queryForList("SELECT * FROM nw_knowledge_operation WHERE owner_id=? AND request_key NOT LIKE 'aicreate-%' ORDER BY created_at DESC LIMIT 100",actor)){
            Map<String,Object> c=access.one("SELECT * FROM nw_knowledge_connection WHERE id=?",row.get("connection_id"));
            // Receipts never re-expose saved content after reassignment or revocation.
            boolean readable=c!=null&&bool(c.get("enabled"))&&access.allowed(actor,c,string(row,"collection_id"),false);
            JsonNode saved=operations.result(row);Object result=readable&&saved!=null?map("task_id",data(saved).path("task_id").asText()):null;
            out.add(map("id",row.get("id"),"connectionId",row.get("connection_id"),"collectionId",row.get("collection_id"),"operation",row.get("operation"),"status",row.get("status"),"result",result,"createdAt",row.get("created_at")));
        }return out;
    }
    private JsonNode progressResult(String actor,String id){
        Map<String,Object> row=operations.owned(actor,id),c=connection(actor,string(row,"connection_id"));String kb=string(row,"collection_id");access.require(actor,c,kb,false);
        if(!"faq.import".equals(row.get("operation")))throw new ApiException(422,"此操作没有 FAQ 导入任务");JsonNode saved=operations.result(row);String task=saved==null?"":data(saved).path("task_id").asText();if(task.isEmpty())throw new ApiException(409,"尚未收到远端任务编号");
        return driver.client.execute(string(c,"endpoint"),knowledge.headers(c),s->{JsonNode response=s.request("GET","/faq/import/progress/"+KnowledgeRestClient.segment(task),null);if(!kb.equals(data(response).path("kb_id").asText()))throw new ApiException(502,"导入任务不属于当前知识库");NebulaeV100RestDriver.scrub(response);return response;});
    }
    public Object progress(String actor,String id){JsonNode result=progressResult(actor,id);ObjectNode d=(ObjectNode)data(result);d.put("hasFailureReport",!d.path("failed_entries_url").asText().isEmpty());d.remove("failed_entries_url");return result;}
    public KnowledgeRestClient.Binary failureReport(String actor,String id){
        JsonNode result=progressResult(actor,id);String location=data(result).path("failed_entries_url").asText();if(location.isEmpty())throw new ApiException(404,"此导入没有独立错误报告");
        Map<String,Object> c=connection(actor,string(operations.owned(actor,id),"connection_id"));return driver.client.downloadReport(string(c,"endpoint"),location);
    }
    @Transactional public Object upload(String actor,String id,String kb,String key,MultipartFile file,String filename,String relativePath){
        String uploadName=KnowledgeUpload.validate(file,filename,relativePath);
        if(NebulaeV101RestDriver.ID.equals(access.connection(id).get("driver")))return uploadV101(actor,id,kb,key,file,uploadName);
        access.lock();Map<String,Object> c=connection(actor,id);access.require(actor,c,kb,true);
        JsonNode library=driver.client.execute(string(c,"endpoint"),knowledge.headers(c),s->s.request("GET",NebulaeV100RestDriver.kb(kb),null));
        if("faq".equals(data(library).path("type").asText()))throw new ApiException(422,"FAQ 知识库请使用 FAQ 导入功能");
        // Upload keys intentionally cannot be reused for a different file, even with an identical name.
        String digest;try(java.io.InputStream in=file.getInputStream()){java.security.MessageDigest md=java.security.MessageDigest.getInstance("SHA-256");byte[] bytes=new byte[8192];int n;while((n=in.read(bytes))!=-1)md.update(bytes,0,n);digest=Base64.getEncoder().encodeToString(md.digest());}catch(Exception e){throw new ApiException(422,"无法读取上传文件");}
        ObjectNode request=json.valueToTree(map("fileName",filename,"size",file.getSize(),"digest",digest));
        // Preserve historical single-file request hashes exactly.
        if(relativePath!=null&&!relativePath.isEmpty())request.put("relativePath",uploadName);
        Map<String,Object> row=operations.begin(actor,id,kb,key,"document.upload",request);
        if(!Boolean.TRUE.equals(row.get("claimed")))return recoverReceipt(actor,c,row);
        JsonNode result=driver.client.executeUpload(string(c,"endpoint"),knowledge.headers(c),s->s.upload(NebulaeV100RestDriver.kb(kb)+"/knowledge/file",file,uploadName));NebulaeV100RestDriver.scrub(result);
        if("duplicate".equals(result.path("uploadOutcome").asText())&&!kb.equals(data(result).path("knowledge_base_id").asText()))throw new ApiException(502,"重复文件回执不属于当前知识库，请核对原操作");
        operations.received(string(row,"id"),result);operations.finish(string(row,"id"));knowledge.audit(actor,kb,"document.upload",map("operationId",row.get("id")));return map("result",result,"operationId",row.get("id"),"outcome","duplicate".equals(result.path("uploadOutcome").asText())?"duplicate":"accepted");
    }
    public KnowledgeRestClient.Binary download(String actor,String id,String kb,String resource,String format){
        if(NebulaeV101RestDriver.ID.equals(access.connection(id).get("driver"))){Map<String,Object> c=v101Gateway.connection(actor,id);access.require(actor,c,kb,false);return v101.client.execute(string(c,"endpoint"),knowledge.headers(c),session->{v101.document(session,kb,resource);return session.download(NebulaeV101RestDriver.doc(resource)+"/download");});}
        Map<String,Object> c=connection(actor,id);access.require(actor,c,kb,false);
        return driver.client.execute(string(c,"endpoint"),knowledge.headers(c),s->{
            if(resource!=null&&!resource.isEmpty()){driver.document(s,kb,resource);return s.download("/knowledge/"+KnowledgeRestClient.segment(resource)+"/download");}
            if(!Arrays.asList("csv","json").contains(format))throw new ApiException(422,"导出格式无效");return s.download(NebulaeV100RestDriver.kb(kb)+"/faq/entries/export?format="+format);
        });
    }
    private Object manageV101(String actor,String id,JsonNode body){
        String op=text(body,"operation",64,true),kb=text(body,"collectionId",8192,false),resource=text(body,"resourceId",8192,false),method="GET",path;JsonNode payload=body.path("payload");if(payload.isMissingNode())payload=json.createObjectNode();
        switch(op){case "models":path="/models";break;case "kb.create":path="/knowledge-bases";method="POST";break;case "kb.get":path=NebulaeV101RestDriver.kb(kb);break;case "kb.update":path=NebulaeV101RestDriver.kb(kb);method="PUT";break;case "kb.delete":path=NebulaeV101RestDriver.kb(kb);method="DELETE";break;case "documents.list":path=NebulaeV101RestDriver.kb(kb)+"/knowledge?"+NebulaeV101RestDriver.page(body);break;case "document.get":path=NebulaeV101RestDriver.doc(resource);break;case "document.delete":path=NebulaeV101RestDriver.doc(resource);method="DELETE";break;case "document.reparse":case "document.cancel":case "document.stages":path=NebulaeV101RestDriver.doc(resource)+"/"+(op.endsWith("reparse")?"reparse":op.endsWith("cancel")?"cancel-parse":"stages");method=op.endsWith("stages")?"GET":"POST";break;case "kb.references":{Map<String,Object> c=v101Gateway.connection(actor,id);access.require(actor,c,kb,false);return map("result",map("blocked",!access.references(c,kb).isEmpty()));}default:throw new ApiException(422,"请使用 V101 工作区管理此能力；V101 不提供 FAQ、动态图片属性或多存储切换");}
        return map("result",v101Gateway.call(actor,id,method,path,payload,text(body,"requestKey",100,false)));
    }
    private Object uploadV101(String actor,String id,String kb,String key,MultipartFile file,String path){
        Map<String,Object> c=v101Gateway.connection(actor,id);access.require(actor,c,kb,true);String digest;try(java.io.InputStream input=file.getInputStream()){java.security.MessageDigest md=java.security.MessageDigest.getInstance("SHA-256");byte[] b=new byte[8192];int n;while((n=input.read(b))!=-1)md.update(b,0,n);digest=Base64.getEncoder().encodeToString(md.digest());}catch(Exception e){throw new ApiException(422,"无法读取文件");}
        ObjectNode identity=json.valueToTree(map("name",path,"size",file.getSize(),"digest",digest));Map<String,Object> receipt=operations.begin(actor,id,kb,key,"document.upload",identity);JsonNode result=operations.result(receipt);
        if(Boolean.TRUE.equals(receipt.get("claimed"))){Map<String,String> headers=knowledge.headers(c);headers.put("Idempotency-Key",key);result=v101.client.executeUpload(string(c,"endpoint"),headers,session->session.uploadV101(NebulaeV101RestDriver.kb(kb)+"/knowledge/file",file,path));operations.received(string(receipt,"id"),result);}if(result==null)throw new ApiException(409,"原上传结果待核对，禁止重复提交");operations.finish(string(receipt,"id"));return map("result",result,"operationId",receipt.get("id"),"outcome","accepted");
    }

}
