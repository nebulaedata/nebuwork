package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Locale;

/** Deliberately has no generated toString: credentials must not enter logs. */
public final class ModelCredentials {
    final String type, baseUrl, apiKey, model;
    final URI endpoint;
    private ModelCredentials(String type, String baseUrl, String apiKey, String model, URI endpoint) {
        this.type=type; this.baseUrl=baseUrl; this.apiKey=apiKey; this.model=model; this.endpoint=endpoint;
    }
    public static ModelCredentials parse(JsonNode body, boolean requireModel) {
        if (body == null || !body.isObject()) throw new ApiException(422,"配置必须是 JSON 对象");
        String type=text(body,"type",16,true);
        if(!Arrays.asList("mrtoken","custom").contains(type)) throw new ApiException(422,"厂商仅支持 mrtoken 或自定义");
        ModelCredentials result=from(type,text(body,"baseUrl",2048,true),
            text(body,"apiKey",4096,true),text(body,"model",255,requireModel));
        if(requireModel&&result.model.isEmpty()) throw new ApiException(422,"模型名不能为空");
        return result;
    }
    static String text(JsonNode body,String name,int max,boolean required) {
        JsonNode value=body.get(name);
        if(value!=null&&!value.isNull()&&!value.isTextual()) throw new ApiException(422,name+" 必须是文本");
        String result=value==null||value.isNull()?"":value.asText().trim();
        if((required&&result.isEmpty())||result.length()>max||result.chars().anyMatch(c -> c<32||c==127))
            throw new ApiException(422,name+" 为空、过长或含有非法字符");
        return result;
    }
    static ModelCredentials from(String type,String url,String key,String model) {
        // Legacy protocols are read-only compatibility for previously saved configurations.
        if(!Arrays.asList("mrtoken","custom","openai","anthropic","gemini").contains(type)) throw new ApiException(422,"不支持的模型厂商");
        URI base=normalizeUrl(url);
        if(base.toASCIIString().length()>2048) throw new ApiException(422,"规范化后的模型服务地址过长");
        String path=base.getPath();
        if(!path.endsWith("/models")) {
            if(!path.matches(".*/v[0-9]+(?:beta[0-9]*|alpha[0-9]*)?")) path += "gemini".equals(type)?"/v1beta":"/v1";
            path += "/models";
        }
        try {
            URI endpoint=new URI(base.getScheme(),null,base.getHost(),base.getPort(),path,null,null);
            String normalizedModel="gemini".equals(type)&&model.startsWith("models/")?model.substring(7):model;
            return new ModelCredentials(type,base.toASCIIString(),key,normalizedModel,endpoint);
        } catch(URISyntaxException e) { throw new ApiException(422,"模型地址格式不正确"); }
    }
    static boolean supportsExecution(String type) {
        return Arrays.asList("mrtoken","custom","openai").contains(type);
    }
    static URI normalizeUrl(String value) {
        try {
            URI uri=new URI(value);
            String scheme=uri.getScheme()==null?"":uri.getScheme().toLowerCase(Locale.ROOT);
            if(!Arrays.asList("http","https").contains(scheme)||uri.getHost()==null||uri.getRawUserInfo()!=null
                ||uri.getRawQuery()!=null||uri.getRawFragment()!=null||uri.getPort()==0||uri.getPort()>65535||uri.getPort() < -1)
                throw new URISyntaxException("","invalid");
            String path=uri.normalize().getPath().replaceAll("/+$","");
            // Disallow encoded separators / traversal ambiguities in proxy paths.
            if(Arrays.stream(uri.getPath().split("/")).anyMatch(segment -> segment.equals("..") || segment.equals(".")) || uri.getRawPath().contains("%")||path.contains("\\")||!path.equals(uri.getPath().replaceAll("/+$","")))
                throw new URISyntaxException("","invalid path");
            int port=uri.getPort();
            if(("https".equals(scheme)&&port==443)||("http".equals(scheme)&&port==80)) port=-1;
            return new URI(scheme,null,uri.getHost().toLowerCase(Locale.ROOT),port,path,null,null);
        } catch(URISyntaxException | IllegalArgumentException e) {
            throw new ApiException(422,"URL 仅支持 HTTP/HTTPS 地址，不能包含账号、查询参数或片段");
        }
    }
    static String origin(URI uri) {
        try { return new URI(uri.getScheme(),null,uri.getHost(),uri.getPort(),null,null,null).toASCIIString(); }
        catch(URISyntaxException e) { throw new ApiException(422,"模型地址格式不正确"); }
    }
}
