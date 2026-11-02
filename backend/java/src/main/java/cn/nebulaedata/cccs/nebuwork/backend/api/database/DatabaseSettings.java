package cn.nebulaedata.cccs.nebuwork.backend.api.database;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import java.net.*;
import java.util.*;

@Component
public class DatabaseSettings {
    private final Environment env;
    public DatabaseSettings(Environment env){this.env=env;}
    public boolean enabled(){return env.getProperty("nebu.databases.enabled",Boolean.class,false);}
    public void require(){if(!enabled())throw new ApiException(503,"数据库能力尚未启用");}
    public long maxBytes(){return Math.min(128,Math.max(1,env.getProperty("nebu.databases.sqlite-max-mib",Integer.class,128)))*1024L*1024;}
    public int fileBytes(){return Math.min(20,Math.max(1,env.getProperty("nebu.databases.file-max-mib",Integer.class,20)))*1024*1024;}
    public int timeout(){return Math.min(120,Math.max(1,env.getProperty("nebu.databases.query-timeout-seconds",Integer.class,20)));}
    public int maxRows(){return Math.min(10000,Math.max(1,env.getProperty("nebu.databases.query-max-rows",Integer.class,1000)));}
    public int resultBytes(){return Math.min(fileBytes(),Math.max(65536,env.getProperty("nebu.databases.query-max-bytes",Integer.class,1024*1024)));}
    /** Target restrictions are opt-in; host/port syntax and DNS remain required. */
    public void target(String host,int port){
        if(host==null||!host.matches("[A-Za-z0-9][A-Za-z0-9.-]{0,252}")||host.contains("..")||port<1||port>65535)
            throw new ApiException(422,"数据库主机或端口格式不正确");
        String target=(host+":"+port).toLowerCase(Locale.ROOT);
        Set<String> allowed=new HashSet<>();for(String entry:env.getProperty("nebu.databases.allowed-targets","").split(","))allowed.add(entry.trim().toLowerCase(Locale.ROOT));
        if(env.getProperty("nebu.databases.target-allowlist-enabled",Boolean.class,false)&&!allowed.contains("*")&&!allowed.contains(target))throw new ApiException(403,"目标数据库尚未加入服务端允许连接清单");
        try{for(InetAddress address:InetAddress.getAllByName(host))if(env.getProperty("nebu.databases.block-special-addresses",Boolean.class,false)&&(address.isAnyLocalAddress()||address.isMulticastAddress()||address.isLinkLocalAddress()))throw new ApiException(403,"不允许连接此数据库网络地址");}
        catch(UnknownHostException e){throw new ApiException(422,"数据库主机无法解析");}
    }
}
