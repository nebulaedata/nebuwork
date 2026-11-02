package cn.nebulaedata.cccs.nebuwork.backend.api.workflow;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.*;
import org.apache.http.entity.ByteArrayEntity;
import org.apache.http.impl.client.*;
import org.springframework.stereotype.Component;
import javax.annotation.PreDestroy;
import java.io.*;
import java.net.URI;
import java.util.concurrent.*;

/** Server credentials never inherit cookies, redirects or browser-provided origins. */
@Component
public class WorkflowClient {
    private final ObjectMapper json;
    private final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor(r->{Thread t=new Thread(r,"workflow-http-deadline");t.setDaemon(true);return t;});
    public WorkflowClient(ObjectMapper json) { this.json=json; }
    @PreDestroy public void close() { deadlines.shutdownNow(); }
    public static class Failure extends ApiException {
        public Failure(int upstream,String message) { super(upstream==404?404:upstream==409?409:upstream==422?422:502,message); }
    }
    public JsonNode request(WorkflowSettings.Connection c,String method,String path,Object body) {
        byte[] bytes=exchange(c,method,path,body,null);
        try { return bytes.length==0?json.createObjectNode():json.readTree(bytes); }
        catch(IOException e) { throw new Failure(502,"Workflow 返回了无效的接口数据"); }
    }
    public void download(WorkflowSettings.Connection c,String path,OutputStream output) { exchange(c,"GET",path,null,output); }
    private byte[] exchange(WorkflowSettings.Connection c,String method,String path,Object body,OutputStream stream) {
        if(path==null||!path.startsWith("/api/v1/")||path.contains("\\")||path.contains("\r")||path.contains("\n")) throw new Failure(422,"无效 Workflow 接口路径");
        HttpRequestBase request="POST".equals(method)?new HttpPost():"PUT".equals(method)?new HttpPut():new HttpGet();
        request.setURI(URI.create(WorkflowEndpoint.normalize(c.baseUrl)).resolve(path));
        request.setConfig(RequestConfig.custom().setConnectTimeout(Math.min(c.timeoutMs,3000)).setSocketTimeout(c.timeoutMs).setConnectionRequestTimeout(c.timeoutMs).build());
        String secret=c.apiKey();if(!secret.isEmpty())request.setHeader("Authorization","Bearer "+secret);
        request.setHeader("Accept",stream==null?"application/json":"application/octet-stream");
        ScheduledFuture<?> timer=deadlines.schedule(request::abort,stream==null?c.timeoutMs:Math.max(c.timeoutMs,300000),TimeUnit.MILLISECONDS);
        try(CloseableHttpClient client=HttpClients.custom().setDnsResolver(WorkflowEndpoint::resolve).disableAutomaticRetries().disableRedirectHandling().disableCookieManagement().build()) {
            if(body!=null) { ((HttpEntityEnclosingRequestBase)request).setEntity(new ByteArrayEntity(json.writeValueAsBytes(body)));request.setHeader("Content-Type","application/json"); }
            try(CloseableHttpResponse response=client.execute(request)) {
                int status=response.getStatusLine().getStatusCode();
                if(status<200||status>=300) {
                    String detail="";
                    if(response.getEntity()!=null)try(InputStream input=response.getEntity().getContent()) {
                        JsonNode error=json.readTree(read(input,16384));detail=error.path("detail").isTextual()?error.path("detail").asText():"参数或流程校验失败";
                    }catch(Exception ignored) { detail=""; }
                    if(!secret.isEmpty())detail=detail.replace(secret,"[已隐藏]");
                    if(status==401||status==403)detail="访问认证失败，请联系管理员检查访问密钥和可信 Host";
                    throw new Failure(status,"Workflow 服务请求失败（"+status+"）"+(detail.isEmpty()?"":"："+detail.substring(0,Math.min(detail.length(),1000))));
                }
                if(response.getEntity()==null)return new byte[0];
                try(InputStream input=response.getEntity().getContent()) {
                    if(stream==null)return read(input,8*1024*1024);
                    byte[] buffer=new byte[8192];int count;while((count=input.read(buffer))!=-1)stream.write(buffer,0,count);return new byte[0];
                }
            }
        } catch(ApiException e) { throw e; }
        catch(Exception e) { throw new Failure(0,"Workflow 服务不可达或请求超时，请检查接入配置；重试会沿用原操作"); }
        finally { timer.cancel(false);request.releaseConnection(); }
    }
    private byte[] read(InputStream input,int limit) throws IOException {
        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int count;
        while((count=input.read(buffer))!=-1) { if(out.size()+count>limit)throw new Failure(502,"Workflow 响应超过大小限制");out.write(buffer,0,count); }return out.toByteArray();
    }
}
