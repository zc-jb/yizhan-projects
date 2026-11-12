package com.office.security;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * 演示用内存 Token 存储：登录签发，退出或重启失效。
 */
@Component
public class TokenStore {

    private final Map<String, String> tokens = new ConcurrentHashMap<>();

    public String issue(String username) {
        String token = UUID.randomUUID().toString().replace("-", "");
        tokens.put(token, username);
        return token;
    }

    public String userOf(String token) {
        return token == null ? null : tokens.get(token);
    }

    public void revoke(String token) {
        if (token != null) tokens.remove(token);
    }
}
