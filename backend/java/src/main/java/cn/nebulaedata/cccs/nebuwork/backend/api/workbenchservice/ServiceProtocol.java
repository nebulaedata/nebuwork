package cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice;

import com.fasterxml.jackson.databind.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.apache.http.client.methods.*;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.*;
import java.io.*;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;
import static cn.nebulaedata.cccs.nebuwork.backend.api.workbenchservice.ServiceSupport.*;

/** SDK transport lives in New2's protocol adapter; business authorization stays in Java. */
@Service
public class ServiceProtocol {
    final ServiceAccess access;final WorkbenchServices services;final ServiceOperations operations;final String endpoint,key;
    public ServiceProtocol(ServiceAccess access,WorkbenchServices services,ServiceOperations operations,@Value("${nebu.platform-mcp.url:}")String endpoint,@Value("${nebu.platform-mcp.service-key:}")String key){this.access=access;this.services=services;this.operations=operations;this.endpoint=endpoint;this.key=key;}
    public void authenticate(String authorization){require(key.length()>=32&&authorization!=null&&MessageDigest.isEqual(("Bearer "+key).getBytes(StandardCharsets.UTF_8),authorization.getBytes(StandardCharsets.UTF_8)),401,"需要协议适配服务身份");}
    public Object execute(String token,JsonNode body){ServiceAccess.Principal p=access.authenticate(token);String wb=text(body,"workbenchId",128),action=text(body,"action",64);JsonNode args=body.path("arguments");switch(action){
        case "context":return services.manifest(p,wb,null);
        case "invoke":return operations.invoke(p,wb,text(body,"name",80),args.path("body"),text(args,"requestKey",128),"mcp");
        case "operation.get":return operations.get(p,wb,text(args,"operationId",128));
        case "operation.events":return operations.events(p,wb,text(args,"operationId",128),args.path("after").asLong(0));
        case "operation.command":return operations.command(p,wb,text(args,"operationId",128),args.path("command"),text(args,"requestKey",128));
        case "page.open":return operations.createInstance(p,wb,text(args,"pageKey",80),args.path("body"),text(args,"requestKey",128));
        case "page.get":return operations.page(p,wb,text(args,"instanceId",128));
        case "page.state":return operations.saveState(p,wb,text(args,"instanceId",128),args.path("body"));
        case "resource":Map<String,Object> release=services.active(p,wb,args.path("releaseId").asText(""));String page=text(args,"pageKey",80);p.allow(wb,"pages",page);JsonNode definition=item(parse(services.json,release.get("definition_json")),"pages",page);String html=str(services.asset(p.owner,wb,definition.path("assetId").asText()),"html");return map("html",ServicePageHtml.mcp(html,services.json.valueToTree(map("mode","mcp","pageKey",page,"releaseId",release.get("id")))),"page",definition,"releaseId",release.get("id"));
        default:throw new cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException(422,"协议动作未实现");}}
    public ResponseEntity<byte[]> proxy(ServiceAccess.Principal p,String wb,String authorization,String method,String body){services.active(p,wb,null);if(!method.equals("POST"))return ResponseEntity.status(405).header("Allow","POST").contentType(MediaType.APPLICATION_JSON).body(new byte[0]);require(body!=null&&body.length()<=1048576,413,"MCP 请求过大");require(!endpoint.isEmpty()&&key.length()>=32,503,"工作台服务 MCP 适配器尚未配置");URI uri=URI.create(endpoint);require(Arrays.asList("http","https").contains(uri.getScheme())&&uri.getUserInfo()==null&&uri.getQuery()==null&&uri.getFragment()==null&&endpoint.matches(".*/mcp/?$"),503,"MCP 适配地址无效");String target=endpoint.replaceAll("/mcp/?$","")+"/services/"+wb+"/mcp";
        try(CloseableHttpClient client=HttpClients.createDefault()){HttpPost post=new HttpPost(target);post.setConfig(RequestConfig.custom().setConnectTimeout(5000).setSocketTimeout(30000).setRedirectsEnabled(false).build());post.setHeader("Authorization",authorization==null?"Bearer "+access.bridgeToken(p.owner,wb):authorization);post.setHeader("Accept","application/json, text/event-stream");post.setEntity(new StringEntity(body,org.apache.http.entity.ContentType.APPLICATION_JSON));try(CloseableHttpResponse response=client.execute(post);InputStream in=response.getEntity()==null?new ByteArrayInputStream(new byte[0]):response.getEntity().getContent();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){require(out.size()+n<=4*1024*1024,502,"MCP 响应过大");out.write(buffer,0,n);}return ResponseEntity.status(response.getStatusLine().getStatusCode()).header("Cache-Control","no-store").header("Content-Type",response.getFirstHeader("Content-Type")==null?"application/json":response.getFirstHeader("Content-Type").getValue()).body(out.toByteArray());}}
        catch(IOException e){throw new cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException(502,"MCP 适配服务连接失败，请查询原操作后再重试");}}
}
