package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentClient;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Service;
import java.security.MessageDigest;

@Service
public class DatabaseObjects {
    private final AgentClient engine;
    public DatabaseObjects(AgentClient engine){this.engine=engine;}
    public String storage(String owner){JsonNode cap=engine.get(owner,null,"/v1/capabilities");if(!cap.path("databaseResources").asBoolean()||cap.path("storageId").asText().isEmpty())throw new ApiException(409,"请先升级 New2 API/Worker 以支持数据库资源");return cap.path("storageId").asText();}
    public JsonNode put(String owner,byte[] bytes){return engine.uploadDatabase(owner,bytes,digest(bytes));}
    public byte[] get(String owner,String sha,String storage){if(!storage.equals(storage(owner)))throw new ApiException(409,"数据库对象存储已改变，需先迁移原快照");byte[] bytes=engine.databaseBytes(owner,sha);if(!sha.equals(digest(bytes)))throw new ApiException(502,"数据库快照完整性校验失败");return bytes;}
    public static String digest(byte[] bytes){try{StringBuilder s=new StringBuilder();for(byte b:MessageDigest.getInstance("SHA-256").digest(bytes))s.append(String.format("%02x",b&255));return s.toString();}catch(Exception e){throw new IllegalStateException(e);}}
}
