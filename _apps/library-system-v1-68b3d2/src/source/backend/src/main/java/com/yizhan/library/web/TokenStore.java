package com.yizhan.library.web;

import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class TokenStore {
    private static final long TTL_MS = 12 * 60 * 60 * 1000L;
    private final Map<String, Long> tokens = new ConcurrentHashMap<>();

    public String issue() {
        String token = UUID.randomUUID().toString().replace("-", "");
        tokens.put(token, System.currentTimeMillis() + TTL_MS);
        return token;
    }

    public boolean valid(String token) {
        if (token == null) return false;
        Long expireAt = tokens.get(token);
        if (expireAt == null) return false;
        if (expireAt < System.currentTimeMillis()) {
            tokens.remove(token);
            return false;
        }
        return true;
    }
}
