package com.wps.service;

import com.wps.security.ApiException;
import com.wps.security.TokenStore;
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
                || ("wps".equalsIgnoreCase(u) && "123456".equals(p));
        if (!ok) {
            throw new ApiException(401, "账号或密码不正确");
        }
        String nick = "admin".equalsIgnoreCase(u) ? "表格管理员" : "数据专员";
        String token = tokens.issue(u);
        Map<String, Object> user = new LinkedHashMap<>();
        user.put("name", u);
        user.put("nick", nick);
        user.put("role", "管理员");
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("token", token);
        res.put("user", user);
        return res;
    }

    public void logout(String token) {
        tokens.revoke(token);
    }
}
