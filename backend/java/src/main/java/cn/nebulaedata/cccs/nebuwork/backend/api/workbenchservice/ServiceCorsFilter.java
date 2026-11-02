package cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import javax.servlet.*;
import javax.servlet.http.*;
import java.io.IOException;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice.ServiceSupport.*;
/** Bearer-only cross-origin access; management cookies retain the existing CSRF boundary. */
@Component @Order(Ordered.HIGHEST_PRECEDENCE+10)
public class ServiceCorsFilter extends OncePerRequestFilter {
    private final ServiceAccess access;
    public ServiceCorsFilter(ServiceAccess access){this.access=access;}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException{
        String path=request.getRequestURI().substring(request.getContextPath().length()),origin=request.getHeader("Origin");
        boolean relevant=path.startsWith("/api/workbench-services/")||path.equals("/api/service-oauth/token")||path.equals("/api/service-oauth/revoke")||path.startsWith("/.well-known/")||path.equals("/api/service-oauth/.well-known/oauth-authorization-server");
        if(origin==null||!relevant){chain.doFilter(request,response);return;}
        boolean metadata=path.contains(".well-known/")||path.endsWith("/oauth-protected-resource");
        // Report incomplete deployment configuration before comparing its origin.
        // Keep the registered-origin and unified-session boundaries unchanged.
        if(!metadata)try{access.base();}catch(cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException e){reject(response,e.status,e.getMessage());return;}
        boolean allowed=metadata||access.sameOrigin(origin);
        if(!allowed)for(Map<String,Object> app:access.db.rows("SELECT scope_json FROM nw_service_app WHERE enabled=TRUE"))if(contains(parse(access.json,app.get("scope_json")).path("origins"),origin)){allowed=true;break;}
        if(!allowed){reject(response,403,"来源未登记");return;}
        response.setHeader("Access-Control-Allow-Origin",metadata?"*":origin);response.setHeader("Vary","Origin");
        response.setHeader("Access-Control-Allow-Methods","GET, POST, HEAD, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type, Idempotency-Key, X-Host-Origin, MCP-Protocol-Version, Last-Event-ID");
        response.setHeader("Access-Control-Expose-Headers","WWW-Authenticate");
        if("OPTIONS".equals(request.getMethod())){response.setStatus(204);return;}
        chain.doFilter(request,response);
    }
    private void reject(HttpServletResponse response,int status,String message)throws IOException{
        response.setStatus(status);response.setContentType("application/json;charset=UTF-8");
        response.setHeader("Cache-Control","no-store");response.setHeader("X-Content-Type-Options","nosniff");
        access.json.writeValue(response.getOutputStream(),cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.error(status,message));
    }
}
