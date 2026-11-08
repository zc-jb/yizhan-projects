package com.yizhan.hotel.security;

public final class AuthContext {
    private static final ThreadLocal<SessionUser> HOLDER = new ThreadLocal<>();

    private AuthContext() {}

    public static void set(SessionUser user) { HOLDER.set(user); }
    public static SessionUser get() { return HOLDER.get(); }
    public static void clear() { HOLDER.remove(); }
}
