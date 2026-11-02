package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import javax.servlet.*;
import javax.servlet.http.*;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

@Component
public class AgentBridgeFilter extends OncePerRequestFilter {
    private final AgentSettings settings;
    public AgentBridgeFilter(AgentSettings settings){this.settings=settings;}
    @Override protected void doFilterInternal(HttpServletRequest request,HttpServletResponse response,FilterChain chain)throws ServletException,IOException{
        String path=request.getRequestURI().substring(request.getContextPath().length());
        if(!path.startsWith("/internal/agent/")){chain.doFilter(request,response);return;}
        AgentSettings.Connection connection=settings.current();
        String expected="Bearer "+connection.callbackKey(),provided=request.getHeader("Authorization");
        if(!connection.configured||provided==null||!MessageDigest.isEqual(expected.getBytes(StandardCharsets.UTF_8),provided.getBytes(StandardCharsets.UTF_8))){response.setStatus(401);response.setContentType("application/json");response.getWriter().write("{\"error\":\"service_identity_required\"}");return;}
        response.setHeader("Cache-Control","no-store");chain.doFilter(request,response);
    }
}
