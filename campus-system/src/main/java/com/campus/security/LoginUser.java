package com.campus.security;

import com.fasterxml.jackson.annotation.JsonIgnore;

import java.io.Serializable;

/**
 * 登录用户信息（存入 Redis / 内存缓存，随 token 关联）
 */
public record LoginUser(
        Long id,
        String username,
        String name,
        String role,
        String studentNo,
        String className
) implements Serializable {

    /** 是否为管理员 */
    @JsonIgnore
    public boolean isAdmin() {
        return "ADMIN".equals(role);
    }

    /** 角色中文名 */
    @JsonIgnore
    public String roleLabel() {
        return isAdmin() ? "管理员" : "学生";
    }

    /** 管理员权限校验 */
    public void requireAdmin() {
        if (!isAdmin()) {
            throw ApiException.forbidden("仅管理员可执行该操作");
        }
    }
}
