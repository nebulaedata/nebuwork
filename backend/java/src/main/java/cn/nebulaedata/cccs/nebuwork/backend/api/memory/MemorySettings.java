package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import org.springframework.beans.factory.annotation.Autowired;
import java.util.Map;
import java.util.function.Supplier;

@Component
public class MemorySettings {
    private final Environment env;
    private MemoryConfigurationStore store;
    private cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentSettings engineSettings;
    @Autowired(required=false) public void useEngineSettings(cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentSettings settings){engineSettings=settings;}
    public MemorySettings(Environment env) { this.env = env; }
    @Autowired(required=false) public void useStore(MemoryConfigurationStore store) { this.store=store; }
    /** One immutable destination/credential pair per HTTP request; never serialize this object. */
    public static final class Connection {
        public final boolean enabled;
        public final String baseUrl;
        public final int recallMs, requestMs, tokens;
        public final boolean hasApiKey;
        private final Supplier<String> secret;
        public Connection(boolean enabled,String baseUrl,int recallMs,int requestMs,int tokens,boolean hasApiKey,Supplier<String> secret) {
            this.enabled=enabled;this.baseUrl=baseUrl;this.recallMs=recallMs;this.requestMs=requestMs;this.tokens=tokens;this.hasApiKey=hasApiKey;this.secret=secret;
        }
        String apiKey() { return secret.get(); }
    }
    public Connection current() { return from(store==null?null:store.read(false)); }
    Connection from(Map<String,Object> row) {
        if (row!=null&&MemoryConfigurationStore.flag(row.get("configured"))) {
            Object encrypted=row.get("api_key_cipher");
            return new Connection(MemoryConfigurationStore.flag(row.get("enabled")),row.get("base_url").toString(),
                ((Number)row.get("recall_timeout_ms")).intValue(),((Number)row.get("request_timeout_ms")).intValue(),
                ((Number)row.get("recall_max_tokens")).intValue(),encrypted!=null,()->store.decrypt(encrypted));
        }
        String key=env.getProperty("nebu.memory.api-key","");
        return new Connection(env.getProperty("nebu.memory.enabled",Boolean.class,false),
            env.getProperty("nebu.memory.base-url","http://192.168.77.152:8888"),bounded("recall-timeout-ms",3000,500,10000),
            bounded("request-timeout-ms",15000,1000,30000),bounded("recall-max-tokens",3000,100,6000),!key.isEmpty(),()->key);
    }
    // Called within entry creation's transaction, serializing the first scope with destination edits.
    public void lockDestination() { if (store!=null) store.read(true); }
    public boolean enabled() { return current().enabled; }
    public String baseUrl() { return current().baseUrl; }
    public String apiKey() { return current().apiKey(); }
    public String instance() { return engineSettings==null?"nebuwork-v2":engineSettings.tenant(); }
    public int recallMs() { return current().recallMs; }
    public int requestMs() { return current().requestMs; }
    public int tokens() { return current().tokens; }
    private int bounded(String name, int value, int min, int max) {
        return Math.max(min, Math.min(max, env.getProperty("nebu.memory." + name, Integer.class, value)));
    }
}
