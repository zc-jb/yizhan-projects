package com.office.web;

import com.office.service.AuthService;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;

    public AuthController(AuthService auth) {
        this.auth = auth;
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, Object> body) {
        return auth.login(str(body.get("username")), str(body.get("password")));
    }

    @PostMapping("/logout")
    public Map<String, Object> logout(@RequestHeader(value = "X-Token", required = false) String token) {
        auth.logout(token);
        return Map.of("ok", true);
    }

    @GetMapping("/me")
    public Map<String, Object> me(@RequestAttribute("user") String user) {
        return Map.of("name", user, "nick", "admin".equalsIgnoreCase(user) ? "行政管理员" : "办公专员");
    }

    private String str(Object o) {
        return o == null ? "" : String.valueOf(o);
    }
}
