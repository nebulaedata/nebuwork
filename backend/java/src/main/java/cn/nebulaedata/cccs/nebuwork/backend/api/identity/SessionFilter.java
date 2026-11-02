package cn.nebulaedata.cccs.nebuwork.backend.api.identity;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.dao.DataAccessException;
import org.springframework.web.filter.OncePerRequestFilter;
import javax.servlet.*;
import javax.servlet.http.*;
import java.io.IOException;
import java.net.URI;
import java.net.URLDecoder;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.error;

@Component
public class SessionFilter extends OncePerRequestFilter {
    @org.springframework.beans.factory.annotation.Autowired
    private org.springframework.beans.factory.ObjectProvider<cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice.ServiceAccess> serviceAccess;
    private final ObjectMapper json;
    private final AccountSessionStore sessions;
    private final Set<String> allowedOrigins = new HashSet<>();
    public SessionFilter(ObjectMapper json,AccountSessionStore sessions,@Value("${nebu.auth.allowed-origins:}") String origins) {
        this.json=json;
        this.sessions=sessions;
        for(String origin:origins.split(",")) if(!origin.trim().isEmpty()) allowedOrigins.add(origin.trim());
    }
    @Override protected void doFilterInternal(HttpServletRequest req,HttpServletResponse res,FilterChain chain) throws ServletException,IOException {
        String path=req.getRequestURI().substring(req.getContextPath().length());
        if(!path.startsWith("/api/")) { chain.doFilter(req,res); return; }
        res.setHeader("Cache-Control","no-store"); res.setHeader("X-Content-Type-Options","nosniff");
        boolean servicePath=path.matches("/api/workbench-services/[A-Za-z0-9_-]{1,128}/.*");
        boolean publicService="GET".equals(req.getMethod())&&(path.matches("/api/workbench-services/[A-Za-z0-9_-]{1,128}/(pages/[A-Za-z][A-Za-z0-9_-]{0,79}|host\\.js|page-sdk\\.js|oauth-protected-resource)")||path.equals("/api/service-oauth/.well-known/oauth-authorization-server")||path.equals("/api/service-oauth/authorize"));
        boolean publicToken="POST".equals(req.getMethod())&&(path.equals("/api/service-oauth/token")||path.equals("/api/service-oauth/revoke"));
        if(publicService||publicToken){chain.doFilter(req,res);return;}
        String bearer=req.getHeader("Authorization");
        if(servicePath&&bearer!=null&&bearer.startsWith("Bearer ")) {
            try {
                cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice.ServiceAccess access=serviceAccess.getObject();
                cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice.ServiceAccess.Principal principal=access.authenticate(bearer.substring(7));
                access.checkOrigin(principal,req.getHeader("Origin"),req.getHeader("X-Host-Origin"));
                req.setAttribute(cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice.ServiceAccess.PRINCIPAL,principal);
                req.setAttribute(RequestIdentity.ACTOR,principal.owner);
                chain.doFilter(req,res);
            } catch(cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException e) {
                if(e.status==401)res.setHeader("WWW-Authenticate",serviceAccess.getObject().challenge(path.split("/")[3]));
                reject(res,e.status,e.getMessage());
            }
            return;
        }
        boolean read=Arrays.asList("GET","HEAD","OPTIONS").contains(req.getMethod());
        // An explicit wildcard disables origin/Fetch-Metadata checks only.
        // Account session authentication below is still required for protected APIs.
        if(!read&&!allowedOrigins.contains("*")) {
            String origin=req.getHeader("Origin");
            boolean bad="cross-site".equals(req.getHeader("Sec-Fetch-Site"));
            if(origin!=null) bad|=!isAllowedOrigin(origin,req);
            if(bad) { reject(res,403,"不允许跨站写入"); return; }
        }
        boolean publicRoute=("GET".equals(req.getMethod())&&(path.equals("/api/health")||path.equals("/api/auth/public-key")))
            ||("POST".equals(req.getMethod())&&(path.equals("/api/auth/login")||path.equals("/api/auth/logout")));
        if(!publicRoute) {
            String actor=null;
            try {
                for(String token:tokens(req)) {
                    actor=sessions.findActor(token);
                    if(actor!=null) break;
                }
            } catch(DataAccessException e) {
                reject(res,503,"登录会话服务暂不可用，请稍后重试"); return;
            }
            if(actor==null) { if(servicePath)res.setHeader("WWW-Authenticate",serviceAccess.getObject().challenge(path.split("/")[3]));reject(res,401,"请先登录"); return; }
            req.setAttribute(RequestIdentity.ACTOR,actor);
        }
        chain.doFilter(req,res);
    }
    private Set<String> tokens(HttpServletRequest request) {
        Set<String> candidates=new LinkedHashSet<>();
        addHeaders(candidates,request,"token");
        addHeaders(candidates,request,"sessionKey");
        Enumeration<String> cookies=request.getHeaders("Cookie");
        while(cookies.hasMoreElements()) {
            for(String part:cookies.nextElement().split(";\\s*")) {
                String[] pair=part.trim().split("=",2);
                if(pair.length!=2||!AccountSessionStore.COOKIE_NAME.equals(pair[0])) continue;
                try { addToken(candidates,URLDecoder.decode(pair[1],"UTF-8")); }
                catch(IllegalArgumentException | java.io.UnsupportedEncodingException ignored) { /* Invalid cookie. */ }
            }
        }
        return candidates;
    }
    public boolean stillAuthenticated(HttpServletRequest request,String actor) {
        for(String token:tokens(request)) if(actor.equals(sessions.findActor(token))) return true;
        return false;
    }
    private void addHeaders(Set<String> candidates,HttpServletRequest request,String name) {
        Enumeration<String> values=request.getHeaders(name);
        while(values.hasMoreElements()) addToken(candidates,values.nextElement());
    }
    private void addToken(Set<String> candidates,String token) {
        if(token!=null&&!token.trim().isEmpty()&&token.length()<=4096&&candidates.size()<16) candidates.add(token.trim());
    }
    private boolean isAllowedOrigin(String origin,HttpServletRequest request) {
        try {
            URI uri=URI.create(origin);
            if(uri.getHost()==null || uri.getUserInfo()!=null || uri.getRawQuery()!=null || uri.getRawFragment()!=null
                || (uri.getRawPath()!=null&&!uri.getRawPath().isEmpty())
                || !("http".equalsIgnoreCase(uri.getScheme())||"https".equalsIgnoreCase(uri.getScheme()))) return false;
            String localOrigin=request.getScheme()+"://"+request.getHeader("Host");
            return origin.equalsIgnoreCase(localOrigin)||allowedOrigins.contains(origin);
        } catch(IllegalArgumentException e) { return false; }
    }
    private void reject(HttpServletResponse response,int status,String msg) throws IOException {
        response.setStatus(status); response.setContentType("application/json;charset=UTF-8");
        json.writeValue(response.getOutputStream(),error(status,msg));
    }
}
