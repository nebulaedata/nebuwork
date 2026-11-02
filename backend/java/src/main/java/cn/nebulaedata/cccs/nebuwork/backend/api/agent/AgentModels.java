package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import cn.nebulaedata.cccs.nebuwork.backend.api.model.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.BusinessValues.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

@Service
public class AgentModels {
    private final ModelProviderMapper models;private final ModelSecretCipher cipher;private final ObjectMapper json;
    public AgentModels(ModelProviderMapper models,ModelSecretCipher cipher,ObjectMapper json){this.models=models;this.cipher=cipher;this.json=json;}
    public ObjectNode binding(String owner,JsonNode configuration){
        String provider=configuration.path("modelProviderId").asText("");
        if(provider.isEmpty()){Map<String,Object> defaults=models.settings(owner);provider=defaults==null?"":Objects.toString(defaults.get("default_provider_id"),"");}
        Map<String,Object> row=models.owned(owner,provider);if(row==null)throw new ApiException(422,"请选择当前账号的模型连接或配置默认模型");
        JsonNode parameters=configuration.path("model");
        int context=parameters.path("contextWindow").asInt(32768),maxTokens=parameters.path("maxTokens").asInt(8192);
        if(context<1024||maxTokens<1||maxTokens>=context)throw new ApiException(422,"模型上下文与输出上限不正确");
        ObjectNode binding=json.valueToTree(map("providerId",provider,"revision",row.get("config_fingerprint"),"protocol","openai-compatible","baseUrl",row.get("base_url"),"model",row.get("model_name"),"credentialRef","model:"+provider,"contextWindow",context,"maxTokens",maxTokens,"reasoning",parameters.path("reasoning").asBoolean(false),"images",parameters.path("images").asBoolean(false),"timeoutMs",parameters.path("timeoutMs").asInt(120000)));
        if(parameters.has("temperature")){double temperature=parameters.path("temperature").asDouble(-1);if(temperature<0||temperature>2)throw new ApiException(422,"模型温度须在 0 到 2 之间");binding.put("temperature",temperature);}
        return binding;
    }
    public Object credential(String owner,String reference){String provider=reference.substring("model:".length());Map<String,Object> row=models.owned(owner,provider);if(row==null)throw new ApiException(403,"模型授权已撤销");return map("apiKey",cipher.decrypt(owner,provider,str(row,"api_key_ciphertext")));}
    public boolean matchesEndpoint(String owner,JsonNode binding){Map<String,Object> row=models.owned(owner,binding.path("providerId").asText());return row!=null&&Objects.toString(row.get("base_url"),"").equals(binding.path("baseUrl").asText());}
    public boolean allowed(String owner,String provider){return models.owned(owner,provider)!=null;}
}
