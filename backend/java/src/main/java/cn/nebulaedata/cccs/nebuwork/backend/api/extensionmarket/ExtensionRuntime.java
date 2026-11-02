package cn.nebulaedata.cccs.nebuwork.backend.api.extensionmarket;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.RuntimeResources;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;

/** Same effective extension set for a main run and the selected collaborating expert. */
public final class ExtensionRuntime {
    private ExtensionRuntime(){}
    public static ObjectNode compose(ObjectMapper json,JsonNode... sources){
        ObjectNode result=RuntimeResources.empty(json);
        for(JsonNode source:sources){ExtensionMarket.removeShadowed(result,source);for(String field:Arrays.asList("files","skills","mcp")){ArrayNode rows=result.withArray(field);String key=field.equals("files")?"path":"id";for(JsonNode row:source.path(field)){for(int n=rows.size()-1;n>=0;n--)if(rows.get(n).path(key).equals(row.path(key)))rows.remove(n);rows.add(row.deepCopy());}}}
        return result;
    }
}
