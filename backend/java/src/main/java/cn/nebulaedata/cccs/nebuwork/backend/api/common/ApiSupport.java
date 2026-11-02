package cn.nebulaedata.cccs.nebuwork.backend.api.common;

import java.util.LinkedHashMap;
import java.util.Map;

public final class ApiSupport {
    private ApiSupport() {}
    public static Map<String,Object> map(Object... pairs) {
        Map<String,Object> result = new LinkedHashMap<>();
        for(int i=0;i<pairs.length;i+=2) result.put((String)pairs[i],pairs[i+1]);
        return result;
    }
    public static Map<String,Object> ok(Object data) { return map("code",0,"data",data,"msg","成功"); }
    public static Map<String,Object> error(int status,String msg) { return map("code",status,"data",null,"msg",msg); }
}
