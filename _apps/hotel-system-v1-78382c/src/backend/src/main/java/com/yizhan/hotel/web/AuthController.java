package com.yizhan.hotel.web;

import com.yizhan.hotel.entity.User;
import com.yizhan.hotel.repo.UserRepository;
import com.yizhan.hotel.security.AuthContext;
import com.yizhan.hotel.security.JwtUtil;
import com.yizhan.hotel.security.SessionUser;
import com.yizhan.hotel.web.dto.LoginRequest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {
    private final UserRepository userRepo;
    private final PasswordEncoder encoder;
    private final JwtUtil jwtUtil;

    public AuthController(UserRepository userRepo, PasswordEncoder encoder, JwtUtil jwtUtil) {
        this.userRepo = userRepo;
        this.encoder = encoder;
        this.jwtUtil = jwtUtil;
    }

    @PostMapping("/login")
    public Map<String, Object> login(@RequestBody LoginRequest req) {
        String username = req.username() == null ? "" : req.username().trim();
        String password = req.password() == null ? "" : req.password();
        if (username.isEmpty() || password.isEmpty())
            throw new IllegalArgumentException("请输入账号和密码");
        User u = userRepo.findByUsername(username)
                .orElseThrow(() -> new IllegalArgumentException("账号不存在"));
        if (!encoder.matches(password, u.getPassword()))
            throw new IllegalArgumentException("密码不正确");

        Map<String, Object> user = new LinkedHashMap<>();
        user.put("username", u.getUsername());
        user.put("name", u.getName());
        user.put("role", u.getRole());

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("token", jwtUtil.create(u.getUsername(), u.getRole()));
        res.put("user", user);
        return res;
    }

    @GetMapping("/me")
    public Map<String, Object> me() {
        SessionUser s = AuthContext.get();
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("username", s.username());
        m.put("role", s.role());
        return m;
    }
}
