package cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice;

import cn.nebulaedata.cccs.nebuwork.backend.api.agent.AgentStore;
import cn.nebulaedata.cccs.nebuwork.backend.api.identity.RequestIdentity;
import cn.nebulaedata.cccs.nebuwork.backend.api.workbench.WorkbenchMapper;
import com.fasterxml.jackson.databind.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import javax.servlet.http.HttpServletRequest;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice.ServiceSupport.*;

/** Application grants are separate from engine Run grants; no caller-supplied user identity. */
@Service
public class ServiceAccess {
    public static final String PRINCIPAL=ServiceAccess.class.getName()+".principal";
    final AgentStore db;final ObjectMapper json;final WorkbenchMapper workbenches;final TransactionTemplate tx;
    private final String publicBase;
    @Value("${nebu.workbench-services.frontend-url:}") private String frontendUrl;
    public boolean sameOrigin(String origin){return origin!=null&&origin.equals(originOf(publicBase));}
    public String frontend(){require(frontendUrl!=null&&!frontendUrl.isEmpty(),503,"请配置工作台服务授权页面的前端地址");URI uri=uri(frontendUrl);require(uri.getHost()!=null&&uri.getUserInfo()==null&&uri.getQuery()==null&&uri.getFragment()==null&&Arrays.asList("http","https").contains(uri.getScheme()),503,"前端地址无效");return frontendUrl.replaceAll("/+$","");}

