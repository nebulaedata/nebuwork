package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.node.*;
import org.apache.http.Header;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.*;
import org.apache.http.entity.ContentType;
import org.apache.http.entity.StringEntity;
import org.apache.http.impl.client.*;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import javax.annotation.PreDestroy;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Function;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** A bounded, read-only 2025-11-25 Streamable HTTP client. No browser credentials or redirects. */
@Component
public class KnowledgeMcpClient {
    private static final String VERSION="2025-11-25";
    private static final int MAX_BYTES=8*1024*1024;
    private final ObjectMapper json;
    private final Environment environment;
    private final KnowledgeNetworkPolicy policy;
    private final Semaphore slots=new Semaphore(8);
    private final ThreadPoolExecutor dns=new ThreadPoolExecutor(4,4,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<Runnable>(16),daemon("knowledge-dns"),new ThreadPoolExecutor.AbortPolicy());
    private final ScheduledThreadPoolExecutor timers=new ScheduledThreadPoolExecutor(1,daemon("knowledge-timeout"));
    public KnowledgeMcpClient(ObjectMapper json,Environment environment,KnowledgeNetworkPolicy policy){this.json=json;this.environment=environment;this.policy=policy;timers.setRemoveOnCancelPolicy(true);}
    private static ThreadFactory daemon(String name){return action->{Thread t=new Thread(action,name);t.setDaemon(true);return t;};}
    @PreDestroy public void close(){dns.shutdownNow();timers.shutdownNow();}
    public <T> T execute(String url,Map<String,String> headers,Function<Session,T> action) {
        if(!slots.tryAcquire())throw new ApiException(503,"知识库请求繁忙，请稍后重试");
        try {
            int timeout;
            try{timeout=environment.getProperty("nebu.knowledge.request-timeout-ms",Integer.class,60000);}
            catch(RuntimeException e){throw new ApiException(503,"知识库超时配置必须为整数毫秒");}
            if(timeout<100||timeout>120000)throw new ApiException(503,"知识库超时配置必须在 100～120000 毫秒之间");
            long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(timeout);
            URI endpoint=KnowledgeNetworkPolicy.endpoint(url);
            Future<InetAddress[]> lookup=dns.submit(()->InetAddress.getAllByName(endpoint.getHost()));
            InetAddress[] addresses;
            try{addresses=lookup.get(remaining(deadline),TimeUnit.MILLISECONDS);}finally{lookup.cancel(true);}
            policy.validate(endpoint,addresses);
            try(CloseableHttpClient client=HttpClients.custom().setDnsResolver(host->{
                if(!endpoint.getHost().replace("[","").replace("]","").equalsIgnoreCase(host.replace("[","").replace("]","")))throw new UnknownHostException("Unexpected host");
                return addresses.clone();
            }).disableRedirectHandling().disableAutomaticRetries().disableCookieManagement().disableContentCompression().disableAuthCaching().build()) {
                Session session=new Session(client,endpoint,headers,deadline);
                try{session.initialize();return action.apply(session);}finally{session.finish();}
            }
        }catch(ApiException e){throw e;}
        catch(TimeoutException|InterruptedIOException e){throw new ApiException(504,"知识库请求超时");}
        catch(InterruptedException e){Thread.currentThread().interrupt();throw new ApiException(503,"知识库请求已中断");}
        catch(RejectedExecutionException e){throw new ApiException(503,"知识库地址解析繁忙");}
        catch(Exception e){throw new ApiException(502,"无法连接知识库 MCP，请检查地址、网络、认证和响应格式");}
        finally{slots.release();}
    }
    private static int remaining(long deadline) {
        long n=deadline-System.nanoTime();if(n<=0)throw new ApiException(504,"知识库请求超时");
        return (int)Math.max(1,TimeUnit.NANOSECONDS.toMillis(n));
    }
    public final class Session {
        private final CloseableHttpClient client;private final URI endpoint;private final Map<String,String> headers;private final long deadline;
        private long nextId=0;private String protocol=VERSION;private String sessionId;private boolean initialized=false;private int bytes=0,retries=0;
        Session(CloseableHttpClient client,URI endpoint,Map<String,String> headers,long deadline){this.client=client;this.endpoint=endpoint;this.headers=headers;this.deadline=deadline;}
        void initialize() {
            JsonNode result=rpc("initialize",map("protocolVersion",VERSION,"capabilities",map(),"clientInfo",map("name","nebuwork-knowledge","version","1.0.0")),false);
            protocol=result.path("protocolVersion").asText();
            if(!Arrays.asList(VERSION,"2025-06-18","2025-03-26").contains(protocol))throw new ApiException(502,"知识库协商了尚不支持的 MCP 协议版本");
            initialized=true;rpc("notifications/initialized",map(),true);
        }
        public JsonNode tools() {
            ArrayNode tools=json.createArrayNode();String cursor="";Set<String> cursors=new HashSet<>();
            for(int page=0;page<20;page++){
                JsonNode result=rpc("tools/list",cursor.isEmpty()?map():map("cursor",cursor),false);
                if(!result.path("tools").isArray())throw new ApiException(502,"MCP 工具目录格式无效");
                result.path("tools").forEach(tools::add);
                cursor=result.path("nextCursor").asText("");if(cursor.isEmpty())return tools;
                if(!cursors.add(cursor))break;
            }
            throw new ApiException(502,"MCP 工具目录分页异常");
        }
        public JsonNode callRaw(String name,JsonNode arguments) {return rpc("tools/call",map("name",name,"arguments",arguments),false);}
        public JsonNode call(String name,Map<String,Object> arguments) {
            JsonNode result=rpc("tools/call",map("name",name,"arguments",arguments),false);
            if(result.path("isError").asBoolean())throw new ApiException(502,"知识库工具执行失败："+name);
            StringBuilder text=new StringBuilder();
            for(JsonNode item:result.path("content"))if("text".equals(item.path("type").asText())){
                if(text.length()>0)text.append('\n');text.append(item.path("text").asText());
            }
            try{JsonNode body=json.readTree(text.toString());if(body==null||!body.isObject())throw new IOException();return body;}
            catch(IOException e){throw new ApiException(502,"知识库工具未返回有效的业务 JSON");}
        }
        private JsonNode rpc(String method,Object params,boolean notification) {
            long id=++nextId;
            ObjectNode body=json.valueToTree(map("jsonrpc","2.0","method",method,"params",params));
            if(!notification)body.put("id",id);
            while(true) {
                HttpPost request=new HttpPost(endpoint);
                request.setEntity(new StringEntity(body.toString(),ContentType.APPLICATION_JSON));
                configure(request);
                ScheduledFuture<?> abort=timers.schedule(request::abort,remaining(deadline),TimeUnit.MILLISECONDS);
                try(CloseableHttpResponse response=client.execute(request)){
                    int status=response.getStatusLine().getStatusCode();
                    if(status==503&&retries<2&&!"tools/call".equals(method)){
                        retries++;long delay=2000;Header retry=response.getFirstHeader("Retry-After");
                        if(retry!=null)try{delay=Math.max(0,Math.min(5000,Long.parseLong(retry.getValue())*1000));}catch(NumberFormatException ignored){}
                        if(delay>=remaining(deadline))throw new ApiException(504,"知识库服务未在时限内就绪");
                        response.close();Thread.sleep(delay);continue;
                    }
                    if(status<200||status>=300){
                        if(status==503)throw new ApiException(503,"知识库 Worker 暂不可用（上游 503），请稍后重试");
                        throw new ApiException(502,status==404?"知识库 MCP 不存在或尚未启用（上游 404）":status==401||status==403?"知识库代理认证失败（上游 "+status+"）":"知识库 MCP 请求失败（上游 "+status+"）");
                    }
                    if("initialize".equals(method)){
                        Header session=response.getFirstHeader("Mcp-Session-Id");
                        if(session!=null){sessionId=session.getValue();if(!sessionId.matches("[\\x21-\\x7E]{1,512}"))throw new ApiException(502,"MCP 会话标识无效");}
                    }
                    if(notification)return NullNode.getInstance();
                    if(response.getEntity()==null)throw new ApiException(502,"知识库 MCP 返回空响应");
                    Header content=response.getEntity().getContentType();
                    String type=content==null?"":content.getValue().toLowerCase(Locale.ROOT);
                    try(InputStream stream=response.getEntity().getContent()){
                        if(type.startsWith("text/event-stream"))return readSse(stream,id);
                        if(!type.startsWith("application/json"))throw new ApiException(502,"知识库 MCP 响应类型不支持");
                        ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;
                        while((n=stream.read(buffer))!=-1){addBytes(n);remaining(deadline);out.write(buffer,0,n);}
                        return result(json.readTree(out.toByteArray()),id);
                    }
                }catch(ApiException e){throw e;}
                catch(InterruptedException e){Thread.currentThread().interrupt();throw new ApiException(503,"知识库请求已中断");}
                catch(InterruptedIOException e){throw new ApiException(504,"知识库请求超时");}
                catch(IOException e){remaining(deadline);throw new ApiException(502,"知识库 MCP 连接或响应读取失败");}
                finally{abort.cancel(false);}
            }
        }
        private void addBytes(int count){bytes+=count;if(bytes>MAX_BYTES)throw new ApiException(502,"知识库响应累计超过 8 MiB");}
        private JsonNode readSse(InputStream input,long id)throws IOException {
            InputStream bounded=new FilterInputStream(input){
                @Override public int read()throws IOException{int b=super.read();if(b!=-1)addBytes(1);return b;}
                @Override public int read(byte[] b,int off,int len)throws IOException{int n=in.read(b,off,len);if(n>0)addBytes(n);return n;}
            };
            BufferedReader reader=new BufferedReader(new InputStreamReader(bounded,StandardCharsets.UTF_8));
            String line;StringBuilder data=new StringBuilder();
            while((line=reader.readLine())!=null){
                remaining(deadline);
                if(line.isEmpty()){
                    JsonNode match=event(data,id);data.setLength(0);if(match!=null)return match;
                }else if(line.startsWith("data:")){if(data.length()>0)data.append('\n');data.append(line.substring(5).replaceFirst("^ ",""));}
            }
            JsonNode match=event(data,id);if(match!=null)return match;
            throw new ApiException(502,"知识库 SSE 未返回对应请求结果");
        }
        private JsonNode event(StringBuilder data,long id)throws IOException {
            if(data.length()==0)return null;JsonNode node=json.readTree(data.toString());
            if(node!=null&&node.path("id").isIntegralNumber()&&node.path("id").asLong()==id)return result(node,id);
            return null; // Ignore progress notifications, never treat them as the tool response.
        }
        private JsonNode result(JsonNode node,long id){
            if(node==null||!"2.0".equals(node.path("jsonrpc").asText())||!node.path("id").isIntegralNumber()||node.path("id").asLong()!=id)
                throw new ApiException(502,"知识库 JSON-RPC 响应标识不匹配");
            if(node.has("error"))throw new ApiException(502,"知识库 JSON-RPC 错误");
            if(!node.has("result"))throw new ApiException(502,"知识库 JSON-RPC 缺少结果");return node.get("result");
        }
        private void configure(HttpRequestBase request){
            int timeout=remaining(deadline);
            request.setConfig(RequestConfig.custom().setConnectTimeout(timeout).setConnectionRequestTimeout(timeout).setSocketTimeout(timeout).build());
            request.setHeader("Accept","application/json, text/event-stream");request.setHeader("Accept-Encoding","identity");
            headers.forEach(request::setHeader);
            if(initialized)request.setHeader("MCP-Protocol-Version",protocol);
            if(sessionId!=null)request.setHeader("Mcp-Session-Id",sessionId);
        }
        private void finish(){
            if(sessionId==null||deadline<=System.nanoTime())return;
            HttpDelete request=new HttpDelete(endpoint);
            try{configure(request);ScheduledFuture<?> abort=timers.schedule(request::abort,Math.min(1000,remaining(deadline)),TimeUnit.MILLISECONDS);
                try(CloseableHttpResponse ignored=client.execute(request)){}finally{abort.cancel(false);}
            }catch(Exception ignored){/* Stateless servers need no DELETE; 405 is also valid. */}
        }
    }
}
