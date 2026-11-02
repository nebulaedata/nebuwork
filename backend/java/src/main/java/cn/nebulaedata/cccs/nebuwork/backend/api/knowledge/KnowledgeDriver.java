package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.Map;

public interface KnowledgeDriver {
    String id();
    Map<String,Object> descriptor();
    JsonNode execute(String endpoint,Map<String,String> headers,String operation,String collectionId,JsonNode input);
}

