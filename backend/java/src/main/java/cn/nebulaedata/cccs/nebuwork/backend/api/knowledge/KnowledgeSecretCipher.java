package cn.nebulaedata.cccs.nebuwork.backend.api.knowledge;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import javax.crypto.Cipher;
import javax.crypto.spec.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;

@Component
public class KnowledgeSecretCipher {
    private final Environment environment;
    private final SecureRandom random=new SecureRandom();
    public KnowledgeSecretCipher(Environment environment){this.environment=environment;}
    private SecretKeySpec key() {
        try {
            byte[] bytes=Base64.getDecoder().decode(environment.getProperty("nebu.knowledge.encryption-key","").trim());
            if(bytes.length!=32)throw new IllegalArgumentException();
            return new SecretKeySpec(bytes,"AES");
        }catch(RuntimeException e){throw new ApiException(503,"请在 服务端 配置有效的知识库凭据加密密钥");}
    }
    public String encrypt(String owner,String id,String value) {
        try {
            byte[] nonce=new byte[12];random.nextBytes(nonce);
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE,key(),new GCMParameterSpec(128,nonce));
            cipher.updateAAD((owner+"\n"+id).getBytes(StandardCharsets.UTF_8));
            byte[] encrypted=cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)),packed=Arrays.copyOf(nonce,nonce.length+encrypted.length);
            System.arraycopy(encrypted,0,packed,nonce.length,encrypted.length);
            return "v1:"+Base64.getEncoder().encodeToString(packed);
        }catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(503,"知识库凭据加密失败");}
    }
    public String decrypt(String owner,String id,String value) {
        try {
            if(!value.startsWith("v1:"))throw new IllegalArgumentException();
            byte[] packed=Base64.getDecoder().decode(value.substring(3));
            if(packed.length<29)throw new IllegalArgumentException();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Arrays.copyOf(packed,12)));
            cipher.updateAAD((owner+"\n"+id).getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(Arrays.copyOfRange(packed,12,packed.length)),StandardCharsets.UTF_8);
        }catch(ApiException e){throw e;}catch(Exception e){throw new ApiException(503,"知识库凭据无法解密，请检查 服务端 密钥");}
    }
}

