package com.office.service;

import com.office.security.ApiException;
import com.office.security.TokenStore;
import org.springframework.stereotype.Service;

import java.util.LinkedHashMap;
import java.util.Map;

@Service
public class AuthService {

    private final TokenStore tokens;

    public AuthService(TokenStore tokens) {
        this.tokens = tokens;
    }

    public Map<String, Object> login(String username, String password) {
        if (username == null || username.isBlank()) {
            throw new ApiException(400, "请输入账号");
        }
        String u = username.trim();
        String p = password == null ? "" : password;
        boolean ok = ("admin".equalsIgnoreCase(u) && ("123456".equals(p) || "admin123".equals(p)))
                || ("office".equalsIgnoreCase(u) && "123456".equals(p));
        if (!ok) {
            throw new ApiException(401, "账号或密码不正确");
        }
        String nick = "admin".equalsIgnoreCase(u) ? "行政管理员" : "办公专员";
        String token = tokens.issue(u);
        Map<String, Object> user = new LinkedHashMap<>();
        user.put("name", u);
        user.put("nick", nick);
        user.put("role", "系统管理员");
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("token", token);
        res.put("user", user);
        return res;
    }

    public void logout(String token) {
        tokens.revoke(token);
    }
}