    public ServiceAccess(AgentStore db,ObjectMapper json,WorkbenchMapper workbenches,PlatformTransactionManager manager,@Value("${nebu.workbench-services.public-base-url:}")String base){this.db=db;this.json=json;this.workbenches=workbenches;this.tx=new TransactionTemplate(manager);this.publicBase=base.replaceAll("/+$","");}
    public static final class Principal {
        public final String owner,app,workbench;public final JsonNode scope;public final boolean browser;
        Principal(String owner,String app,String workbench,JsonNode scope,boolean browser){this.owner=owner;this.app=app;this.workbench=workbench;this.scope=scope;this.browser=browser;}
        public void allow(String wb,String group,String key){require(browser||workbench.equals(wb)&&contains(scope.path(group),key),403,"应用未授权此服务能力、页面或项目");}
    }
    public Principal principal(HttpServletRequest request){Object p=request.getAttribute(PRINCIPAL);if(p instanceof Principal)return (Principal)p;return new Principal(RequestIdentity.actor(request),"browser","",json.createObjectNode(),true);}
    public void checkOrigin(Principal p,String origin,String hostOrigin){
        if(origin!=null&&!origin.equals(originOf(publicBase)))require(!p.browser&&contains(p.scope.path("origins"),origin),403,"来源未登记");
        if(hostOrigin!=null&&!hostOrigin.equals(originOf(publicBase)))require(!p.browser&&contains(p.scope.path("origins"),hostOrigin),403,"嵌入来源未授权");
    }
    private String originOf(String value){try{URI u=new URI(value);return u.getScheme()+"://"+u.getRawAuthority();}catch(Exception e){return "";}}
    public Principal authenticate(String token){
        require(token!=null&&token.matches("[A-Za-z0-9_-]{43}"),401,"需要有效的服务访问令牌");
        Map<String,Object> row=db.one("SELECT * FROM nw_service_token WHERE token_hash=?",hash(token));
        require(row!=null&&!Boolean.TRUE.equals(row.get("revoked"))&&number(row,"expires_at")>System.currentTimeMillis(),401,"服务访问令牌已失效");
        String app=str(row,"app_id"),owner=str(row,"owner_id"),wb=str(row,"workbench_id");
        JsonNode scope=parse(json,row.get("scope_json"));
        if(!app.isEmpty()){
            Map<String,Object> current=db.one("SELECT * FROM nw_service_app WHERE id=? AND owner_id=? AND workbench_id=?",app,owner,wb);
            require(current!=null&&Boolean.TRUE.equals(current.get("enabled"))&&number(current,"revision")==number(row,"app_revision"),401,"应用授权已撤销或修订");
        }
        owned(owner,wb);
        return new Principal(owner,app.isEmpty()?"browser":app,wb,scope,app.isEmpty());
    }
    void owned(String owner,String wb){require(workbenches.workbench(owner,wb)!=null,404,"工作台不存在");}
    public Map<String,Object> token(String owner,String wb,String app,long revision,JsonNode scope){String raw=random();db.update("INSERT INTO nw_service_token(token_hash,app_id,owner_id,workbench_id,app_revision,scope_json,expires_at) VALUES(?,?,?,?,?,?,?)",hash(raw),app,owner,wb,revision,scope.toString(),System.currentTimeMillis()+600000);return map("access_token",raw,"token_type","Bearer","expires_in",600,"scope","workbench-service");}
    public String bridgeToken(String owner,String wb){owned(owner,wb);return (String)token(owner,wb,null,0,json.createObjectNode()).get("access_token");}
    public List<Object> apps(String owner,String wb){owned(owner,wb);List<Object> out=new ArrayList<>();for(Map<String,Object> a:db.rows("SELECT * FROM nw_service_app WHERE owner_id=? AND workbench_id=? ORDER BY created_at DESC",owner,wb))out.add(view(a));return out;}
    private Object view(Map<String,Object> a){return map("id",a.get("id"),"name",a.get("name"),"revision",a.get("revision"),"enabled",a.get("enabled"),"scope",parse(json,a.get("scope_json")));}
    public Object saveApp(String owner,String wb,JsonNode body){return saveApp(owner,wb,body,random());}
    public Object saveApp(String owner,String wb,JsonNode body,String requestKey){requestKey(requestKey);owned(owner,wb);fields(body,"id","revision","name","scope","enabled");String name=text(body,"name",200);JsonNode scope=body.path("scope");fields(scope,"capabilities","pages","projects","redirectUris","origins");
        for(String group:Arrays.asList("capabilities","pages","projects","redirectUris","origins")){require(scope.path(group).isArray()&&scope.path(group).size()<=100,422,"应用授权需要有限列表："+group);for(JsonNode value:scope.path(group))require(value.isTextual()&&!value.asText().isEmpty()&&value.asText().length()<2048,422,"无效授权项");}
        for(JsonNode project:scope.path("projects"))require(db.one("SELECT id FROM nw_project WHERE id=? AND owner_id=? AND workbench_id=?",project.asText(),owner,wb)!=null,403,"项目不属于当前工作台");
        for(String group:Arrays.asList("redirectUris","origins"))for(JsonNode value:scope.path(group)){URI uri=uri(value.asText());require(uri.getHost()!=null&&uri.getFragment()==null&&uri.getUserInfo()==null&&("https".equals(uri.getScheme())||"http".equals(uri.getScheme())&&Arrays.asList("localhost","127.0.0.1").contains(uri.getHost())),422,"回调和来源必须使用 HTTPS 或本机开发地址");if(group.equals("origins"))require((uri.getPath()==null||uri.getPath().isEmpty()||uri.getPath().equals("/"))&&uri.getQuery()==null,422,"来源只填写协议、主机和端口");}
        return tx.execute(status->{String app=body.path("id").asText("");String raw=random();if(app.isEmpty()){app="app-"+hash(owner+":"+wb+":"+requestKey).substring(0,48);Map<String,Object> prior=db.one("SELECT * FROM nw_service_app WHERE id=?",app);if(prior!=null){require(name.equals(str(prior,"name"))&&fingerprint(json,scope).equals(fingerprint(json,parse(json,prior.get("scope_json"))))&&body.path("enabled").asBoolean(true)==Boolean.TRUE.equals(prior.get("enabled")),409,"应用创建请求编号冲突");Map<String,Object> recovered=new LinkedHashMap<>((Map<String,Object>)view(prior));recovered.put("credentialRecoveryRequired",true);return recovered;}db.update("INSERT INTO nw_service_app(id,owner_id,workbench_id,name,secret_hash,scope_json,enabled) VALUES(?,?,?,?,?,?,?)",app,owner,wb,name,hash(raw),scope.toString(),body.path("enabled").asBoolean(true));Map<String,Object> result=new LinkedHashMap<>((Map<String,Object>)view(application(app)));result.put("clientSecret",raw);return result;}
            Map<String,Object> old=application(app);require(owner.equals(str(old,"owner_id"))&&wb.equals(str(old,"workbench_id")),404,"应用不存在");require(db.update("UPDATE nw_service_app SET name=?,scope_json=?,enabled=?,revision=revision+1 WHERE id=? AND revision=?",name,scope.toString(),body.path("enabled").asBoolean(true),app,body.path("revision").asLong(-1))==1,409,"应用授权已变化");return view(application(app));});
    }
    public Object rotate(String owner,String wb,String app,long revision){owned(owner,wb);String raw=random();require(db.update("UPDATE nw_service_app SET secret_hash=?,revision=revision+1 WHERE id=? AND owner_id=? AND workbench_id=? AND revision=?",hash(raw),app,owner,wb,revision)==1,409,"应用不存在或版本冲突");return map("clientSecret",raw,"application",view(application(app)));}
    Map<String,Object> application(String app){Map<String,Object> a=db.one("SELECT * FROM nw_service_app WHERE id=?",app);require(a!=null,401,"应用不存在");return a;}
    String base(){require(!publicBase.isEmpty(),503,"请配置工作台服务公开访问地址");URI u=uri(publicBase);require(u.getHost()!=null&&u.getUserInfo()==null&&u.getQuery()==null&&u.getFragment()==null,503,"服务公开地址配置无效");return publicBase;}
    static URI uri(String value){try{return new URI(value);}catch(Exception e){throw new cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException(422,"无效地址");}}
    public String authorize(String client,String redirect,String state,String challenge,String method,String responseType,String resource){Map<String,Object> app=application(client);require(Boolean.TRUE.equals(app.get("enabled")),403,"应用已停用");JsonNode scope=parse(json,app.get("scope_json"));require(contains(scope.path("redirectUris"),redirect),400,"回调地址未登记");require("code".equals(responseType)&&"S256".equals(method)&&challenge!=null&&challenge.matches("[A-Za-z0-9_-]{43}")&&state!=null&&state.length()>=16&&state.length()<=512,400,"需要授权码、state 和 PKCE S256");String audience=base()+"/api/workbench-services/"+str(app,"workbench_id");require(resource==null||resource.equals(audience)||resource.equals(audience+"/mcp"),400,"授权资源不匹配");String request=id();db.update("INSERT INTO nw_service_oauth_request(id,app_id,request_json,expires_at) VALUES(?,?,?,?)",request,client,json.valueToTree(map("redirectUri",redirect,"state",state,"challenge",challenge,"appRevision",app.get("revision"))).toString(),System.currentTimeMillis()+300000);return request;}
    public Object consent(String owner,String request){Map<String,Object> r=oauthRequest(request),app=application(str(r,"app_id"));require(owner.equals(str(app,"owner_id")),403,"首期仅允许当前账号自己的应用授权");require(r.get("owner_id")==null,409,"此授权请求已处理");return map("id",request,"application",view(app),"workbenchId",app.get("workbench_id"));}
    public Object decide(String owner,String request,boolean approve){return tx.execute(s->{Map<String,Object> r=db.one("SELECT * FROM nw_service_oauth_request WHERE id=? FOR UPDATE",request);consent(owner,request);JsonNode spec=parse(json,r.get("request_json"));String code=random();require(db.update("UPDATE nw_service_oauth_request SET owner_id=?,code_hash=?,expires_at=? WHERE id=? AND owner_id IS NULL",owner,approve?hash(code):"denied",System.currentTimeMillis()+60000,request)==1,409,"授权已处理");return map("redirectUri",spec.path("redirectUri").asText()+(spec.path("redirectUri").asText().contains("?")?"&":"?")+(approve?"code="+encode(code):"error=access_denied")+"&state="+encode(spec.path("state").asText()));});}
    Map<String,Object> oauthRequest(String request){Map<String,Object> r=db.one("SELECT * FROM nw_service_oauth_request WHERE id=?",request);require(r!=null&&number(r,"expires_at")>System.currentTimeMillis()&&!Boolean.TRUE.equals(r.get("consumed")),400,"授权请求已失效");return r;}
    public Object exchange(String type,String client,String secret,String code,String redirect,String verifier,String resource){return tx.execute(s->{Map<String,Object> app=application(client);require(Boolean.TRUE.equals(app.get("enabled")),401,"应用已停用");String audience=base()+"/api/workbench-services/"+str(app,"workbench_id");require(resource==null||resource.equals(audience)||resource.equals(audience+"/mcp"),400,"授权资源不匹配");
        if("client_credentials".equals(type)){require(secret!=null&&MessageDigest.isEqual(hash(secret).getBytes(StandardCharsets.US_ASCII),str(app,"secret_hash").getBytes(StandardCharsets.US_ASCII)),401,"应用凭据无效");}
        else{require("authorization_code".equals(type)&&code!=null&&verifier!=null&&verifier.matches("[A-Za-z0-9._~-]{43,128}"),400,"无效的授权码请求");Map<String,Object> r=db.one("SELECT * FROM nw_service_oauth_request WHERE app_id=? AND code_hash=? FOR UPDATE",client,hash(code));require(r!=null,400,"授权码不存在");oauthRequest(str(r,"id"));JsonNode spec=parse(json,r.get("request_json"));String challenge;try{challenge=Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(verifier.getBytes(StandardCharsets.US_ASCII)));}catch(Exception e){throw new IllegalStateException(e);}require(spec.path("redirectUri").asText().equals(redirect)&&spec.path("challenge").asText().equals(challenge)&&spec.path("appRevision").asLong()==number(app,"revision")&&str(app,"owner_id").equals(str(r,"owner_id")),400,"授权码、PKCE 或应用版本不匹配");db.update("UPDATE nw_service_oauth_request SET consumed=TRUE WHERE id=?",r.get("id"));}
        return token(str(app,"owner_id"),str(app,"workbench_id"),client,number(app,"revision"),parse(json,app.get("scope_json")));});}
    public void revoke(String token){if(token!=null)db.update("UPDATE nw_service_token SET revoked=TRUE WHERE token_hash=?",hash(token));}
    public String frameAncestors(String wb){Set<String> origins=new TreeSet<>();for(Map<String,Object> app:db.rows("SELECT scope_json FROM nw_service_app WHERE workbench_id=? AND enabled=TRUE",wb))for(JsonNode value:parse(json,app.get("scope_json")).path("origins")){try{URI uri=new URI(value.asText());if(uri.getHost()!=null&&uri.getUserInfo()==null&&Arrays.asList("http","https").contains(uri.getScheme())&&(uri.getPath()==null||uri.getPath().isEmpty()||uri.getPath().equals("/"))&&uri.getQuery()==null&&uri.getFragment()==null)origins.add(uri.getScheme()+"://"+uri.getRawAuthority());}catch(Exception ignored){}}return "'self'"+(origins.isEmpty()?"":" "+String.join(" ",origins));}
    public String challenge(String wb){try{return "Bearer resource_metadata=\""+base()+"/api/workbench-services/"+wb+"/oauth-protected-resource\"";}catch(RuntimeException e){return "Bearer";}}
    public Object metadata(String wb){String resource=base()+"/api/workbench-services/"+wb;return map("resource",resource+"/mcp","authorization_servers",Collections.singletonList(base()+"/api/service-oauth"),"scopes_supported",Collections.singletonList("workbench-service"),"bearer_methods_supported",Collections.singletonList("header"));}
    public Object issuer(){String issuer=base()+"/api/service-oauth";return map("issuer",issuer,"authorization_endpoint",issuer+"/authorize","token_endpoint",issuer+"/token","revocation_endpoint",issuer+"/revoke","response_types_supported",Collections.singletonList("code"),"grant_types_supported",Arrays.asList("authorization_code","client_credentials"),"code_challenge_methods_supported",Collections.singletonList("S256"),"token_endpoint_auth_methods_supported",Arrays.asList("client_secret_post","none"),"scopes_supported",Collections.singletonList("workbench-service"));}
    static String encode(String s){try{return URLEncoder.encode(s,"UTF-8");}catch(Exception e){throw new IllegalStateException(e);}}
}
