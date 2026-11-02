package cn.nebulaedata.cccs.nebuwork.backend.api.identity;

import cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.*;
import org.springframework.boot.DefaultApplicationArguments;
import org.springframework.core.io.ClassPathResource;
import org.springframework.data.redis.core.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import javax.crypto.Cipher;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.spec.X509EncodedKeySpec;
import java.time.Duration;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class AccountSecurityTest {
    private JdbcTemplate db;private AccountService accounts;private AccountSessionStore sessions;
    private final Map<String,String> cache=new HashMap<>();
    private static final String PASSWORD="correct-password-2026";
    @BeforeEach @SuppressWarnings("unchecked") void prepare() {
        JdbcDataSource source=new JdbcDataSource();source.setURL("jdbc:h2:mem:"+UUID.randomUUID()+";MODE=MySQL;DATABASE_TO_LOWER=TRUE;DB_CLOSE_DELAY=-1");
        // Run the actual account migration, including its constraints.
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V29__local_accounts.sql")).execute(source);
        db=new JdbcTemplate(source);db.execute("CREATE TABLE nw_agent_engine_admin(owner_id VARCHAR(128) PRIMARY KEY)");
        StringRedisTemplate redis=mock(StringRedisTemplate.class);ValueOperations<String,String> values=mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        when(values.get(anyString())).thenAnswer(i->cache.get(i.getArgument(0)));
        doAnswer(i->{cache.put(i.getArgument(0),i.getArgument(1));return null;}).when(values).set(anyString(),anyString(),any(Duration.class));
        when(values.increment(anyString())).thenReturn(1L);
        when(redis.delete(anyString())).thenAnswer(i->cache.remove(i.getArgument(0))!=null);
        sessions=new AccountSessionStore(redis,db);
        MockEnvironment env=new MockEnvironment().withProperty("nebu.auth.bootstrap.enabled","true").withProperty("nebu.auth.bootstrap.id","admin-id").withProperty("nebu.auth.bootstrap.account","admin").withProperty("nebu.auth.bootstrap.password",PASSWORD);
        accounts=new AccountService(db,redis,env,sessions);accounts.run(new DefaultApplicationArguments());
    }
    private String encrypt(String value) throws Exception {
        String pem=((Map<?,?>)accounts.publicKey()).get("publicKey").toString().replaceAll("-----[^-]+-----","").replaceAll("\\s","");
        Cipher cipher=Cipher.getInstance("RSA/ECB/PKCS1Padding");cipher.init(Cipher.ENCRYPT_MODE,KeyFactory.getInstance("RSA").generatePublic(new X509EncodedKeySpec(Base64.getDecoder().decode(pem))));
        return Base64.getEncoder().encodeToString(cipher.doFinal(value.getBytes(StandardCharsets.UTF_8)));
    }
    @Test void storesOnlyBcryptAndRejectsWrongPasswordAndForeignRedisSessions() throws Exception {
        String hash=db.queryForObject("SELECT password_hash FROM nw_user_account WHERE id='admin-id'",String.class);
        assertNotEquals(PASSWORD,hash);assertTrue(new BCryptPasswordEncoder().matches(PASSWORD,hash));
        assertFalse(accounts.profile("admin-id").containsKey("password_hash"));
        assertEquals(401,assertThrows(ApiException.class,()->accounts.login("admin",encrypt("wrong-password"),"test",null)).status);
        assertNull(sessions.findActor("old-user-service-token"));
        String fake=Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[32]);
        cache.put("nebuwork:account:session:"+AccountSessionStore.hash(fake),"admin-id");
        assertNull(sessions.findActor(fake));
    }
    @Test void logoutExpirationAndPasswordResetImmediatelyDenyExistingSessions() throws Exception {
        String token=accounts.login("admin",encrypt(PASSWORD),"test",null);
        assertEquals("admin-id",sessions.findActor(token));
        assertEquals(0,db.queryForObject("SELECT COUNT(*) FROM nw_account_session WHERE token_hash=?",Integer.class,token));
        sessions.revoke(token);assertNull(sessions.findActor(token));
        String second=accounts.login("admin",encrypt(PASSWORD),"test",null);
        accounts.changePassword("admin-id","admin-id","new-password-2026");
        assertNull(sessions.findActor(second));
        String third=accounts.login("admin",encrypt("new-password-2026"),"test",null);
        db.update("UPDATE nw_account_session SET expires_at=? WHERE token_hash=?",new java.sql.Timestamp(0),AccountSessionStore.hash(third));
        assertNull(sessions.findActor(third));
    }
    @Test void onlyAdminsManageAccountsAndDisableCannotReviveOldSessions() throws Exception {
        Map<?,?> user=(Map<?,?>)accounts.create("admin-id","Alice",PASSWORD,"Alice");String id=user.get("id").toString();
        assertEquals("alice",user.get("account"));assertEquals("user",user.get("role"));
        assertEquals(403,assertThrows(ApiException.class,()->accounts.list(id)).status);
        String token=accounts.login("alice",encrypt(PASSWORD),"test",null);
        accounts.setEnabled("admin-id",id,false);assertNull(sessions.findActor(token));
        assertEquals(401,assertThrows(ApiException.class,()->accounts.login("alice",encrypt(PASSWORD),"test",null)).status);
        accounts.setEnabled("admin-id",id,true);assertNull(sessions.findActor(token));
        assertEquals(422,assertThrows(ApiException.class,()->accounts.setEnabled("admin-id","admin-id",false)).status);
    }
    @Test void repeatedBootstrapDoesNotResetAdminPassword() {
        accounts.changePassword("admin-id","admin-id","changed-password-2026");
        accounts.run(new DefaultApplicationArguments());
        assertTrue(new BCryptPasswordEncoder().matches("changed-password-2026",db.queryForObject("SELECT password_hash FROM nw_user_account WHERE id='admin-id'",String.class)));
        assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM nw_user_account",Integer.class));
    }
}
