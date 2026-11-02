package cn.nebulaedata.cccs.nebuwork.backend.api.identity;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.springframework.boot.*;
import org.springframework.core.env.Environment;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import javax.crypto.Cipher;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Duration;
import java.util.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.map;

@Service
public class AccountService implements ApplicationRunner {
    private final JdbcTemplate db;private final StringRedisTemplate redis;private final Environment env;private final AccountSessionStore sessions;
    private final BCryptPasswordEncoder passwords=new BCryptPasswordEncoder(12);
    private final String dummyHash=passwords.encode(UUID.randomUUID().toString());
    private final KeyPair rsa;
    public AccountService(JdbcTemplate db,StringRedisTemplate redis,Environment env,AccountSessionStore sessions) {
        this.db=db;this.redis=redis;this.env=env;this.sessions=sessions;
        try { KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA");generator.initialize(2048);rsa=generator.generateKeyPair(); }
        catch(GeneralSecurityException e){throw new IllegalStateException(e);}
    }
    @Override @Transactional public void run(ApplicationArguments args) {
        if(!env.getProperty("nebu.auth.bootstrap.enabled",Boolean.class,false))return;
        String account=account(env.getRequiredProperty("nebu.auth.bootstrap.account"));
        if(db.queryForObject("SELECT COUNT(*) FROM nw_user_account WHERE account=?",Integer.class,account)>0)return;
        String password=env.getRequiredProperty("nebu.auth.bootstrap.password");validatePassword(password);
        String id=env.getRequiredProperty("nebu.auth.bootstrap.id");
        db.update("INSERT INTO nw_user_account(id,account,password_hash,display_name,role) VALUES(?,?,?,?, 'admin')",id,account,passwords.encode(password),"开发管理员");
        db.update("INSERT IGNORE INTO nw_agent_engine_admin(owner_id) VALUES(?)",id);
    }
    public Object publicKey() {return map("publicKey","-----BEGIN PUBLIC KEY-----\n"+Base64.getMimeEncoder(64,new byte[]{10}).encodeToString(rsa.getPublic().getEncoded())+"\n-----END PUBLIC KEY-----");}
    @Transactional public String login(String name,String encrypted,String remote,String oldToken) {
        String actor=authenticate(name,encrypted,remote);
        sessions.revoke(oldToken);
        return sessions.issue(actor);
    }
    String authenticate(String name,String encrypted,String remote) {
        String account=account(name);
        limit("account:"+account,10);limit("ip:"+remote,100);
        String password;
        try { if(encrypted==null||encrypted.length()>1024)throw new GeneralSecurityException();Cipher cipher=Cipher.getInstance("RSA/ECB/PKCS1Padding");cipher.init(Cipher.DECRYPT_MODE,rsa.getPrivate());password=new String(cipher.doFinal(Base64.getDecoder().decode(encrypted)),StandardCharsets.UTF_8); }
        catch(Exception e){throw new ApiException(401,"登录信息已失效，请重试");}
        List<Map<String,Object>> rows=db.queryForList("SELECT * FROM nw_user_account WHERE account=? FOR UPDATE",account);
        Map<String,Object> row=rows.isEmpty()?null:rows.get(0);
        boolean valid=password.getBytes(StandardCharsets.UTF_8).length<=72&&passwords.matches(password,row==null?dummyHash:row.get("password_hash").toString());
        if(!valid||row==null||!Boolean.TRUE.equals(row.get("enabled")))throw new ApiException(401,"账号或密码错误");
        return row.get("id").toString();
    }
    private void limit(String value,int max) {
        String key="nebuwork:account:login-limit:"+AccountSessionStore.hash(value);
        Long count=redis.opsForValue().increment(key);if(Long.valueOf(1).equals(count))redis.expire(key,Duration.ofMinutes(5));
        if(count!=null&&count>max)throw new ApiException(429,"登录尝试过多，请五分钟后重试");
    }
    public Map<String,Object> profile(String id) {
        List<Map<String,Object>> rows=db.queryForList("SELECT id,account,display_name,role,enabled,created_at FROM nw_user_account WHERE id=?",id);
        if(rows.isEmpty())throw new ApiException(401,"请先登录");Map<String,Object> r=rows.get(0);
        return map("id",r.get("id"),"account",r.get("account"),"name",r.get("display_name"),"role",r.get("role"),"enabled",r.get("enabled"),"createdAt",Objects.toString(r.get("created_at"),null));
    }
    public void requireAdmin(String actor) {Map<String,Object> user=profile(actor);if(!"admin".equals(user.get("role"))||!Boolean.TRUE.equals(user.get("enabled")))throw new ApiException(403,"仅管理员可以管理账号");}
    public Object list(String actor) {requireAdmin(actor);return db.queryForList("SELECT id,account,display_name AS name,role,enabled,created_at AS createdAt FROM nw_user_account ORDER BY created_at LIMIT 1000");}
    @Transactional public Object create(String actor,String name,String password,String display) {
        requireAdmin(actor);String account=account(name);validatePassword(password);String id=UUID.randomUUID().toString();
        if(display==null||display.trim().isEmpty()||display.length()>120)throw new ApiException(422,"请填写 1–120 字的姓名");
        try {db.update("INSERT INTO nw_user_account(id,account,password_hash,display_name) VALUES(?,?,?,?)",id,account,passwords.encode(password),display.trim());}
        catch(org.springframework.dao.DuplicateKeyException e){throw new ApiException(409,"账号已存在");}return profile(id);
    }
    @Transactional public Object setEnabled(String actor,String id,boolean enabled) {
        requireAdmin(actor);if(actor.equals(id)&&!enabled)throw new ApiException(422,"不能停用当前管理员");
        if(db.update("UPDATE nw_user_account SET enabled=? WHERE id=?",enabled,id)!=1)throw new ApiException(404,"账号不存在");
        if(!enabled)db.update("UPDATE nw_account_session SET revoked_at=CURRENT_TIMESTAMP(6) WHERE account_id=?",id);return profile(id);
    }
    @Transactional public void changePassword(String actor,String id,String password) {
        requireAdmin(actor);validatePassword(password);
        if(db.update("UPDATE nw_user_account SET password_hash=? WHERE id=?",passwords.encode(password),id)!=1)throw new ApiException(404,"账号不存在");
        db.update("UPDATE nw_account_session SET revoked_at=CURRENT_TIMESTAMP(6) WHERE account_id=?",id);
    }
    static String account(String value) {if(value==null||!value.trim().matches("[A-Za-z0-9_.@-]{3,64}"))throw new ApiException(422,"账号需为 3–64 位字母、数字或 _.@-");return value.trim().toLowerCase(Locale.ROOT);}
    static void validatePassword(String password) {if(password==null||password.length()<12||password.getBytes(StandardCharsets.UTF_8).length>64)throw new ApiException(422,"密码至少 12 字符，最多 64 字节");}
}
