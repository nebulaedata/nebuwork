package cn.nebulaedata.cccs.nebuwork.backend.api.memory;

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

/** Only server-authorized settings are accepted. Never inherit proxy credentials or redirects. */
@Component
public class HindsightClient {
    private final MemorySettings settings;
    private final ObjectMapper json;
    private final ScheduledExecutorService deadlines = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "hindsight-deadlines"); t.setDaemon(true); return t;
    });
    public HindsightClient(MemorySettings settings, ObjectMapper json) { this.settings = settings; this.json = json; }
    @PreDestroy public void close() { deadlines.shutdownNow(); }
    public static class Failure extends RuntimeException {
        public final int status;
        public Failure(int status) { super("记忆服务请求失败（" + status + "），请检查服务配置或稍后重试"); this.status = status; }
        public boolean retryable() { return status == 0 || status == 429 || status >= 500; }
    }
    public JsonNode request(String method, String path, Object body, int timeout) {
        return request(settings.current(),method,path,body,timeout);
    }
    public JsonNode request(MemorySettings.Connection connection,String method,String path,Object body,int timeout) {
        URI base;
        try {
            base = URI.create(MemoryEndpoint.normalize(connection.baseUrl));
            if (!("http".equals(base.getScheme()) || "https".equals(base.getScheme())) || base.getHost() == null
                    || base.getUserInfo() != null || base.getQuery() != null || base.getFragment() != null
                    || !(base.getPath().isEmpty() || "/".equals(base.getPath()))) throw new IllegalArgumentException();
        } catch (Exception e) { throw new Failure(422); }
        if (path==null||!path.startsWith("/")||path.startsWith("//")||path.contains("\\")) throw new Failure(422);
        HttpRequestBase request;
        switch (method) {
            case "POST": request = new HttpPost(); break;
            case "PUT": request = new HttpPut(); break;
            case "DELETE": request = new HttpDelete(); break;
            default: request = new HttpGet();
        }
        request.setURI(base.resolve(path));
        request.setConfig(RequestConfig.custom().setConnectTimeout(Math.min(1000, timeout)).setConnectionRequestTimeout(timeout).setSocketTimeout(timeout).build());
        String key=connection.apiKey();
        if (!key.isEmpty()) request.setHeader("Authorization", "Bearer " + key);
        request.setHeader("Accept", "application/json");
        ScheduledFuture<?> timer = deadlines.schedule(request::abort, timeout, TimeUnit.MILLISECONDS);
        try (CloseableHttpClient client = HttpClients.custom().setDnsResolver(MemoryEndpoint::resolve).disableAutomaticRetries().disableRedirectHandling().disableCookieManagement().build()) {
            if (body != null) {
                ((HttpEntityEnclosingRequestBase) request).setEntity(new ByteArrayEntity(json.writeValueAsBytes(body)));
                request.setHeader("Content-Type", "application/json");
            }
            try (CloseableHttpResponse response = client.execute(request)) {
                int status = response.getStatusLine().getStatusCode();
                if (status < 200 || status >= 300) throw new Failure(status);
                if (response.getEntity() == null) return json.createObjectNode();
                try (InputStream input = response.getEntity().getContent(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[8192]; int size;
                    while ((size = input.read(buffer)) != -1) {
                        if (output.size() + size > 2 * 1024 * 1024) throw new Failure(502);
                        output.write(buffer, 0, size);
                    }
                    return output.size() == 0 ? json.createObjectNode() : json.readTree(output.toByteArray());
                }
            }
        } catch (Failure e) { throw e; }
        catch (Exception e) { throw new Failure(0); }
        finally { timer.cancel(false); request.releaseConnection(); }
    }
    public static String bank(String id) {
        if (id == null || !id.matches("[a-zA-Z0-9_-]{1,160}")) throw new Failure(422);
        return "/v1/default/banks/" + id;
    }
}
