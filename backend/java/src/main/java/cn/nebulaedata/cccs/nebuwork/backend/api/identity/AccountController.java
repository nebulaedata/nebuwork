package cn.nebulaedata.cccs.nebuwork.backend.api.identity;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseCookie;
import org.springframework.web.bind.annotation.*;
import javax.servlet.http.*;
import static cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiSupport.ok;

@RestController
@RequestMapping("/api/auth")
public class AccountController {
    private final AccountService accounts;private final AccountSessionStore sessions;private final boolean secure;
    public AccountController(AccountService accounts,AccountSessionStore sessions,@Value("${nebu.auth.cookie-secure:false}")boolean secure){this.accounts=accounts;this.sessions=sessions;this.secure=secure;}
    @GetMapping("/public-key")public Object key(){return ok(accounts.publicKey());}
    @PostMapping("/login")public Object login(@RequestBody JsonNode body,HttpServletRequest req,HttpServletResponse res){
        String token=accounts.login(body.path("account").asText(),body.path("encryptedPassword").asText(),req.getRemoteAddr(),cookie(req));
        setCookie(res,token,AccountSessionStore.TTL_SECONDS);return ok(null);
    }
    @GetMapping("/me")public Object me(HttpServletRequest req){return ok(accounts.profile(RequestIdentity.actor(req)));}
    @PostMapping("/logout")public Object logout(HttpServletRequest req,HttpServletResponse res){sessions.revoke(cookie(req));setCookie(res,"",0);return ok(null);}
    @GetMapping("/accounts")public Object list(HttpServletRequest req){return ok(accounts.list(RequestIdentity.actor(req)));}
    @PostMapping("/accounts")public Object create(@RequestBody JsonNode b,HttpServletRequest req){return ok(accounts.create(RequestIdentity.actor(req),b.path("account").asText(),b.path("password").asText(),b.path("name").asText()));}
    @PostMapping("/accounts/{id}/enabled")public Object enable(@PathVariable String id,@RequestBody JsonNode b,HttpServletRequest req){if(!b.path("enabled").isBoolean())throw new cn.nebulaedata.cccs.nebuwork.backend.api.common.ApiException(422,"enabled 必须为布尔值");return ok(accounts.setEnabled(RequestIdentity.actor(req),id,b.path("enabled").asBoolean()));}
    @PostMapping("/accounts/{id}/password")public Object password(@PathVariable String id,@RequestBody JsonNode b,HttpServletRequest req){accounts.changePassword(RequestIdentity.actor(req),id,b.path("password").asText());return ok(null);}
    private String cookie(HttpServletRequest req){if(req.getCookies()!=null)for(Cookie c:req.getCookies())if(AccountSessionStore.COOKIE_NAME.equals(c.getName()))return c.getValue();return null;}
    private void setCookie(HttpServletResponse res,String token,int age){res.addHeader("Set-Cookie",ResponseCookie.from(AccountSessionStore.COOKIE_NAME,token).httpOnly(true).secure(secure).sameSite("Lax").path("/").maxAge(age).build().toString());}
}
