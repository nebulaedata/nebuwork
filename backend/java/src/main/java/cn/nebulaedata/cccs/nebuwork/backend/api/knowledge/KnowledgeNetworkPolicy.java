package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import java.net.*;
import java.util.Locale;

@Component
public class KnowledgeNetworkPolicy {
    private final Environment environment;
    public KnowledgeNetworkPolicy(Environment environment) { this.environment=environment; }
    public static URI endpoint(String value) {
        try {
            URI u=new URI(value.trim());
            if(!("http".equalsIgnoreCase(u.getScheme())||"https".equalsIgnoreCase(u.getScheme()))||u.getHost()==null
                ||u.getUserInfo()!=null||u.getRawQuery()!=null||u.getRawFragment()!=null||u.getPort()==0||u.getPort()>65535)
                throw new IllegalArgumentException();
            return u;
        } catch(Exception e) { throw new ApiException(422,"MCP 地址须为完整 HTTP/HTTPS 地址，不能包含账号、查询参数或片段"); }
    }
    private static String origin(URI u) {
        return u.getScheme().toLowerCase(Locale.ROOT)+"://"+u.getHost().toLowerCase(Locale.ROOT)+":"+(u.getPort()<0?("https".equalsIgnoreCase(u.getScheme())?443:80):u.getPort());
    }
    private boolean internalAllowlistEnabled() {
        // Read per operation so 服务端 refresh applies without recreating this bean.
        String value=environment.getProperty("nebu.knowledge.internal-allowlist-enabled","false").trim();
        if("true".equalsIgnoreCase(value))return true;
        if("false".equalsIgnoreCase(value))return false;
        throw new ApiException(503,"知识库内网白名单开关 internal-allowlist-enabled 必须为 true 或 false");
    }
    public void validate(URI endpoint,InetAddress[] addresses) {
        boolean enforceAllowlist=internalAllowlistEnabled(),allowed=!enforceAllowlist;
        boolean blockSpecial;try{blockSpecial=environment.getProperty("nebu.knowledge.block-special-addresses",Boolean.class,false);}catch(RuntimeException e){throw new ApiException(503,"知识库 block-special-addresses 必须为 true 或 false");}
        if(enforceAllowlist) {
            for(String entry:environment.getProperty("nebu.knowledge.allowed-internal-origins","").split(",")) {
                if(entry.trim().isEmpty())continue;
                URI u;
                try {u=endpoint(entry);}catch(ApiException e){throw new ApiException(503,"知识库内网白名单配置无效");}
                if(u.getPath()!=null&&!u.getPath().isEmpty()&&!"/".equals(u.getPath()))throw new ApiException(503,"知识库内网白名单仅填写协议、主机和端口");
                if(origin(u).equals(origin(endpoint)))allowed=true;
            }
        }
        if(addresses.length==0)throw new ApiException(502,"MCP 地址没有可用 IP");
        for(InetAddress address:addresses) {
            byte[] b=address.getAddress();int a=b[0]&255,s=b[1]&255;
            boolean metadata=b.length==4&&((a==100&&s==100&&(b[2]&255)==100&&(b[3]&255)==200)||(a==168&&s==63&&(b[2]&255)==129&&(b[3]&255)==16));
            metadata|=b.length==16&&a==253&&s==0&&(b[2]&255)==14&&(b[3]&255)==194;
            if(blockSpecial&&(address.isAnyLocalAddress()||address.isLinkLocalAddress()||address.isMulticastAddress()||metadata
                ||(b.length==4&&(a==0||a>=224))))throw new ApiException(422,"MCP 地址指向不允许访问的网络地址");
            boolean internal=address.isLoopbackAddress()||address.isSiteLocalAddress()||(b.length==4&&a==100&&s>=64&&s<=127)||(b.length==16&&(a&254)==252);
            if(internal&&!allowed)throw new ApiException(422,"请在 服务端 的知识库内网来源白名单中配置该 MCP 服务");
            if(blockSpecial&&b.length==16&&!internal&&((a&224)!=32||(a==32&&s==2)||(a==32&&s==1&&(b[2]&255)==0)))
                throw new ApiException(422,"MCP 地址使用不支持的 IPv6 特殊地址");
        }
    }
}
