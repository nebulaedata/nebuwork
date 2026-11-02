package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import org.apache.http.client.config.RequestConfig;
import org.apache.http.client.methods.*;
import org.apache.http.entity.ByteArrayEntity;
import org.apache.http.impl.client.*;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import javax.annotation.PreDestroy;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

/** Explicit, short text generation using an owned saved model. No task run or automatic retry. */
@Component
public class ModelTextClient {
    private static final int MAX_BYTES=1024*1024;
    private final ModelProviderMapper db;
    private final ModelSecretCipher cipher;
    private final ModelNetworkPolicy policy;
    private final ObjectMapper json;
    private final Environment environment;
    private final Semaphore slots=new Semaphore(8);
    private final ThreadPoolExecutor dns=new ThreadPoolExecutor(4,4,0,TimeUnit.MILLISECONDS,
        new ArrayBlockingQueue<Runnable>(16),daemon("model-text-dns"),new ThreadPoolExecutor.AbortPolicy());
    private final ScheduledThreadPoolExecutor timers=new ScheduledThreadPoolExecutor(1,daemon("model-text-timeout"));
    public ModelTextClient(ModelProviderMapper db,ModelSecretCipher cipher,ModelNetworkPolicy policy,ObjectMapper json,Environment environment) {
        this.db=db;this.cipher=cipher;this.policy=policy;this.json=json;this.environment=environment;timers.setRemoveOnCancelPolicy(true);
    }
    private static ThreadFactory daemon(String name) { return action->{Thread thread=new Thread(action,name);thread.setDaemon(true);return thread;}; }
    @PreDestroy public void close() { dns.shutdownNow();timers.shutdownNow(); }
    private int remaining(long deadline) {
        long nanos=deadline-System.nanoTime();if(nanos<=0)throw new ApiException(504,"AI 补全超时，请稍后重试");
        return (int)Math.max(1,TimeUnit.NANOSECONDS.toMillis(nanos));
    }
    private int timeout() {
        int value;
        try { value=environment.getProperty("nebu.models.completion-timeout-ms",Integer.class,60000); }
        catch(RuntimeException error) { throw new ApiException(503,"AI 补全超时配置必须为整数毫秒"); }
        if(value<1000||value>120000)throw new ApiException(503,"AI 补全超时配置必须在 1000～120000 毫秒之间");return value;
    }
    public String complete(String actor,String provider,String system,String user) {
        Map<String,Object> row=db.owned(actor,provider);
        if(row==null||row.isEmpty())throw new ApiException(404,"模型配置不存在或不属于当前账号");
        String type=Objects.toString(row.get("provider_type"),"");
        if(!ModelCredentials.supportsExecution(type))throw new ApiException(422,"AI 补全目前仅支持 OpenAI 兼容的模型配置");
        if(!slots.tryAcquire())throw new ApiException(503,"AI 补全请求繁忙，请稍后重试");
        HttpPost request=null;ScheduledFuture<?> abort=null;AtomicBoolean timedOut=new AtomicBoolean();
        try {
            long deadline=System.nanoTime()+TimeUnit.MILLISECONDS.toNanos(timeout());
            String secret=cipher.decrypt(actor,provider,Objects.toString(row.get("api_key_ciphertext"),""));
            ModelCredentials config=ModelCredentials.from(type,Objects.toString(row.get("base_url"),""),secret,Objects.toString(row.get("model_name"),""));
            URI endpoint=URI.create(config.endpoint.toASCIIString().replaceFirst("/models$","/chat/completions"));
            Future<InetAddress[]> lookup=dns.submit(()->InetAddress.getAllByName(endpoint.getHost()));
            InetAddress[] addresses;
            try { addresses=lookup.get(remaining(deadline),TimeUnit.MILLISECONDS); }
            finally { lookup.cancel(true); }
            policy.validate(endpoint,addresses);
            request=new HttpPost(endpoint);
            request.setConfig(RequestConfig.custom().setConnectTimeout(remaining(deadline)).setConnectionRequestTimeout(remaining(deadline)).setSocketTimeout(remaining(deadline)).build());
            request.setHeader("Authorization","Bearer "+secret);request.setHeader("Content-Type","application/json");
            request.setHeader("Accept","application/json");request.setHeader("Accept-Encoding","identity");
            request.setEntity(new ByteArrayEntity(json.writeValueAsBytes(map("model",config.model,"stream",false,"max_tokens",800,
                "messages",Arrays.asList(map("role","system","content",system),map("role","user","content",user))))));
            final HttpPost active=request;
            abort=timers.schedule(()->{timedOut.set(true);active.abort();},remaining(deadline),TimeUnit.MILLISECONDS);
            try(CloseableHttpClient client=HttpClients.custom().setDnsResolver(host->{
                if(!endpoint.getHost().replace("[","").replace("]","").equalsIgnoreCase(host.replace("[","").replace("]","")))throw new UnknownHostException("Unexpected host");
                return addresses.clone();
            }).disableRedirectHandling().disableAutomaticRetries().disableCookieManagement().disableAuthCaching().disableContentCompression().build();
                CloseableHttpResponse response=client.execute(request)) {
                int status=response.getStatusLine().getStatusCode();
                if(status<200||status>=300) {
                    String reason=status==401||status==403?"模型服务拒绝凭据或权限":status==429?"模型服务请求受限":"模型服务请求失败";
                    throw new ApiException(502,reason+"（上游 HTTP "+status+"）");
                }
                if(response.getEntity()==null)throw new ApiException(502,"模型服务没有返回补全内容");
                if(response.getEntity().getContentLength()>MAX_BYTES)throw new ApiException(502,"AI 补全响应超过大小限制");
                try(InputStream input=response.getEntity().getContent();ByteArrayOutputStream output=new ByteArrayOutputStream()) {
                    byte[] buffer=new byte[8192];int count;
                    while((count=input.read(buffer))!=-1) {
                        remaining(deadline);if(output.size()+count>MAX_BYTES)throw new ApiException(502,"AI 补全响应超过大小限制");output.write(buffer,0,count);
                    }
                    JsonNode body=json.reader().with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS).readTree(output.toByteArray());
                    JsonNode content=body==null?json.getNodeFactory().nullNode():body.path("choices").path(0).path("message").path("content");
                    StringBuilder text=new StringBuilder();
                    if(content.isTextual())text.append(content.asText());
                    else if(content.isArray())for(JsonNode block:content)if("text".equals(block.path("type").asText())&&block.path("text").isTextual())text.append(block.path("text").asText());
                    String result=text.toString().trim();
                    if(result.isEmpty())throw new ApiException(502,"模型服务没有返回有效的能力简介");return result;
                }
            }
        } catch(ApiException error) { throw error; }
        catch(TimeoutException|SocketTimeoutException error) { throw new ApiException(504,"AI 补全超时，请稍后重试"); }
        catch(InterruptedException error) { Thread.currentThread().interrupt();throw new ApiException(503,"AI 补全请求已中断"); }
        catch(ExecutionException error) { throw new ApiException(502,"模型服务地址解析失败"); }
        catch(IOException error) { throw new ApiException(timedOut.get()?504:502,timedOut.get()?"AI 补全超时，请稍后重试":"AI 补全请求失败，请检查模型服务地址和响应格式"); }
        catch(RuntimeException error) { throw new ApiException(502,"AI 补全请求处理失败"); }
        finally { if(abort!=null)abort.cancel(false);if(request!=null)request.releaseConnection();slots.release(); }
    }
}
