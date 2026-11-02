package cn.nebulaedata.cccs.nebuwork.backend.api.agent;
import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import java.net.*;
import java.util.Locale;

final class AgentEndpoint {
    static String normalize(String value){
        try{URI u=new URI(value.trim());String scheme=u.getScheme()==null?"":u.getScheme().toLowerCase(Locale.ROOT);
            if(!("http".equals(scheme)||"https".equals(scheme))||u.getHost()==null||u.getUserInfo()!=null||u.getQuery()!=null||u.getFragment()!=null||!(u.getPath().isEmpty()||"/".equals(u.getPath()))||u.getPort()==0||u.getPort()>65535)throw new IllegalArgumentException();
            int port=u.getPort();if(("http".equals(scheme)&&port==80)||("https".equals(scheme)&&port==443))port=-1;
            return new URI(scheme,null,u.getHost().toLowerCase(Locale.ROOT),port,null,null,null).toASCIIString();
        }catch(Exception e){throw new ApiException(422,"API 地址必须是 HTTP(S) 根地址，不含账号、路径、查询或片段");}
    }
    // Connections use the configured destination, including LAN, loopback and proxy Fake-IP ranges.
    static InetAddress[] resolve(String host) throws UnknownHostException {
        return InetAddress.getAllByName(host);
    }
}
