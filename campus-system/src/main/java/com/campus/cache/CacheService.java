package com.campus.cache;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * 缓存服务：优先使用 Redis，Redis 不可用时自动降级为进程内 ConcurrentHashMap。
 * 任何 Redis 异常均被吞掉，保证应用启动和接口调用不受影响。
 */
@Service
public class CacheService {

    private static final Logger log = LoggerFactory.getLogger(CacheService.class);

    /** Redis 故障后的重试冷却时间（毫秒），避免每个请求都等待连接超时 */
    private static final long RETRY_COOLDOWN_MS = 60_000L;

    private final StringRedisTemplate redisTemplate;
    private final Map<String, MemoryEntry> memory = new ConcurrentHashMap<>();

    private volatile long redisRetryAt = 0L;
    private volatile boolean redisWarned = false;

    public CacheService(ObjectProvider<StringRedisTemplate> provider) {
        this.redisTemplate = provider.getIfAvailable();
    }

    /** 写入字符串缓存 */
    public void put(String key, String value, long ttlSeconds) {
        // 内存中始终保留一份，Redis 中途故障时仍可继续使用
        memory.put(key, new MemoryEntry(value, System.currentTimeMillis() + ttlSeconds * 1000));
        purgeIfNeeded();
        tryRedis(template -> template.opsForValue().set(key, value, Duration.ofSeconds(ttlSeconds)));
    }

    /** 读取字符串缓存 */
    public String get(String key) {
        MemoryEntry entry = memory.get(key);
        if (entry != null) {
            if (entry.expireAt > System.currentTimeMillis()) {
                return entry.value;
            }
            memory.remove(key);
        }

        final String[] holder = new String[1];
        boolean ok = tryRedis(template -> holder[0] = template.opsForValue().get(key));
        return ok ? holder[0] : null;
    }

    /** 删除缓存 */
    public void delete(String key) {
        memory.remove(key);
        tryRedis(template -> template.delete(key));
    }

    /** 读取 JSON 对象缓存 */
    public <T> T getObject(String key, TypeReference<T> type, ObjectMapper mapper) {
        String raw = get(key);
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return mapper.readValue(raw, type);
        } catch (Exception e) {
            // 缓存内容损坏时直接删除，交由调用方重新加载
            delete(key);
            return null;
        }
    }

    /**
     * 读取缓存，未命中时执行 loader 并回写。
     */
    public <T> T getOrLoad(String key, long ttlSeconds, TypeReference<T> type,
                           Supplier<T> loader, ObjectMapper mapper) {
        T cached = getObject(key, type, mapper);
        if (cached != null) {
            return cached;
        }
        T value = loader.get();
        if (value != null) {
            try {
                put(key, mapper.writeValueAsString(value), ttlSeconds);
            } catch (JsonProcessingException e) {
                log.warn("缓存序列化失败: {}", e.getMessage());
            }
        }
        return value;
    }

    /** 当前是否正在使用 Redis（仅用于状态展示） */
    public boolean isRedisActive() {
        return redisTemplate != null && System.currentTimeMillis() >= redisRetryAt;
    }

    /**
     * 执行 Redis 操作；失败时标记冷却并返回 false。
     */
    private boolean tryRedis(Consumer<StringRedisTemplate> action) {
        if (redisTemplate == null || System.currentTimeMillis() < redisRetryAt) {
            return false;
        }
        try {
            action.accept(redisTemplate);
            redisWarned = false;
            return true;
        } catch (Exception e) {
            redisRetryAt = System.currentTimeMillis() + RETRY_COOLDOWN_MS;
            if (!redisWarned) {
                redisWarned = true;
                log.warn("Redis 不可用，已自动降级为进程内缓存（{} 秒后重试）: {}",
                        RETRY_COOLDOWN_MS / 1000, e.getMessage());
            }
            return false;
        }
    }

    /** 内存缓存条目过多时清理过期数据，防止无限增长 */
    private void purgeIfNeeded() {
        if (memory.size() < 500) {
            return;
        }
        long now = System.currentTimeMillis();
        memory.entrySet().removeIf(item -> item.getValue().expireAt <= now);
    }

    private record MemoryEntry(String value, long expireAt) {
    }
}
