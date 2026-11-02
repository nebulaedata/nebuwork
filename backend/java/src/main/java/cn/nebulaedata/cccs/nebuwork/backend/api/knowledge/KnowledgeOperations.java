package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.*;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.knowledge.KnowledgeValues.*;

/** Durable receipts survive a failed local ownership transaction. Never replay writes. */
@Service
public class KnowledgeOperations {
    private final KnowledgeAccess access;private final ObjectMapper json;
    public KnowledgeOperations(KnowledgeAccess access,ObjectMapper json){this.access=access;this.json=json;}
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public Map<String,Object> begin(String actor,String connection,String collection,String key,String op,JsonNode body){
        if(key==null||!key.matches("[A-Za-z0-9_-]{8,100}"))throw new ApiException(422,"缺少有效操作编号");
        String digest=hash(connection+"\n"+collection+"\n"+op+"\n"+body.toString());
        access.jdbc().update("INSERT INTO nw_knowledge_operation(id,owner_id,connection_id,collection_id,request_key,request_hash,operation,status) VALUES(?,?,?,?,?,?,?,'submitting') ON DUPLICATE KEY UPDATE request_key=request_key",id("kop"),actor,connection,collection,key,digest,op);
        Map<String,Object> row=required(access.one("SELECT * FROM nw_knowledge_operation WHERE owner_id=? AND request_key=? FOR UPDATE",actor,key));
        if(!digest.equals(row.get("request_hash")))throw new ApiException(409,"操作编号已用于不同请求，请重新打开操作表单");
        // Claim once, including when the process terminates before the HTTP response.
        if("submitting".equals(row.get("status"))){access.jdbc().update("UPDATE nw_knowledge_operation SET status='sent' WHERE id=?",row.get("id"));row.put("claimed",true);}return row;
    }
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public void received(String id,JsonNode result){access.jdbc().update("UPDATE nw_knowledge_operation SET result_json=?,status='received',updated_at=CURRENT_TIMESTAMP(6) WHERE id=?",result.toString(),id);}
    /** Save recovery input in the receipt transaction, never in a suspended caller transaction. */
    @Transactional(propagation=Propagation.REQUIRES_NEW)
    public Map<String,Object> beginWithRequest(String actor,String connection,String collection,String key,String op,JsonNode body,JsonNode safeRequest){
        Map<String,Object> row=begin(actor,connection,collection,key,op,body);
        access.jdbc().update("UPDATE nw_knowledge_operation SET request_json=? WHERE id=?",safeRequest.toString(),row.get("id"));
        row.put("request_json",safeRequest.toString());return row;
    }
    public void finish(String id){access.jdbc().update("UPDATE nw_knowledge_operation SET status='completed',updated_at=CURRENT_TIMESTAMP(6) WHERE id=?",id);}
    public JsonNode result(Map<String,Object> row){try{return row.get("result_json")==null?null:json.readTree(row.get("result_json").toString());}catch(Exception e){throw new ApiException(500,"操作记录无法读取");}}
    public Map<String,Object> owned(String actor,String id){return required(access.one("SELECT * FROM nw_knowledge_operation WHERE owner_id=? AND id=?",actor,id));}
}
