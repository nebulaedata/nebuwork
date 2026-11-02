package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import java.net.*;

/** Admin-configured REST origins, including LAN hosts; never redirects or URL credentials. */
final class MemoryEndpoint {
    private MemoryEndpoint() {}
    static String normalize(String value) {
        try {
            URI uri=new URI(value.trim());
            String scheme=uri.getScheme()==null?"":uri.getScheme().toLowerCase(java.util.Locale.ROOT);
            if (!("http".equals(scheme)||"https".equals(scheme))||uri.getHost()==null||uri.getUserInfo()!=null
                ||uri.getQuery()!=null||uri.getFragment()!=null||!(uri.getPath().isEmpty()||"/".equals(uri.getPath()))
                ||uri.getPort()==0||uri.getPort()>65535) throw new IllegalArgumentException();
            int port=uri.getPort(); if (("http".equals(scheme)&&port==80)||("https".equals(scheme)&&port==443)) port=-1;
            return new URI(scheme,null,uri.getHost().toLowerCase(java.util.Locale.ROOT),port,null,null,null).toASCIIString();
        } catch(Exception e) { throw new ApiException(422,"请填写有效的 HTTP(S) 服务根地址，不含账号、路径、查询或片段"); }
    }
    // Connections use the configured destination, including LAN, loopback and proxy Fake-IP ranges.
    static InetAddress[] resolve(String host) throws UnknownHostException {
        return InetAddress.getAllByName(host);
    }
}
