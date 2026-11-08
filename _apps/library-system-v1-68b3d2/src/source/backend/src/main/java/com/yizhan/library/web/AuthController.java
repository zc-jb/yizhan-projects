package com.yizhan.library.web;

import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class AuthController {
    private final TokenStore tokenStore;

    public AuthController(TokenStore tokenStore) {
        this.tokenStore = tokenStore;
    }

    public record LoginReq(String username, String password) {}

    @PostMapping("/auth/login")
    public Map<String, Object> login(@RequestBody LoginReq req) {
        String user = req.username() == null ? "" : req.username().trim();
        String pass = req.password() == null ? "" : req.password().trim();
        if (!("admin".equals(user) || "librarian".equals(user)) || !"123456".equals(pass)) {
            throw new ApiExceptionHandler.ApiException("账号或密码错误（演示账号：admin / 123456）");
        }
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("token", tokenStore.issue());
        body.put("username", user);
        body.put("name", "admin".equals(user) ? "系统管理员" : "图书管理员");
        return body;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "app", "library-system");
    }
}
