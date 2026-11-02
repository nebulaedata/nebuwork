package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;
import java.net.InetAddress;
import java.net.URI;
import java.util.Base64;
import static org.junit.jupiter.api.Assertions.*;

class ModelSecurityTest {
    private MockEnvironment strictEnvironment(){return new MockEnvironment().withProperty("nebu.models.block-special-addresses","true").withProperty("nebu.models.internal-allowlist-enabled","true");}
    @Test void defaultPolicyAllowsProxyLocalLanAndSpecialDestinations()throws Exception{
        ModelNetworkPolicy policy=new ModelNetworkPolicy(new MockEnvironment().withProperty("nebu.models.allowed-internal-origins","legacy-unused-config"));
        for(String path:new String[]{"/v1/models","/v1/chat/completions"})for(String ip:new String[]{"198.18.0.57","198.19.0.57","127.0.0.1","192.168.1.2","10.0.0.2","100.64.0.1","::1","fd00::1","169.254.169.254","fd00:ec2::254"})assertDoesNotThrow(()->policy.validate(URI.create("http://model.example:8080"+path),new InetAddress[]{InetAddress.getByName(ip)}),ip);
        assertEquals(502,assertThrows(ApiException.class,()->policy.validate(URI.create("http://model.example"),new InetAddress[0])).status);
    }
    @Test void normalizesRootsVersionsFullCatalogsAndProxyPaths() {
        assertEquals("https://api.example/v1/models",ModelCredentials.from("openai","HTTPS://API.EXAMPLE:443/","test","m").endpoint.toString());
        assertEquals("https://api.example/proxy/v1/models",ModelCredentials.from("anthropic","https://api.example/proxy/v1","test","m").endpoint.toString());
        assertEquals("https://api.example/proxy/v1beta/models",ModelCredentials.from("gemini","https://api.example/proxy","test","models/m").endpoint.toString());
        assertEquals("https://api.example/custom/models",ModelCredentials.from("gemini","https://api.example/custom/models/","test","m").endpoint.toString());
        assertEquals("m",ModelCredentials.from("gemini","https://api.example/v1beta/models","test","models/m").model);
    }
    @Test void rejectsCredentialsInUrlsAndEmptyNormalizedModels() throws Exception {
        for(String url:new String[]{"file:///secret","http://user:secret@api.example","https://api.example?key=secret","http://api.example/../models","http://api.example/%2e%2e/models"})
            assertEquals(422,assertThrows(ApiException.class,()->ModelCredentials.normalizeUrl(url)).status);
        assertThrows(ApiException.class,()->ModelCredentials.parse(new ObjectMapper().readTree("{\"type\":\"custom\",\"baseUrl\":\"https://api.example\",\"apiKey\":\"test\",\"model\":\" \"}"),true));
    }
    @Test void usesAuthenticatedEncryptionBoundToBothUserAndRecord() {
        String testKey=Base64.getEncoder().encodeToString(new byte[32]); // Test fixture only; never a production fallback.
        MockEnvironment env=new MockEnvironment().withProperty("nebu.models.encryption-key",testKey);
        ModelSecretCipher cipher=new ModelSecretCipher(env);
        String first=cipher.encrypt("alice","p1","private-key"),second=cipher.encrypt("alice","p1","private-key");
        assertNotEquals(first,second); assertFalse(first.contains("private-key"));
        assertEquals("private-key",cipher.decrypt("alice","p1",first));
        assertEquals(503,assertThrows(ApiException.class,()->cipher.decrypt("bob","p1",first)).status);
        assertThrows(ApiException.class,()->cipher.decrypt("alice","p2",first));
        assertThrows(ApiException.class,()->cipher.decrypt("alice","p1",first.substring(0,first.length()-5)));
        env.setProperty("nebu.models.encryption-key","");
        assertThrows(ApiException.class,()->cipher.encrypt("alice","p1","private-key"));
    }
    @Test void privateAccessRequiresExactOriginAndEveryDnsAnswerIsChecked() throws Exception {
        MockEnvironment env=strictEnvironment(); ModelNetworkPolicy policy=new ModelNetworkPolicy(env);
        URI endpoint=URI.create("http://models.example:8080/v1/models");
        InetAddress publicIp=InetAddress.getByName("8.8.8.8"),privateIp=InetAddress.getByName("127.0.0.1");
        policy.validate(endpoint,new InetAddress[]{publicIp});
        assertEquals(422,assertThrows(ApiException.class,()->policy.validate(endpoint,new InetAddress[]{publicIp,privateIp})).status);
        env.setProperty("nebu.models.allowed-internal-origins","http://models.example:8081");
        assertThrows(ApiException.class,()->policy.validate(endpoint,new InetAddress[]{privateIp}));
        env.setProperty("nebu.models.allowed-internal-origins","http://models.example:8080");
        policy.validate(endpoint,new InetAddress[]{privateIp});
        policy.validate(endpoint,new InetAddress[]{InetAddress.getByName("::1")});
        for(String blocked:new String[]{"0.0.0.0","169.254.169.254","100.100.100.200","224.0.0.1","fd00:ec2::254","2002:7f00:1::"})
            assertEquals(422,assertThrows(ApiException.class,()->policy.validate(endpoint,new InetAddress[]{InetAddress.getByName(blocked)})).status);
        env.setProperty("nebu.models.allowed-internal-origins","*");
        assertEquals(503,assertThrows(ApiException.class,()->policy.validate(endpoint,new InetAddress[]{privateIp})).status);
    }
    @Test void specialAddressSwitchAppliesToCatalogAndInferenceAndCanBeReenabled() throws Exception {
        MockEnvironment env=strictEnvironment();
        ModelNetworkPolicy policy=new ModelNetworkPolicy(env);
        InetAddress[] addresses={InetAddress.getByName("8.8.8.8"),InetAddress.getByName("198.18.0.57")};
        for(String path:new String[]{"/v1/models","/v1/chat/completions"}) {
            URI endpoint=URI.create("https://model.example"+path);
            assertEquals(422,assertThrows(ApiException.class,()->policy.validate(endpoint,addresses)).status);
            env.setProperty("nebu.models.block-special-addresses","false");
            assertDoesNotThrow(()->policy.validate(endpoint,addresses));
            env.setProperty("nebu.models.block-special-addresses","true");
            assertEquals(422,assertThrows(ApiException.class,()->policy.validate(endpoint,addresses)).status);
        }
    }
    @Test void disablingSpecialAddressBlockKeepsInternalAllowlistAndDnsRequirements() throws Exception {
        MockEnvironment env=strictEnvironment().withProperty("nebu.models.block-special-addresses","false");
        ModelNetworkPolicy policy=new ModelNetworkPolicy(env);
        URI endpoint=URI.create("http://model.example:8080/v1/models");
        InetAddress[] privateAddress={InetAddress.getByName("127.0.0.1")};
        assertEquals(422,assertThrows(ApiException.class,()->policy.validate(endpoint,privateAddress)).status);
        env.setProperty("nebu.models.allowed-internal-origins","http://model.example:8080");
        assertDoesNotThrow(()->policy.validate(endpoint,privateAddress));
        for(String address:new String[]{"198.19.0.57","169.254.169.254","fd00:ec2::254"})
            assertDoesNotThrow(()->policy.validate(endpoint,new InetAddress[]{InetAddress.getByName(address)}));
        assertEquals(502,assertThrows(ApiException.class,()->policy.validate(endpoint,new InetAddress[0])).status);
        env.setProperty("nebu.models.block-special-addresses","not-a-boolean");
        assertEquals(503,assertThrows(ApiException.class,()->policy.validate(endpoint,privateAddress)).status);
    }
}
