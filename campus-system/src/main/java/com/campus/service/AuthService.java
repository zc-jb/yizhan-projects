package com.campus.service;

import com.campus.cache.CacheService;
import com.campus.entity.AdminUser;
import com.campus.entity.Student;
import com.campus.repo.AdminUserRepository;
import com.campus.repo.StudentRepository;
import com.campus.security.ApiException;
import com.campus.security.AuthInterceptor;
import com.campus.security.LoginUser;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * 登录鉴权服务：简单 UUID Token + 缓存存储
 */
@Service
public class AuthService {

    /** Token 有效期：7 天 */
    private static final long TOKEN_TTL_SECONDS = 7 * 24 * 3600L;

    private final AdminUserRepository adminUserRepository;
    private final StudentRepository studentRepository;
    private final CacheService cacheService;
    private final ObjectMapper objectMapper;

    public AuthService(AdminUserRepository adminUserRepository,
                       StudentRepository studentRepository,
                       CacheService cacheService,
                       ObjectMapper objectMapper) {
        this.adminUserRepository = adminUserRepository;
        this.studentRepository = studentRepository;
        this.cacheService = cacheService;
        this.objectMapper = objectMapper;
    }

    /** 账号密码登录，管理员与学生共用入口 */
    public Map<String, Object> login(String username, String password) {
        if (username == null || username.isBlank() || password == null || password.isBlank()) {
            throw ApiException.badRequest("请输入账号和密码");
        }

        String account = username.trim();
        String passwordHash = sha256(password);
        LoginUser loginUser = null;

        // 1. 先按管理员账号查找
        AdminUser admin = adminUserRepository.findByUsername(account).orElse(null);
        if (admin != null && admin.getPassword().equals(passwordHash)) {
            loginUser = new LoginUser(admin.getId(), admin.getUsername(), admin.getRealName(),
                    "ADMIN", null, null);
        }

        // 2. 再按学生学号查找
        if (loginUser == null) {
            Student student = studentRepository.findByStudentNo(account).orElse(null);
            if (student != null && student.getPassword().equals(passwordHash)) {
                loginUser = new LoginUser(student.getId(), student.getStudentNo(), student.getName(),
                        "STUDENT", student.getStudentNo(), student.getClassName());
            }
        }

        if (loginUser == null) {
            throw ApiException.unauthorized("账号或密码错误");
        }

        String token = UUID.randomUUID().toString().replace("-", "");
        try {
            cacheService.put(AuthInterceptor.TOKEN_PREFIX + token,
                    objectMapper.writeValueAsString(loginUser), TOKEN_TTL_SECONDS);
        } catch (Exception e) {
            throw new ApiException(500, "登录状态保存失败");
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("token", token);
        result.put("user", loginUser);
        result.put("roleLabel", loginUser.roleLabel());
        return result;
    }

    /** 退出登录：删除缓存中的 token */
    public void logout(String token) {
        if (token != null && !token.isBlank()) {
            cacheService.delete(AuthInterceptor.TOKEN_PREFIX + token);
        }
    }

    /** SHA-256 摘要 */
    public static String sha256(String raw) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(raw.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("当前 JDK 不支持 SHA-256", e);
        }
    }
}
