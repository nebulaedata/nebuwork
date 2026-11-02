package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import java.net.InetAddress;
import java.net.URI;

@Component
public class ModelNetworkPolicy {
    private final Environment environment;
    public ModelNetworkPolicy(Environment environment) { this.environment=environment; }

    public void validate(URI endpoint,InetAddress[] addresses) {
        boolean blockSpecial,enforceAllowlist;
        try { blockSpecial=environment.getProperty("nebu.models.block-special-addresses",Boolean.class,false); enforceAllowlist=environment.getProperty("nebu.models.internal-allowlist-enabled",Boolean.class,false); }
        catch(RuntimeException e) { throw new ApiException(503,"服务端模型网络限制开关必须为 true 或 false"); }
        boolean internalAllowed=!enforceAllowlist;
        if(enforceAllowlist)for(String entry:environment.getProperty("nebu.models.allowed-internal-origins","").split(",")) {
            if(entry.trim().isEmpty()) continue;
            URI allowed;
            try { allowed=ModelCredentials.normalizeUrl(entry.trim()); }
            catch(ApiException e) { throw new ApiException(503,"服务端 模型内网白名单必须为完整来源地址"); }
            if(!allowed.getPath().isEmpty()) throw new ApiException(503,"模型内网白名单只填写协议、主机和端口，不包含路径");
            if(ModelCredentials.origin(allowed).equals(ModelCredentials.origin(endpoint))) internalAllowed=true;
        }
        if(addresses.length==0) throw new ApiException(502,"模型服务地址未解析到可用 IP");
        for(InetAddress address:addresses) {
            if(blockSpecial&&forbidden(address)) {
                byte[] ip=address.getAddress();
                boolean benchmark=ip.length==4&&(ip[0]&255)==198&&((ip[1]&255)==18||(ip[1]&255)==19);
                throw new ApiException(422,benchmark
                    ?"模型域名解析到 198.18.0.0/15 保留网段，请检查代理 Fake-IP/DNS 配置"
                    :"模型调用地址属于禁止访问的特殊网络地址");
            }
            if(internal(address)&&!internalAllowed) throw new ApiException(422,"该内网或本机模型服务未配置在 服务端 来源白名单中");
        }
    }
    static boolean internal(InetAddress address) {
        byte[] b=address.getAddress(); int a=b[0]&255, second=b[1]&255;
        return address.isLoopbackAddress()||address.isSiteLocalAddress()
            ||(b.length==4&&a==100&&second>=64&&second<=127)
            ||(b.length==16&&(a&254)==252);
    }
    static boolean forbidden(InetAddress address) {
        if(address.isAnyLocalAddress()||address.isLinkLocalAddress()||address.isMulticastAddress()) return true;
        byte[] b=address.getAddress(); int a=b[0]&255, second=b[1]&255;
        if(b.length==4) {
            int third=b[2]&255, last=b[3]&255;
            return a==0||a>=224||(a==169&&second==254)
                ||(a==100&&second==100&&third==100&&last==200)
                ||(a==168&&second==63&&third==129&&last==16)
                ||(a==192&&second==88&&third==99)
                ||(a==192&&second==0&&(third==0||third==2))
                ||(a==198&&(second==18||second==19||(second==51&&third==100)))
                ||(a==203&&second==0&&third==113);
        }
        // Deny IPv6 metadata, translation/tunnel and reserved ranges, even if allowlisted.
        if(a==253&&second==0&&(b[2]&255)==14&&(b[3]&255)==194) return true; // fd00:ec2::/32
        if(internal(address)) return false;
        return (a&224)!=32 || (a==32&&second==2)
            ||(a==32&&second==1&&(((b[2]&255)==0)||((b[2]&255)==13&&(b[3]&255)==184)));
    }
}
