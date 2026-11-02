package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.Map;
import java.util.function.Supplier;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;

@Service
public class AgentRequests {
    private final AgentStore db;private final ObjectMapper json;
    public AgentRequests(AgentStore db,ObjectMapper json){this.db=db;this.json=json;}
    @Transactional public Object once(String owner,String scope,String requestKey,Object body,Supplier<Object> operation){
        key(requestKey);String digest=fingerprint(json.valueToTree(body));
        db.update("INSERT INTO nw_agent_request(owner_id,scope,request_key,request_hash) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE request_key=request_key",owner,scope,requestKey,digest);
        Map<String,Object> request=db.one("SELECT * FROM nw_agent_request WHERE owner_id=? AND scope=? AND request_key=? FOR UPDATE",owner,scope,requestKey);sameHash(request,digest);
        if(request.get("result_json")!=null)return decode(json,request.get("result_json"));
        Object result=operation.get();db.update("UPDATE nw_agent_request SET result_json=? WHERE owner_id=? AND scope=? AND request_key=?",encode(json,result),owner,scope,requestKey);return result;
    }
}
