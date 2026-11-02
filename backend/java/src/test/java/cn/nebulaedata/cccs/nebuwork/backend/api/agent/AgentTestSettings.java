package cn.nebulaedata.cccs.nebuwork.backend.api.agent;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import org.springframework.jdbc.core.JdbcTemplate;
final class AgentTestSettings {
    static void seed(JdbcTemplate db,ModelSecretCipher cipher,String url,String namespace,String signing,String callback){
        db.update("UPDATE nw_agent_engine_settings SET configured=TRUE,api_urls_json=?,namespace=?,signing_key_cipher=?,callback_key_cipher=?,cluster_id=NULL,storage_id=NULL WHERE id=1","[\""+url+"\"]",namespace,cipher.encrypt("system-agent-engine","signing",signing),cipher.encrypt("system-agent-engine","callback",callback));
    }
}
