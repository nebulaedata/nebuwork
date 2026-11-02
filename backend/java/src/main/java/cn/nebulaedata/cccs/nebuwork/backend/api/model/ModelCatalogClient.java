package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.CloseableHttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.client.utils.URIBuilder;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClients;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import javax.annotation.PreDestroy;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Directory requests only; never sends inference or follows a redirect carrying credentials. */
@Component
public class ModelCatalogClient {
    private static final int MAX_BYTES=2*1024*1024,MAX_PAGES=20;
    private final ObjectMapper json;
    private final Environment environment;
    private final ModelNetworkPolicy policy;
    private final Semaphore slots=new Semaphore(8);
    private final ThreadPoolExecutor dns=new ThreadPoolExecutor(4,4,0,TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<Runnable>(16),daemon("model-dns"),new ThreadPoolExecutor.AbortPolicy());
    private final ScheduledThreadPoolExecutor timers=new ScheduledThreadPoolExecutor(1,daemon("model-timeout"));

    public ModelCatalogClient(ObjectMapper json,Environment environment,ModelNetworkPolicy policy) {
        this.json=json; this.environment=environment; this.policy=policy;
        timers.setRemoveOnCancelPolicy(true);
    }
    private static ThreadFactory daemon(String name) {
        return action -> { Thread t=new Thread(action,name); t.setDaemon(true); return t; };
    }
    @PreDestroy public void close() { dns.shutdownNow(); timers.shutdownNow(); }

