package cn.nebulaedata.cccs.nebuwork.backend.api.agent;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.*;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.entity.ByteArrayEntity;
import org.apache.http.impl.client.*;
import org.apache.http.impl.conn.PoolingHttpClientConnectionManager;
import org.apache.http.util.EntityUtils;
import org.springframework.stereotype.Component;
import javax.annotation.PreDestroy;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.servlet.http.HttpServletResponse;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Every attempt uses one immutable configuration and the original idempotency key. */
@Component
public class AgentClient {
    private final AgentSettings settings;private final ObjectMapper json;private final CloseableHttpClient http;
    private final AtomicInteger next=new AtomicInteger();
    public AgentClient(AgentSettings settings,ObjectMapper json){
        this.settings=settings;this.json=json;
        http=HttpClients.custom().setDnsResolver(AgentEndpoint::resolve).setMaxConnTotal(100).setMaxConnPerRoute(100)
            .disableAutomaticRetries().disableRedirectHandling().build();
    }
    @PreDestroy public void close()throws IOException{http.close();}
    public static String segment(String id){if(id==null||!id.matches("[A-Za-z0-9_.:-]{1,128}"))throw new ApiException(422,"无效的资源编号");return id;}
    private String base64(byte[] bytes){return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);}
    public String token(String owner,String project){return token(settings.current(),owner,project,false);}
    private String token(AgentSettings.Connection c,String owner,String project,boolean admin){
        c.require();try{
            long now=System.currentTimeMillis()/1000;
            String header=base64("{\"alg\":\"HS256\",\"typ\":\"JWT\"}".getBytes(StandardCharsets.UTF_8));
            String claims=base64(json.writeValueAsBytes(map("iss","nebuwork","aud","nebu-agent-engine","sub",admin?"nebuwork-configuration":"nebuwork-java","iat",now,"exp",now+300,"tenantId",c.namespace,"ownerId",owner,"projects",admin?Collections.emptyList():Collections.singletonList(project==null?"*":project),"scopes",admin?Arrays.asList("engine:read","engine:admin"):Arrays.asList("engine:read","engine:write"))));
            Mac mac=Mac.getInstance("HmacSHA256");mac.init(new SecretKeySpec(c.signingKey().getBytes(StandardCharsets.UTF_8),"HmacSHA256"));
            return header+"."+claims+"."+base64(mac.doFinal((header+"."+claims).getBytes(StandardCharsets.UTF_8)));
        }catch(Exception e){throw new ApiException(503,"引擎服务身份生成失败");}
    }
    private RequestConfig timeout(AgentSettings.Connection c){return RequestConfig.custom().setConnectTimeout(Math.min(3000,c.timeoutMs)).setConnectionRequestTimeout(3000).setSocketTimeout(c.timeoutMs).build();}
    private List<String> order(AgentSettings.Connection c){List<String> urls=new ArrayList<>(c.urls);Collections.rotate(urls,-Math.floorMod(next.getAndIncrement(),urls.size()));return urls;}
    private boolean unavailable(int status){return status==502||status==503||status==504;}
    private CloseableHttpResponse open(AgentSettings.Connection c,String owner,String project,String method,String path,Object body,String key,Map<String,String> headers)throws IOException{
        c.require();if(!path.startsWith("/v1/"))throw new IllegalArgumentException("Versioned engine path required");
        String encoded=body==null?null:json.writeValueAsString(body),jwt=token(c,owner,project,false);
        List<String> urls=order(c);boolean replayable="GET".equals(method)||("POST".equals(method)&&key!=null&&!key.isEmpty());
        for(int i=0;i<urls.size();i++){
            HttpRequestBase request;
            if("POST".equals(method)){HttpPost post=new HttpPost(urls.get(i)+path);post.setEntity(new StringEntity(encoded==null?"null":encoded,ContentType.APPLICATION_JSON));request=post;}
            else request=new HttpGet(urls.get(i)+path);
            request.setConfig(timeout(c));request.setHeader("Authorization","Bearer "+jwt);
            if(key!=null)request.setHeader("Idempotency-Key",key);
            if(!c.clusterId.isEmpty())request.setHeader("X-Engine-Cluster-Id",c.clusterId);
            if(!c.storageId.isEmpty())request.setHeader("X-Engine-Storage-Id",c.storageId);
            headers.forEach(request::setHeader);
            try{CloseableHttpResponse response=http.execute(request);
                if(replayable&&i+1<urls.size()&&unavailable(response.getStatusLine().getStatusCode())){response.close();continue;}
                return response;
            }catch(IOException e){if(!replayable||i+1==urls.size())throw e;}
        }throw new IOException("No engine endpoint available");
    }
    private JsonNode read(CloseableHttpResponse response)throws IOException{
        int status=response.getStatusLine().getStatusCode();String content=EntityUtils.toString(response.getEntity(),StandardCharsets.UTF_8);JsonNode result=json.readTree(content);
        if(status<200||status>=300)throw new ApiException(status>=500?502:status,result.path("error").path("message").asText("智能体引擎请求失败"));return result;
    }
    public JsonNode get(String owner,String project,String path){return request(owner,project,"GET",path,null,null);}
    /** A binary part is never automatically replayed; recover using its upload ID. */
    public JsonNode filePart(String owner,String project,String upload,int number,String digest,InputStream input,long length){
        if(length<0||length>16L*1024*1024||digest==null||!digest.matches("[a-f0-9]{64}"))throw new ApiException(422,"文件分块无效");
        AgentSettings.Connection c=settings.current();c.require();HttpPost r=new HttpPost(order(c).get(0)+"/v1/file-uploads/"+segment(upload)+"/parts/"+number);
        r.setConfig(RequestConfig.custom().setConnectTimeout(3000).setConnectionRequestTimeout(3000).setSocketTimeout(120000).build());r.setHeader("Authorization","Bearer "+token(c,owner,project,false));r.setHeader("X-Part-Sha256",digest);r.setHeader("X-Engine-Cluster-Id",c.clusterId);r.setHeader("X-Engine-Storage-Id",c.storageId);
        r.setHeader("Idempotency-Key","part:"+upload+":"+number+":"+digest);
        r.setEntity(new org.apache.http.entity.InputStreamEntity(input,length,ContentType.APPLICATION_OCTET_STREAM));
        try(CloseableHttpResponse response=http.execute(r)){return read(response);}catch(ApiException e){throw e;}catch(IOException e){throw new ApiException(502,"分块结果不确定，请查询原上传会话");}
    }
    public void fileStream(String owner,String project,String path,String range,HttpServletResponse output)throws IOException{
        Map<String,String> headers=new HashMap<>();if(range!=null)headers.put("Range",range);
        try(CloseableHttpResponse response=open(settings.current(),owner,project,"GET",path,null,null,headers)){
            int status=response.getStatusLine().getStatusCode();if(status!=200&&status!=206&&status!=304&&status!=416){read(response);return;}
            output.setStatus(status);for(String h:Arrays.asList("Content-Type","Content-Length","Content-Range","ETag","Accept-Ranges"))if(response.containsHeader(h))output.setHeader(h,response.getFirstHeader(h).getValue());
            output.setHeader("Content-Disposition","inline");output.setHeader("Cache-Control","private, no-store");output.setHeader("X-Content-Type-Options","nosniff");if(response.getEntity()!=null)response.getEntity().writeTo(output.getOutputStream());
        }catch(org.apache.catalina.connector.ClientAbortException closed){/* Closing the reader also closes the upstream stream. */}
    }
    public JsonNode post(String owner,String project,String path,Object body,String key){return request(owner,project,"POST",path,body,key);}
    public JsonNode request(String owner,String project,String method,String path,Object body,String key){
        AgentSettings.Connection c=settings.current();
        try(CloseableHttpResponse response=open(c,owner,project,method,path,body,key,Collections.emptyMap())){return read(response);}
        catch(ApiException e){throw e;}catch(IOException e){throw new ApiException(502,"智能体引擎暂不可用，请稍后重试同一请求");}
    }
    private JsonNode inspectAt(AgentSettings.Connection c,String url,String path)throws IOException{
        HttpGet request=new HttpGet(AgentEndpoint.normalize(url)+path);request.setConfig(timeout(c));request.setHeader("Authorization","Bearer "+token(c,"system-configuration",null,true));
        try(CloseableHttpResponse response=http.execute(request)){return read(response);}
    }
    public JsonNode inspect(AgentSettings.Connection c,String url){
        try{JsonNode ready=inspectAt(c,url,"/health/ready");if(!"ready".equals(ready.path("status").asText()))throw new ApiException(502,"节点存储尚未就绪");
            JsonNode capabilities=inspectAt(c,url,"/v1/capabilities");
            if(!"nebu-agent-engine".equals(capabilities.path("service").asText())||capabilities.path("integrationVersion").asInt()!=1||!capabilities.path("distributed").asBoolean())throw new ApiException(502,"节点不是支持当前协议的分布式智能体引擎");
            JsonNode cluster=inspectAt(c,url,"/v1/cluster");
            if(!capabilities.path("clusterId").asText().equals(cluster.path("clusterId").asText())||!capabilities.path("storageId").asText().equals(cluster.path("storageId").asText()))throw new ApiException(502,"节点集群身份发生变化，请重试检查");
            return json.valueToTree(map("clusterId",cluster.path("clusterId"),"storageId",cluster.path("storageId"),"workers",cluster.path("workers"),"sdkVersion",capabilities.path("sdkVersion"),"images",capabilities.path("images")));
        }catch(ApiException e){throw e;}catch(IOException e){throw new ApiException(502,"节点连接失败，请检查地址、网络和服务状态");}
    }
    public void content(String owner,String project,String artifact,Integer version,String range,String etag,HttpServletResponse output)throws IOException{
        Map<String,String> headers=new HashMap<>();if(range!=null)headers.put("Range",range);if(etag!=null)headers.put("If-None-Match",etag);
        try(CloseableHttpResponse response=open(settings.current(),owner,project,"GET","/v1/artifacts/"+segment(artifact)+"/content"+(version==null?"":"?version="+version),null,null,headers)){
            output.setStatus(response.getStatusLine().getStatusCode());
            for(String header:Arrays.asList("Content-Type","Content-Length","Content-Range","Content-Disposition","ETag","Accept-Ranges","X-Content-Type-Options"))if(response.containsHeader(header))output.setHeader(header,response.getFirstHeader(header).getValue());
            if(response.getEntity()!=null)response.getEntity().writeTo(output.getOutputStream());
        }
    }
    public byte[] contentBytes(String owner,String project,String artifact,int version){
        try(CloseableHttpResponse response=open(settings.current(),owner,project,"GET","/v1/artifacts/"+segment(artifact)+"/content?version="+version,null,null,Collections.emptyMap())){
            if(response.getStatusLine().getStatusCode()!=200)throw new ApiException(502,"专家素材读取失败，请重新发布前检查资源");
            try(InputStream input=response.getEntity().getContent();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1){if(output.size()+n>20*1024*1024)throw new ApiException(413,"专家素材超过 20 MiB");output.write(buffer,0,n);}return output.toByteArray();}
        }catch(IOException e){throw new ApiException(502,"专家素材读取失败");}
    }
    /** Dedicated bounded binary storage; never route a SQLite snapshot through artifact/base64 limits. */
    public JsonNode uploadDatabase(String owner,byte[] bytes,String digest){
        AgentSettings.Connection c=settings.current();c.require();
        if(bytes.length>128*1024*1024)throw new ApiException(413,"数据库快照超过 128 MiB");
        for(String url:order(c)){
            HttpPost request=new HttpPost(url+"/v1/database-objects");request.setConfig(timeout(c));
            request.setHeader("Authorization","Bearer "+token(c,owner,null,false));
            request.setHeader("Idempotency-Key","database-object:"+digest);request.setHeader("X-Content-Sha256",digest);
            request.setHeader("X-Engine-Cluster-Id",c.clusterId);request.setHeader("X-Engine-Storage-Id",c.storageId);
            request.setEntity(new ByteArrayEntity(bytes,ContentType.APPLICATION_OCTET_STREAM));
            try(CloseableHttpResponse response=http.execute(request)){return read(response);}
            catch(ApiException e){throw e;}catch(IOException ignored){/* Content-addressed upload is safe to retry on another API. */}
        }throw new ApiException(502,"数据库快照上传失败，原数据版本保持有效");
    }
    public byte[] databaseBytes(String owner,String digest){
        if(!digest.matches("[a-f0-9]{64}"))throw new ApiException(422,"无效的数据库快照");
        try(CloseableHttpResponse response=open(settings.current(),owner,null,"GET","/v1/database-objects/"+digest,null,null,Collections.emptyMap())){
            if(response.getStatusLine().getStatusCode()!=200)throw new ApiException(502,"数据库快照读取失败");
            try(InputStream input=response.getEntity().getContent();ByteArrayOutputStream output=new ByteArrayOutputStream()){
                byte[] buffer=new byte[65536];int n;while((n=input.read(buffer))!=-1){if(output.size()+n>128*1024*1024)throw new ApiException(413,"数据库快照超过 128 MiB");output.write(buffer,0,n);}return output.toByteArray();}
        }catch(IOException e){throw new ApiException(502,"数据库快照读取失败");}
    }
}
