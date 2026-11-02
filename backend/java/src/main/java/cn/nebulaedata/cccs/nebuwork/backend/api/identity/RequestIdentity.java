package cn.nebulaedata.cccs.nebuwork.backend.api.identity;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import javax.servlet.http.HttpServletRequest;

public final class RequestIdentity {
    static final String ACTOR = RequestIdentity.class.getName() + ".actor";
    private RequestIdentity() {}

    public static String actor(HttpServletRequest request) {
        Object actor = request.getAttribute(ACTOR);
        if (!(actor instanceof String) || ((String) actor).isEmpty()) throw new ApiException(401, "请先登录");
        return (String) actor;
    }
}