    public Map<String,Object> fetch(ModelCredentials credentials) {
        if(!slots.tryAcquire()) throw new ApiException(503,"模型目录请求繁忙，请稍后重试");
        long started=System.nanoTime();
        try {
            int timeout;
            try { timeout=environment.getProperty("nebu.models.request-timeout-ms",Integer.class,12000); }
            catch(RuntimeException e) { throw new ApiException(503,"模型请求超时配置必须为整数毫秒"); }
            if(timeout<100||timeout>60000) throw new ApiException(503,"模型请求超时配置必须在 100～60000 毫秒之间");
            long deadline=started+TimeUnit.MILLISECONDS.toNanos(timeout);
            URI endpoint=credentials.endpoint;
            Future<InetAddress[]> lookup=dns.submit(() -> InetAddress.getAllByName(endpoint.getHost()));
            InetAddress[] addresses;
            try { addresses=lookup.get(remaining(deadline),TimeUnit.MILLISECONDS); }
            finally { lookup.cancel(true); }
            policy.validate(endpoint,addresses);
            // The validated DNS answer is pinned for every page. TLS still verifies the original hostname.
            try(CloseableHttpClient client=HttpClients.custom()
                .setDnsResolver(host -> {
                    if(!endpoint.getHost().replace("[", "").replace("]", "").equalsIgnoreCase(host.replace("[", "").replace("]", "")))
                        throw new UnknownHostException("Unexpected host");
                    return addresses.clone();
                }).disableRedirectHandling().disableAutomaticRetries().disableCookieManagement()
                .disableContentCompression().disableAuthCaching().build()) {
                SortedSet<String> models=new TreeSet<>(); Set<String> cursors=new HashSet<>();
                URI page=endpoint; int[] bytes={0};
                for(int count=0;count<MAX_PAGES;count++) {
                    JsonNode body=readPage(client,page,credentials,deadline,bytes);
                    JsonNode list=body.path("gemini".equals(credentials.type)?"models":"data");
                    if(!list.isArray()) throw new ApiException(502,"模型目录响应格式不正确");
                    for(JsonNode item:list) {
                        JsonNode name=item.isTextual()?item:item.path("gemini".equals(credentials.type)?"name":"id");
                        if(!name.isTextual()) throw new ApiException(502,"模型目录包含无效的模型标识");
                        String id=name.asText().trim();
                        if("gemini".equals(credentials.type)&&id.startsWith("models/")) id=id.substring(7);
                        if(id.isEmpty()) throw new ApiException(502,"模型目录包含空模型标识");
                        models.add(id);
                    }
                    String cursor="";
                    if("gemini".equals(credentials.type)) {
                        if(body.hasNonNull("nextPageToken")&&!body.path("nextPageToken").isTextual()) throw new ApiException(502,"模型目录分页信息不正确");
                        cursor=body.path("nextPageToken").asText("");
                    } else {
                        if(body.has("has_more")&&!body.path("has_more").isBoolean()) throw new ApiException(502,"模型目录分页信息不正确");
                        if(body.path("has_more").asBoolean(false)) {
                            // Some OpenAI-compatible services also expose cursor pagination.
                            JsonNode last=body.path("last_id");
                            if(!last.isTextual()||last.asText().isEmpty()) throw new ApiException(502,"模型目录分页信息不完整");
                            cursor=last.asText();
                        }
                    }
                    if(cursor.isEmpty()) {
                        remaining(deadline);
                        if(models.isEmpty()) throw new ApiException(502,"模型目录未返回可用模型");
                        return map("endpoint",endpoint.toASCIIString(),"models",new ArrayList<>(models),
                            "latencyMs",Math.max(1,TimeUnit.NANOSECONDS.toMillis(System.nanoTime()-started)));
                    }
                    if(!cursors.add(cursor)||count==MAX_PAGES-1) throw new ApiException(502,"模型目录分页重复或超过 20 页，未返回不完整目录");
                    page=new URIBuilder(endpoint).addParameter("gemini".equals(credentials.type)?"pageToken":"after_id",cursor).build();
                }
            }
            throw new ApiException(502,"无法读取完整模型目录");
        } catch(ApiException e) { throw e; }
        catch(TimeoutException | InterruptedIOException e) { throw new ApiException(504,"查询模型目录超时"); }
        catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new ApiException(503,"模型目录请求已中断"); }
        catch(RejectedExecutionException e) { throw new ApiException(503,"模型地址解析繁忙，请稍后重试"); }
        catch(ExecutionException | IOException | URISyntaxException e) {
            // Never pass upstream bodies, URLs containing query tokens, or request headers into errors/logs.
            throw new ApiException(502,"无法连接模型服务，请检查地址、网络和证书配置");
        } catch(RuntimeException e) {
            throw new ApiException(502,"模型目录请求处理失败，请检查服务地址和响应格式");
        } finally { slots.release(); }
    }
    private int remaining(long deadline) {
        long nanos=deadline-System.nanoTime();
        if(nanos<=0) throw new ApiException(504,"查询模型目录超时");
        return (int)Math.max(1,TimeUnit.NANOSECONDS.toMillis(nanos));
    }
    private JsonNode readPage(CloseableHttpClient client,URI page,ModelCredentials credentials,long deadline,int[] total) throws IOException {
        HttpGet request=new HttpGet(page);
        int timeout=remaining(deadline);
        request.setConfig(RequestConfig.custom().setConnectTimeout(timeout).setSocketTimeout(timeout).setConnectionRequestTimeout(timeout).build());
        request.setHeader("Accept","application/json"); request.setHeader("Accept-Encoding","identity");
        if("anthropic".equals(credentials.type)) {
            request.setHeader("x-api-key",credentials.apiKey); request.setHeader("anthropic-version","2023-06-01");
        } else if("gemini".equals(credentials.type)) request.setHeader("x-goog-api-key",credentials.apiKey);
        else request.setHeader("Authorization","Bearer "+credentials.apiKey);
        AtomicBoolean timedOut=new AtomicBoolean();
        ScheduledFuture<?> abort=timers.schedule(() -> { timedOut.set(true); request.abort(); },remaining(deadline),TimeUnit.MILLISECONDS);
        try(CloseableHttpResponse response=client.execute(request)) {
            int status=response.getStatusLine().getStatusCode();
            if(status<200||status>=300) {
                String reason=status==401||status==403?"模型服务拒绝凭据或权限":status==429?"模型服务请求受限":"模型服务请求失败";
                throw new ApiException(502,reason+"（上游 HTTP "+status+"）");
            }
            if(response.getEntity()==null) throw new ApiException(502,"模型服务未返回目录");
            long size=response.getEntity().getContentLength();
            if(size>MAX_BYTES-total[0]) throw new ApiException(502,"模型目录累计响应超过 2 MiB");
            try(InputStream input=response.getEntity().getContent(); ByteArrayOutputStream output=new ByteArrayOutputStream()) {
                byte[] buffer=new byte[8192]; int read;
                while((read=input.read(buffer))!=-1) {
                    remaining(deadline); total[0]+=read;
                    if(total[0]>MAX_BYTES) { request.abort(); throw new ApiException(502,"模型目录累计响应超过 2 MiB"); }
                    output.write(buffer,0,read);
                }
                try {
                    JsonNode body=json.reader().with(com.fasterxml.jackson.databind.DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(output.toByteArray());
                    if(body==null||!body.isObject()) throw new ApiException(502,"模型服务未返回有效 JSON 对象");
                    return body;
                } catch(com.fasterxml.jackson.core.JsonProcessingException e) { throw new ApiException(502,"模型服务未返回有效 JSON"); }
            }
        } catch(IOException e) {
            if(timedOut.get()) throw new ApiException(504,"查询模型目录超时");
            throw e;
        } finally { abort.cancel(false); request.releaseConnection(); }
    }
}
