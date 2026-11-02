package cn.nebulaedata.cccs.nebuwork.backend.api.identity;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.http.*;
import org.springframework.test.context.ActiveProfiles;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;

@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "spring.datasource.url=jdbc:h2:mem:gatewaypaths;MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1",
    "spring.datasource.driver-class-name=org.h2.Driver","spring.datasource.username=sa","spring.datasource.password=",
    "nebu.auth.allowed-origins=http://localhost:5173,http://localhost:42000",
    "spring.cloud.nacos.config.enabled=false","spring.cloud.nacos.discovery.enabled=false"
})
@ActiveProfiles("expert-local")
class GatewayPathTest {
    @LocalServerPort int port;
    @Autowired TestRestTemplate http;
    @MockBean AccountSessionStore sessions;
    @BeforeEach void setup() { when(sessions.findActor("valid-token")).thenReturn("real-user-id"); }
    private String url(String path) { return "http://127.0.0.1:"+port+path; }
    private ResponseEntity<JsonNode> experts(HttpHeaders headers) {
        return http.exchange(url("/nwaa/api/agents"),HttpMethod.GET,new HttpEntity<>(headers),JsonNode.class);
    }

    @Test void prefixHealthAndUnauthenticatedRequests() {
        assertEquals(HttpStatus.OK,http.getForEntity(url("/nwaa/api/health"),JsonNode.class).getStatusCode());
        assertEquals(HttpStatus.UNAUTHORIZED,experts(new HttpHeaders()).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND,http.getForEntity(url("/api/health"),String.class).getStatusCode());
        assertEquals(HttpStatus.NOT_FOUND,http.getForEntity(url("/nebulaedev/nwaa/api/health"),String.class).getStatusCode());
    }

    @Test void acceptsOpaqueSessionHeadersAndBrowserCookieWithoutRenewingOnReads() {
        HttpHeaders headers=new HttpHeaders(); headers.set("token","valid-token");
        ResponseEntity<JsonNode> result=experts(headers);
        assertEquals(HttpStatus.OK,result.getStatusCode());
        assertNull(result.getHeaders().getFirst(HttpHeaders.SET_COOKIE));
        assertEquals(10,result.getBody().path("data").size());
        headers=new HttpHeaders(); headers.set(HttpHeaders.COOKIE,"nebuwork_session=valid-token");
        assertEquals(HttpStatus.OK,experts(headers).getStatusCode());
        headers=new HttpHeaders(); headers.set("sessionKey","valid-token");
        assertEquals(HttpStatus.OK,experts(headers).getStatusCode());
        when(sessions.findActor("valid-token")).thenReturn(null);
        assertEquals(HttpStatus.UNAUTHORIZED,experts(headers).getStatusCode());
    }

    @Test void doesNotTrustIdentityHeadersOrIgnoreRedisFailure() {
        HttpHeaders headers=new HttpHeaders(); headers.set("userId","forged-user");
        headers.set("visitorId","another-user"); headers.set("d3abf3bf66ac","forged-user");
        assertEquals(HttpStatus.UNAUTHORIZED,experts(headers).getStatusCode());
        headers.set("token","unavailable");
        when(sessions.findActor("unavailable")).thenThrow(new RedisConnectionFailureException("offline"));
        assertEquals(HttpStatus.SERVICE_UNAVAILABLE,experts(headers).getStatusCode());
    }

    @Test void nativeLoginEndpointsArePublicAndOriginsStillApplyToWrites() {
        HttpHeaders headers=new HttpHeaders(); headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setOrigin("http://localhost:5173");
        assertEquals(HttpStatus.OK,http.getForEntity(url("/nwaa/api/auth/public-key"),JsonNode.class).getStatusCode());
        assertEquals(HttpStatus.UNPROCESSABLE_ENTITY,http.postForEntity(url("/nwaa/api/auth/login"),
            new HttpEntity<>("{}",headers),JsonNode.class).getStatusCode());
        headers.setOrigin("https://other.example"); headers.set("X-Forwarded-Host","other.example");
        assertEquals(HttpStatus.FORBIDDEN,http.postForEntity(url("/nwaa/api/agents"),
            new HttpEntity<>("{}",headers),JsonNode.class).getStatusCode());
    }
}
