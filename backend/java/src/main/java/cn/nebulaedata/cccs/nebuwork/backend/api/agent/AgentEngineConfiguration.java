package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.springframework.stereotype.Service;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.encode;

@Service
public class AgentEngineConfiguration {
    private final AgentSettings settings;private final AgentStore db;private final AgentRequests requests;private final AgentClient client;private final ObjectMapper json;
    public AgentEngineConfiguration(AgentSettings settings,AgentStore db,AgentRequests requests,AgentClient client,ObjectMapper json){this.settings=settings;this.db=db;this.requests=requests;this.client=client;this.json=json;}
    public Object read(String actor){return view(actor,settings.row(false));}
    private Map<String,Object> view(String actor,Map<String,Object> row){
        boolean configured=Boolean.TRUE.equals(row.get("configured"))||"1".equals(String.valueOf(row.get("configured")));
        Map<String,Object> value=map("canEdit",settings.canEdit(actor),"actorId",actor,"configured",configured);
        if(!settings.canEdit(actor))return value;
        AgentSettings.Connection c=settings.from(row);
        value.putAll(map("revision",row.get("revision"),"apiUrls",c.urls,"namespace",c.namespace,"sandboxImage",c.image,"requestTimeoutMs",c.timeoutMs,"hasSigningKey",!c.signingKey().isEmpty(),"hasCallbackKey",!c.callbackKey().isEmpty(),"clusterId",c.clusterId,"updatedAt",Objects.toString(row.get("updated_at"),null)));
        return value;
    }
    private String text(JsonNode body,String name,int max){JsonNode v=body.get(name);if(v!=null&&!v.isTextual())throw new ApiException(422,name+" 必须是文本");String s=v==null?"":v.asText().trim();if(s.length()>max)throw new ApiException(422,name+" 超过长度限制");return s;}
    private AgentSettings.Connection draft(JsonNode body,Map<String,Object> row){
        if(body==null||!body.isObject())throw new ApiException(422,"连接配置必须是对象");
        Set<String> allowed=new HashSet<>(Arrays.asList("revision","apiUrls","namespace","sandboxImage","requestTimeoutMs","signingKey","callbackKey"));
        body.fieldNames().forEachRemaining(k->{if(!allowed.contains(k))throw new ApiException(422,"不支持的智能体引擎配置字段");});
        if(!body.path("revision").isIntegralNumber()||!body.path("revision").canConvertToLong()||body.path("revision").asLong()!=((Number)row.get("revision")).longValue())throw new ApiException(409,"配置已变化，请重新加载后保存");
        JsonNode nodes=body.path("apiUrls");if(!nodes.isArray()||nodes.size()<1||nodes.size()>8)throw new ApiException(422,"请配置 1–8 个 API 节点或负载均衡地址");
        List<String> urls=new ArrayList<>();for(JsonNode node:nodes){if(!node.isTextual()||node.asText().length()>2048)throw new ApiException(422,"API 地址格式错误");String url=AgentEndpoint.normalize(node.asText());if(urls.contains(url))throw new ApiException(422,"API 地址不能重复");urls.add(url);}
        AgentSettings.Connection old=settings.from(row);String namespace=text(body,"namespace",128),image=text(body,"sandboxImage",240);
        if(!namespace.matches("[A-Za-z0-9_.:-]{1,128}"))throw new ApiException(422,"请填写有效的业务命名空间");
        if(old.configured&&!old.namespace.equals(namespace))throw new ApiException(409,"已绑定业务命名空间，变更需要先迁移原有任务和资源");
        if(image.isEmpty()||image.chars().anyMatch(c->Character.isWhitespace(c)||Character.isISOControl(c)))throw new ApiException(422,"请填写有效的沙箱镜像名称");
        JsonNode timeout=body.path("requestTimeoutMs");if(!timeout.isIntegralNumber()||!timeout.canConvertToInt()||timeout.intValue()<1000||timeout.intValue()>60000)throw new ApiException(422,"请求超时范围为 1000–60000 毫秒");
        String signing=text(body,"signingKey",512),callback=text(body,"callbackKey",512);
        if(signing.isEmpty())signing=old.signingKey();if(callback.isEmpty())callback=old.callbackKey();
        for(String secret:Arrays.asList(signing,callback))if(secret.length()<32||secret.chars().anyMatch(c->c<33||c>126))throw new ApiException(422,"签名密钥和回调密钥均需至少 32 个不含空白的 ASCII 字符");
        return new AgentSettings.Connection(true,urls,namespace,image,timeout.intValue(),signing,callback,old.clusterId,old.storageId);
    }
    public Object test(String actor,JsonNode body){settings.requireAdmin(actor);return inspect(draft(body,settings.row(false)));}
    public Object status(String actor){settings.requireAdmin(actor);AgentSettings.Connection c=settings.current();c.require();return inspect(c);}
    private Map<String,Object> inspect(AgentSettings.Connection c){
        List<Map<String,Object>> nodes=new ArrayList<>();JsonNode workers=json.createArrayNode();String clusterId=c.clusterId,storageId=c.storageId;boolean valid=true;
        for(String url:c.urls){long started=System.nanoTime();
            try{JsonNode info=client.inspect(c,url);String cluster=info.path("clusterId").asText(),storage=info.path("storageId").asText();
                if(!cluster.matches("[A-Za-z0-9_-]{16,128}")||!storage.matches("[a-f0-9]{64}"))throw new ApiException(502,"节点未提供有效集群身份，请更新引擎");
                if(clusterId.isEmpty()){clusterId=cluster;storageId=storage;}
                if(!clusterId.equals(cluster)||!storageId.equals(storage))throw new ApiException(409,"节点不属于同一集群或共享文件配置不一致");
                boolean image=false;for(JsonNode v:info.path("images"))if(c.image.equals(v.asText()))image=true;
                if(!image)throw new ApiException(422,"节点未配置所选沙箱镜像");
                workers=info.path("workers");nodes.add(map("url",url,"ready",true,"clusterId",cluster,"latencyMs",(System.nanoTime()-started)/1000000,"sdkVersion",info.path("sdkVersion").asText(),"message","连接及集群身份校验通过"));
            }catch(ApiException e){valid=false;nodes.add(map("url",url,"ready",false,"message",e.getMessage(),"latencyMs",(System.nanoTime()-started)/1000000));}
        }
        return map("ready",valid,"nodes",nodes,"workers",workers,"clusterId",clusterId,"storageId",storageId,"checkedAt",java.time.Instant.now().toString(),"message",valid?"全部 API 节点校验通过；未创建任务，回调密钥需与 Worker 配置一致":"部分 API 节点未通过校验，请检查后重试");
    }
    public Object save(String actor,JsonNode body,String requestKey){
        settings.requireAdmin(actor);
        return requests.once(actor,"engine-settings",requestKey,body,()->{
            settings.requireAdmin(actor);Map<String,Object> row=settings.row(true);AgentSettings.Connection c=draft(body,row);Map<String,Object> check=inspect(c);
            if(!Boolean.TRUE.equals(check.get("ready")))throw new ApiException(422,"连接未通过校验，请先点击检查连接查看各节点结果");
            db.update("UPDATE nw_agent_engine_settings SET configured=TRUE,api_urls_json=?,namespace=?,signing_key_cipher=?,callback_key_cipher=?,cluster_id=?,storage_id=?,sandbox_image=?,request_timeout_ms=?,revision=revision+1,updated_by=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=1",
                encode(json,c.urls),c.namespace,settings.encrypt("signing",c.signingKey()),settings.encrypt("callback",c.callbackKey()),check.get("clusterId"),check.get("storageId"),c.image,c.timeoutMs,actor);
            Map<String,Object> saved=view(actor,settings.row(false));
            db.update("INSERT INTO nw_agent_engine_settings_audit(revision,actor,settings_json,credential_action) VALUES(?,?,?,?)",saved.get("revision"),actor,encode(json,saved),"signing:"+(text(body,"signingKey",512).isEmpty()?"keep":"replace")+",callback:"+(text(body,"callbackKey",512).isEmpty()?"keep":"replace"));
            return saved;
        });
    }
}
