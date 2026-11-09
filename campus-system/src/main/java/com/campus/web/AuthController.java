package com.campus.web;

import com.campus.security.AuthInterceptor;
import com.campus.security.LoginUser;
import com.campus.service.AuthService;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 登录 / 退出 / 当前用户
 */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    /** 登录：管理员 admin/123456，学生 stu001/123456 */
    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody Map<String, String> body) {
        String username = body.get("username");
        if (username == null) {
            username = body.get("account");
        }
        return authService.login(username, body.get("password"));
    }

    /** 退出登录 */
    @PostMapping("/logout")
    public Map<String, Object> logout(@RequestAttribute(value = "token", required = false) String token) {
        authService.logout(token);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        return result;
    }

    /** 获取当前登录用户 */
    @GetMapping("/me")
    public Map<String, Object> me(@RequestAttribute(AuthInterceptor.CURRENT_USER) LoginUser user) {
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("user", user);
        result.put("roleLabel", user.roleLabel());
        return result;
    }
}
