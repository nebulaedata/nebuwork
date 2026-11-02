package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.ModelSecretCipher;
import org.springframework.stereotype.Repository;
import java.util.Map;

@Repository
public class MemoryConfigurationStore {
    private final MemoryStore db;
    private final ModelSecretCipher cipher;
    public MemoryConfigurationStore(MemoryStore db, ModelSecretCipher cipher) { this.db=db; this.cipher=cipher; }
    public Map<String,Object> read(boolean lock) {
        Map<String,Object> row=db.one("SELECT * FROM nw_memory_settings WHERE id=1"+(lock?" FOR UPDATE":""));
        if (row==null) throw new ApiException(503,"记忆配置尚未初始化，请应用 V13 数据库迁移");
        return row;
    }
    public boolean originLocked() { return db.one("SELECT id FROM nw_memory_scope LIMIT 1")!=null; }
    public String encrypt(String key) { return key.isEmpty()?null:cipher.encrypt("system-memory","hindsight",key); }
    public String decrypt(Object value) { return value==null?"":cipher.decrypt("system-memory","hindsight",value.toString()); }
    static boolean flag(Object value) { return Boolean.TRUE.equals(value)||(value instanceof Number&&((Number)value).intValue()!=0); }
}
