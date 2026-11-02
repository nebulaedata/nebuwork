package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.*;
import com.sun.net.httpserver.*;
import org.junit.jupiter.api.*;
import org.springframework.mock.env.MockEnvironment;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

class ModelTextClientTest {
    HttpServer server;ModelTextClient client;ModelProviderMapper db;ModelSecretCipher cipher;MockEnvironment env;String origin;ObjectMapper json=new ObjectMapper();
    @BeforeEach void setup() throws IOException {
        server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);origin="http://127.0.0.1:"+server.getAddress().getPort();
        env=new MockEnvironment().withProperty("nebu.models.allowed-internal-origins",origin).withProperty("nebu.models.internal-allowlist-enabled","true");db=mock(ModelProviderMapper.class);cipher=mock(ModelSecretCipher.class);
        when(db.owned("owner","saved")).thenReturn(map("provider_type","custom","base_url",origin+"/proxy","model_name","configured-model","api_key_ciphertext","ciphertext"));
        when(cipher.decrypt("owner","saved","ciphertext")).thenReturn("private-key");
        client=new ModelTextClient(db,cipher,new ModelNetworkPolicy(env),json,env);server.start();
    }
    @AfterEach void close() { client.close();server.stop(0); }
    void reply(HttpExchange request,int status,String body) throws IOException {
        byte[] bytes=body.getBytes(StandardCharsets.UTF_8);request.sendResponseHeaders(status,bytes.length);request.getResponseBody().write(bytes);request.close();
    }
    String complete() { return client.complete("owner","saved","写作约束","专家资料"); }
    @Test void usesSavedCredentialsAndActualModelWithoutCookiesOrAutomaticPersistence() {
        List<JsonNode> bodies=new ArrayList<>();List<String> auth=new ArrayList<>();
        server.createContext("/proxy/v1/chat/completions",request->{
            assertEquals("POST",request.getRequestMethod());auth.add(request.getRequestHeaders().getFirst("Authorization"));assertNull(request.getRequestHeaders().getFirst("Cookie"));
            bodies.add(json.readTree(request.getRequestBody()));reply(request,200,"{\"choices\":[{\"message\":{\"content\":\" 合同审查与风险提示 \"}}]}");
        });
        assertEquals("合同审查与风险提示",complete());assertEquals(Collections.singletonList("Bearer private-key"),auth);
        assertEquals("configured-model",bodies.get(0).path("model").asText());assertFalse(bodies.get(0).path("stream").asBoolean());
        assertEquals("写作约束",bodies.get(0).path("messages").get(0).path("content").asText());assertEquals("专家资料",bodies.get(0).path("messages").get(1).path("content").asText());
        verify(db).owned("owner","saved");verifyNoMoreInteractions(db);
    }
    @Test void rejectsOtherAccountsBeforeDecryptingOrCallingTheService() {
        assertEquals(404,assertThrows(ApiException.class,()->client.complete("another","saved","s","u")).status);verifyNoInteractions(cipher);
    }
    @Test void refusesNonAllowlistedInternalOriginsBeforeHttpAndNeverFollowsRedirects() {
        AtomicInteger requests=new AtomicInteger();server.createContext("/proxy/v1/chat/completions",request->{requests.incrementAndGet();request.getResponseHeaders().add("Location",origin+"/target");reply(request,302,"");});
        server.createContext("/target",request->{requests.incrementAndGet();reply(request,200,"{}");});
        env.setProperty("nebu.models.allowed-internal-origins","");assertEquals(422,assertThrows(ApiException.class,this::complete).status);assertEquals(0,requests.get());
        env.setProperty("nebu.models.allowed-internal-origins",origin);assertEquals(502,assertThrows(ApiException.class,this::complete).status);assertEquals(1,requests.get());
    }
    @Test void rateLimitsAndBadResponsesReturnSanitizedErrorsWithoutRetry() {
        AtomicInteger requests=new AtomicInteger();server.createContext("/proxy/v1/chat/completions",request->{requests.incrementAndGet();reply(request,429,"private-key upstream body");});
        ApiException error=assertThrows(ApiException.class,this::complete);assertEquals(502,error.status);assertFalse(error.getMessage().contains("private-key"));assertEquals(1,requests.get());
        server.removeContext("/proxy/v1/chat/completions");server.createContext("/proxy/v1/chat/completions",request->reply(request,200,"private-key malformed JSON"));
        error=assertThrows(ApiException.class,this::complete);assertEquals(502,error.status);assertFalse(error.getMessage().contains("private-key"));
    }
    @Test void supportsTextBlocksAndRejectsEmptyOrOversizedResponses() {
        server.createContext("/proxy/v1/chat/completions",request->reply(request,200,"{\"choices\":[{\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"合同审查\"},{\"type\":\"text\",\"text\":\"与归档\"}]}}]}"));
        assertEquals("合同审查与归档",complete());server.removeContext("/proxy/v1/chat/completions");
        server.createContext("/proxy/v1/chat/completions",request->reply(request,200,"{\"choices\":[{\"message\":{\"content\":null}}]}"));assertEquals(502,assertThrows(ApiException.class,this::complete).status);
        server.removeContext("/proxy/v1/chat/completions");char[] padding=new char[1024*1024+1];Arrays.fill(padding,'x');
        server.createContext("/proxy/v1/chat/completions",request->reply(request,200,new String(padding)));assertEquals(502,assertThrows(ApiException.class,this::complete).status);
    }
    @Test void deadlineBoundsSlowInference() {
        env.setProperty("nebu.models.completion-timeout-ms","1000");server.createContext("/proxy/v1/chat/completions",request->{try {Thread.sleep(1500);reply(request,200,"{}");}catch(InterruptedException error){Thread.currentThread().interrupt();}});
        assertEquals(504,assertThrows(ApiException.class,this::complete).status);
    }
}
