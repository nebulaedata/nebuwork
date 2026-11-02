package cn.nebulaedata.cccs.nebuwork.backend.api.identity;

import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.sql.Timestamp;
import java.time.*;
import java.util.*;

/** Opaque cookies are never stored in SQL; SQL revocation and enabled accounts are authoritative. */
@Component
public class AccountSessionStore {
    private final StringRedisTemplate redis;
    private final JdbcTemplate db;
    public static final int TTL_SECONDS = 43200;
    public static final String COOKIE_NAME = "nebuwork_session";
    private static final String PREFIX = "nebuwork:account:session:";
    public AccountSessionStore(StringRedisTemplate redis, JdbcTemplate db) { this.redis=redis;this.db=db; }
    public String findActor(String token) {
        if(token==null||!token.matches("[A-Za-z0-9_-]{43}"))return null;
        String hash=hash(token), cached=redis.opsForValue().get(PREFIX+hash);
        if(cached==null)return null;
        List<String> actors=db.query("SELECT s.account_id FROM nw_account_session s JOIN nw_user_account u ON u.id=s.account_id WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>CURRENT_TIMESTAMP(6) AND u.enabled=TRUE",(r,n)->r.getString(1),hash);
        return actors.size()==1&&cached.equals(actors.get(0))?cached:null;
    }
    @Transactional public String issue(String actor) {
        byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);
        String token=Base64.getUrlEncoder().withoutPadding().encodeToString(bytes), hash=hash(token);
        db.update("INSERT INTO nw_account_session(token_hash,account_id,expires_at) VALUES(?,?,?)",hash,actor,Timestamp.from(Instant.now().plusSeconds(TTL_SECONDS)));
        redis.opsForValue().set(PREFIX+hash,actor,Duration.ofSeconds(TTL_SECONDS));
        db.update("DELETE FROM nw_account_session WHERE expires_at<?",Timestamp.from(Instant.now().minusSeconds(86400)));
        return token;
    }
    @Transactional public void revoke(String token) {
        if(token==null||!token.matches("[A-Za-z0-9_-]{43}"))return;
        String hash=hash(token);
        db.update("UPDATE nw_account_session SET revoked_at=CURRENT_TIMESTAMP(6) WHERE token_hash=?",hash);
        try { redis.delete(PREFIX+hash); } catch(org.springframework.dao.DataAccessException ignored) { /* SQL already denies this session. */ }
    }
    static String hash(String value) {
        try { byte[] bytes=MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));StringBuilder b=new StringBuilder();for(byte v:bytes)b.append(String.format("%02x",v));return b.toString(); }
        catch(NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
}
