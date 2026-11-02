package cn.nebulaedata.cccs.nebuwork.backend.api.agent;
import com.fasterxml.jackson.databind.*;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class AgentClientTest {
    private AgentSettings settings(String... urls){AgentSettings settings=mock(AgentSettings.class);when(settings.current()).thenReturn(new AgentSettings.Connection(true,Arrays.asList(urls),"nebuwork-v2","nebu-agent-sandbox:1",2000,"12345678901234567890123456789012","callback-key-1234567890123456789012","",""));return settings;}
    @Test void authenticatesAccountProjectAndIdempotencyWithoutForwardingModelKeys()throws Exception{
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);AtomicReference<String> authorization=new AtomicReference<>(),key=new AtomicReference<>();
        server.createContext("/v1/sessions",request->{authorization.set(request.getRequestHeaders().getFirst("Authorization"));key.set(request.getRequestHeaders().getFirst("Idempotency-Key"));byte[] body="{\"id\":\"session\"}".getBytes(StandardCharsets.UTF_8);request.sendResponseHeaders(200,body.length);request.getResponseBody().write(body);request.close();});server.start();
        AgentClient client=new AgentClient(settings("http://127.0.0.1:"+server.getAddress().getPort()),new ObjectMapper());
        try{assertEquals("session",client.post("alice","project-one","/v1/sessions",Collections.singletonMap("title","任务"),"stable-request").path("id").asText());String token=authorization.get().substring(7);JsonNode claims=new ObjectMapper().readTree(Base64.getUrlDecoder().decode(token.split("\\.")[1]));assertEquals("alice",claims.path("ownerId").asText());assertEquals("project-one",claims.path("projects").get(0).asText());assertEquals("nebu-agent-engine",claims.path("aud").asText());assertEquals("stable-request",key.get());assertFalse(token.contains("callback-key"));assertThrows(RuntimeException.class,()->AgentClient.segment("../other"));}finally{client.close();server.stop(0);}
    }
    @Test void readsPinnedArtifactBytesThroughHttp()throws Exception {
        HttpServer server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);byte[] expected="shared-material".getBytes(StandardCharsets.UTF_8);AtomicReference<String> query=new AtomicReference<>();
        server.createContext("/v1/artifacts/material/content",request->{query.set(request.getRequestURI().getQuery());request.sendResponseHeaders(200,expected.length);request.getResponseBody().write(expected);request.close();});server.start();
        AgentClient client=new AgentClient(settings("http://127.0.0.1:"+server.getAddress().getPort()),new ObjectMapper());
        try{assertArrayEquals(expected,client.contentBytes("alice","expert-example","material",2));assertEquals("version=2",query.get());}finally{client.close();server.stop(0);}
    }

    @Test void switchesNodesWithTheSameIdempotencyKeyAfterAnUncertainWrite()throws Exception{
        HttpServer first=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0),second=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        Map<String,String> writes=new java.util.concurrent.ConcurrentHashMap<>();List<String> seen=new ArrayList<>();
        first.createContext("/v1/sessions",r->{String key=r.getRequestHeaders().getFirst("Idempotency-Key");seen.add(key);writes.putIfAbsent(key,"one-session");r.sendResponseHeaders(503,-1);r.close();});
        second.createContext("/v1/sessions",r->{String key=r.getRequestHeaders().getFirst("Idempotency-Key");seen.add(key);byte[] body=("{\"id\":\""+writes.computeIfAbsent(key,k->"duplicate-session")+"\"}").getBytes(StandardCharsets.UTF_8);r.sendResponseHeaders(200,body.length);r.getResponseBody().write(body);r.close();});first.start();second.start();
        AgentClient client=new AgentClient(settings("http://127.0.0.1:"+first.getAddress().getPort(),"http://127.0.0.1:"+second.getAddress().getPort()),new ObjectMapper());
        try{assertEquals("one-session",client.post("alice","project","/v1/sessions",Collections.singletonMap("title","goal"),"stable-operation").path("id").asText());assertEquals(Arrays.asList("stable-operation","stable-operation"),seen);assertEquals(1,writes.size());}
        finally{client.close();first.stop(0);second.stop(0);}
    }
    @Test void doesNotReplayWritesWithoutAnIdempotencyKey()throws Exception{
        HttpServer first=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0),second=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);java.util.concurrent.atomic.AtomicInteger seen=new java.util.concurrent.atomic.AtomicInteger();
        first.createContext("/v1/sessions",r->{byte[] body="{\"error\":{\"message\":\"unavailable\"}}".getBytes(StandardCharsets.UTF_8);r.sendResponseHeaders(503,body.length);r.getResponseBody().write(body);r.close();});
        second.createContext("/v1/sessions",r->{seen.incrementAndGet();r.sendResponseHeaders(200,-1);r.close();});first.start();second.start();
        AgentClient client=new AgentClient(settings("http://127.0.0.1:"+first.getAddress().getPort(),"http://127.0.0.1:"+second.getAddress().getPort()),new ObjectMapper());
        try{assertThrows(RuntimeException.class,()->client.post("alice","project","/v1/sessions",Collections.emptyMap(),null));assertEquals(0,seen.get());}finally{client.close();first.stop(0);second.stop(0);}
    }
}
