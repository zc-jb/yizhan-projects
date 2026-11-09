package com.campus.security;

import com.campus.cache.CacheService;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 简单 Token 鉴权拦截器：从 X-Token 或 Authorization: Bearer 中读取 token
 */
@Component
public class AuthInterceptor implements HandlerInterceptor {

    public static final String TOKEN_PREFIX = "campus:token:";
    public static final String CURRENT_USER = "loginUser";

    private final CacheService cacheService;
    private final ObjectMapper objectMapper;

    public AuthInterceptor(CacheService cacheService, ObjectMapper objectMapper) {
        this.cacheService = cacheService;
        this.objectMapper = objectMapper;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        // 浏览器跨域预检请求直接放行
        if ("OPTIONS".equalsIgnoreCase(request.getMethod())) {
            return true;
        }

        String token = request.getHeader("X-Token");
        if (token == null || token.isBlank()) {
            String authorization = request.getHeader("Authorization");
            if (authorization != null && authorization.startsWith("Bearer ")) {
                token = authorization.substring(7);
            }
        }
        if (token == null || token.isBlank()) {
            throw ApiException.unauthorized("请先登录");
        }

        LoginUser user = cacheService.getObject(TOKEN_PREFIX + token,
                new TypeReference<LoginUser>() {
                }, objectMapper);
        if (user == null) {
            throw ApiException.unauthorized("登录已过期，请重新登录");
        }

        request.setAttribute(CURRENT_USER, user);
        request.setAttribute("token", token);
        return true;
    }
}
