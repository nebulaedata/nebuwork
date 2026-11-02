package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import com.fasterxml.jackson.databind.*;
import org.springframework.stereotype.Component;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.decode;

@Component
public class AgentSettings {
    /** Immutable per-request connection. Never serialize credentials to the browser. */
    public static final class Connection {
        final boolean configured; final List<String> urls; final String namespace,image,clusterId,storageId;
        final int timeoutMs; private final String signingKey,callbackKey;
        Connection(boolean configured,List<String> urls,String namespace,String image,int timeoutMs,String signingKey,String callbackKey,String clusterId,String storageId) {
            this.configured=configured;this.urls=Collections.unmodifiableList(new ArrayList<>(urls));this.namespace=namespace;this.image=image;this.timeoutMs=timeoutMs;
            this.signingKey=signingKey;this.callbackKey=callbackKey;this.clusterId=clusterId;this.storageId=storageId;
        }
        String signingKey(){return signingKey;} String callbackKey(){return callbackKey;}
        void require(){if(!configured||urls.isEmpty()||signingKey.length()<32||callbackKey.length()<32)throw new ApiException(503,"请由管理员在设置 → 智能体引擎中配置连接");}
    }
    private final AgentStore db;private final ModelSecretCipher cipher;private final ObjectMapper json;
    public AgentSettings(AgentStore db,ModelSecretCipher cipher,ObjectMapper json){this.db=db;this.cipher=cipher;this.json=json;}
    Map<String,Object> row(boolean lock){return db.one("SELECT * FROM nw_agent_engine_settings WHERE id=1"+(lock?" FOR UPDATE":""));}
    Connection from(Map<String,Object> row){
        List<String> urls=new ArrayList<>();for(JsonNode url:decode(json,row.get("api_urls_json")))urls.add(url.asText());
        return new Connection(Boolean.TRUE.equals(row.get("configured"))||"1".equals(String.valueOf(row.get("configured"))),urls,row.get("namespace").toString(),row.get("sandbox_image").toString(),((Number)row.get("request_timeout_ms")).intValue(),
            decrypt("signing",row.get("signing_key_cipher")),decrypt("callback",row.get("callback_key_cipher")),Objects.toString(row.get("cluster_id"),""),Objects.toString(row.get("storage_id"),""));
    }
    private String decrypt(String kind,Object value){return value==null?"":cipher.decrypt("system-agent-engine",kind,value.toString());}
    String encrypt(String kind,String value){return cipher.encrypt("system-agent-engine",kind,value);}
    public Connection current(){return from(row(false));}
    public String callbackKey(){return current().callbackKey();}
    public String tenant(){return current().namespace;}
    public String image(){return current().image;}
    public boolean enabled(){return current().configured;}
    public void require(){current().require();}
    public boolean canEdit(String actor){return actor!=null&&db.one("SELECT owner_id FROM nw_agent_engine_admin WHERE owner_id=?",actor)!=null;}
    public void requireAdmin(String actor){if(!canEdit(actor))throw new ApiException(403,"仅指定管理员可以配置和检查智能体引擎");}
}
