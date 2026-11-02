package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.springframework.mock.env.MockEnvironment;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

/** Only loopback fixtures; never connects to a real model service or charges for inference. */
class ModelCatalogClientTest {
    HttpServer server; ModelCatalogClient client; MockEnvironment env; String origin;
    @BeforeEach void setup() throws IOException {
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        origin="http://127.0.0.1:"+server.getAddress().getPort();
        env=new MockEnvironment().withProperty("nebu.models.allowed-internal-origins",origin).withProperty("nebu.models.internal-allowlist-enabled","true");
        client=new ModelCatalogClient(new ObjectMapper(),env,new ModelNetworkPolicy(env)); server.start();
    }
    @AfterEach void close() { client.close(); server.stop(0); }
    void reply(HttpExchange request,int status,String body) throws IOException {
        byte[] bytes=body.getBytes(StandardCharsets.UTF_8);
        request.sendResponseHeaders(status,bytes.length); request.getResponseBody().write(bytes); request.close();
    }
    Map<String,Object> fetch(String type,String path) { return client.fetch(ModelCredentials.from(type,origin+path,"test-private-key","m")); }
    @Test void openAiUsesBearerAndPreservesTheProxyPrefix() {
        List<String> auth=new ArrayList<>();
        server.createContext("/proxy/v1/models",request->{auth.add(request.getRequestHeaders().getFirst("Authorization")); reply(request,200,"{\"data\":[{\"id\":\"m\"}]}");});
        for(String vendor:Arrays.asList("mrtoken","custom","openai")) {
            Map<String,Object> result=fetch(vendor,"/proxy");
            assertEquals(Collections.singletonList("m"),result.get("models"));
            assertEquals(origin+"/proxy/v1/models",result.get("endpoint"));
        }
        assertEquals(Collections.nCopies(3,"Bearer test-private-key"),auth);
    }
    @Test void anthropicPaginatesUsingLastIdAndItsOwnHeaders() {
        List<String> requests=new ArrayList<>();
        server.createContext("/v1/models",request->{
            requests.add(request.getRequestHeaders().getFirst("x-api-key")+":"+request.getRequestHeaders().getFirst("anthropic-version")+":"+request.getRequestURI().getRawQuery());
            reply(request,200,request.getRequestURI().getRawQuery()==null?"{\"data\":[{\"id\":\"a\"}],\"has_more\":true,\"last_id\":\"a\"}":"{\"data\":[{\"id\":\"b\"}],\"has_more\":false}");
        });
        assertEquals(Arrays.asList("a","b"),fetch("anthropic","/v1").get("models"));
        assertEquals(Arrays.asList("test-private-key:2023-06-01:null","test-private-key:2023-06-01:after_id=a"),requests);
    }
    @Test void geminiUsesNativePathHeaderPageTokenAndStripsResourcePrefix() {
        List<String> requests=new ArrayList<>();
        server.createContext("/v1beta/models",request->{
            requests.add(request.getRequestHeaders().getFirst("x-goog-api-key")+":"+request.getRequestURI().getRawQuery());
            reply(request,200,request.getRequestURI().getRawQuery()==null?"{\"models\":[{\"name\":\"models/a\"}],\"nextPageToken\":\"next\"}":"{\"models\":[{\"name\":\"models/b\"}]}");
        });
        assertEquals(Arrays.asList("a","b"),fetch("gemini","").get("models"));
        assertEquals(Arrays.asList("test-private-key:null","test-private-key:pageToken=next"),requests);
    }
    @Test void upstreamAuthRateLimitInvalidJsonAndEmptyDirectoryNeverReturnSuccessOrLocal401() {
        for(int status:new int[]{401,403,429}) {
            String path="/error"+status+"/models";
            server.createContext(path,request->reply(request,status,"test-private-key upstream secret body"));
            ApiException error=assertThrows(ApiException.class,()->fetch("openai",path));
            assertEquals(502,error.status); assertFalse(error.getMessage().contains("test-private-key"));
        }
        server.createContext("/invalid/models",request->reply(request,200,"not JSON test-private-key"));
        server.createContext("/empty/models",request->reply(request,200,"{\"data\":[]}"));
        server.createContext("/trailing/models",request->reply(request,200,"{\"data\":[{\"id\":\"m\"}]} trailing-garbage"));
        assertEquals(502,assertThrows(ApiException.class,()->fetch("openai","/invalid/models")).status);
        assertEquals(502,assertThrows(ApiException.class,()->fetch("openai","/empty/models")).status);
        assertEquals(502,assertThrows(ApiException.class,()->fetch("openai","/trailing/models")).status);
    }
    @Test void redirectsAreNotFollowedEvenToAnAllowedOrigin() {
        AtomicInteger target=new AtomicInteger();
        server.createContext("/redirect/models",request->{request.getResponseHeaders().set("Location",origin+"/target/models"); reply(request,302,"redirect");});
        server.createContext("/target/models",request->{target.incrementAndGet(); reply(request,200,"{\"data\":[{\"id\":\"m\"}]}");});
        assertEquals(502,assertThrows(ApiException.class,()->fetch("openai","/redirect/models")).status);
        assertEquals(0,target.get());
    }
    @Test void deadlineAbortsAStalledResponse() {
        env.setProperty("nebu.models.request-timeout-ms","100");
        server.createContext("/v1/models",request->{
            try { Thread.sleep(300); reply(request,200,"{\"data\":[{\"id\":\"m\"}]}"); }
            catch(InterruptedException e) { Thread.currentThread().interrupt(); }
        });
        assertEquals(504,assertThrows(ApiException.class,()->fetch("openai","")).status);
    }
    @Test void limitsPagesAndCumulativeBytesWithoutReturningPartialModels() {
        AtomicInteger pages=new AtomicInteger();
        server.createContext("/pages/models",request->{int n=pages.incrementAndGet(); reply(request,200,"{\"models\":[{\"name\":\"models/m\"}],\"nextPageToken\":\""+n+"\"}");});
        assertEquals(502,assertThrows(ApiException.class,()->fetch("gemini","/pages/models")).status); assertEquals(20,pages.get());
        char[] padding=new char[1100*1024]; Arrays.fill(padding,'x');
        server.createContext("/large/models",request->reply(request,200,"{\"models\":[{\"name\":\"models/m\"}],\"padding\":\""+new String(padding)+"\",\"nextPageToken\":\"next\"}"));
        ApiException error=assertThrows(ApiException.class,()->fetch("gemini","/large/models"));
        assertEquals(502,error.status); assertTrue(error.getMessage().contains("2 MiB"));
    }
    @Test void nonAllowlistedLoopbackIsRejectedBeforeHttp() {
        env.setProperty("nebu.models.allowed-internal-origins","");
        assertEquals(422,assertThrows(ApiException.class,()->fetch("openai","")).status);
    }
}
