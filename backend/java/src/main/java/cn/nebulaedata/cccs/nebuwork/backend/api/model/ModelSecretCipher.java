package cn.nebulaedata.cccs.nebuwork.backend.api.model;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;
import javax.crypto.Cipher;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.Base64;

@Component
public class ModelSecretCipher {
    private final Environment environment;
    private final SecureRandom random=new SecureRandom();
    public ModelSecretCipher(Environment environment) { this.environment=environment; }
    private SecretKeySpec key() {
        try {
            byte[] key=Base64.getDecoder().decode(environment.getProperty("nebu.models.encryption-key","").trim());
            if(key.length!=32) throw new IllegalArgumentException();
            return new SecretKeySpec(key,"AES");
        } catch(IllegalArgumentException e) { throw new ApiException(503,"请在 服务端 配置有效的模型凭据加密密钥"); }
    }
    public String encrypt(String owner,String id,String plaintext) {
        try {
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            byte[] nonce=new byte[12]; random.nextBytes(nonce);
            cipher.init(Cipher.ENCRYPT_MODE,key(),new GCMParameterSpec(128,nonce));
            cipher.updateAAD((owner+"\n"+id).getBytes(StandardCharsets.UTF_8));
            byte[] encrypted=cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] packed=Arrays.copyOf(nonce,nonce.length+encrypted.length);
            System.arraycopy(encrypted,0,packed,nonce.length,encrypted.length);
            return "v1:"+Base64.getEncoder().encodeToString(packed);
        } catch(GeneralSecurityException e) { throw new ApiException(503,"模型凭据加密失败，请检查服务端加密配置"); }
    }
    public String decrypt(String owner,String id,String encoded) {
        try {
            if(encoded==null||!encoded.startsWith("v1:")) throw new IllegalArgumentException();
            byte[] packed=Base64.getDecoder().decode(encoded.substring(3));
            if(packed.length<29) throw new IllegalArgumentException();
            Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Arrays.copyOf(packed,12)));
            cipher.updateAAD((owner+"\n"+id).getBytes(StandardCharsets.UTF_8));
            return new String(cipher.doFinal(Arrays.copyOfRange(packed,12,packed.length)),StandardCharsets.UTF_8);
        } catch(GeneralSecurityException | IllegalArgumentException e) {
            throw new ApiException(503,"无法解密模型凭据，请检查 服务端 加密密钥是否与保存时一致");
        }
    }
}
