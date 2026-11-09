package com.campus.service;

import com.campus.cache.CacheService;
import com.campus.repo.CourseRepository;
import com.campus.repo.NoticeRepository;
import com.campus.repo.ScoreRepository;
import com.campus.repo.StudentRepository;
import com.campus.repo.TeacherRepository;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 首页看板统计服务（结果缓存 60 秒）
 */
@Service
public class DashboardService {

    private static final String STATS_CACHE_KEY = "campus:dashboard:stats:v1";
    private static final long CACHE_TTL_SECONDS = 60L;
    private static final TypeReference<Map<String, Object>> MAP_TYPE = new TypeReference<>() {
    };

    private final StudentRepository studentRepository;
    private final TeacherRepository teacherRepository;
    private final CourseRepository courseRepository;
    private final ScoreRepository scoreRepository;
    private final NoticeRepository noticeRepository;
    private final CacheService cacheService;
    private final ObjectMapper objectMapper;

    public DashboardService(StudentRepository studentRepository,
                            TeacherRepository teacherRepository,
                            CourseRepository courseRepository,
                            ScoreRepository scoreRepository,
                            NoticeRepository noticeRepository,
                            CacheService cacheService,
                            ObjectMapper objectMapper) {
        this.studentRepository = studentRepository;
        this.teacherRepository = teacherRepository;
        this.courseRepository = courseRepository;
        this.scoreRepository = scoreRepository;
        this.noticeRepository = noticeRepository;
        this.cacheService = cacheService;
        this.objectMapper = objectMapper;
    }

    /** 看板统计，Redis/Memory 缓存 60 秒 */
    public Map<String, Object> stats() {
        return cacheService.getOrLoad(STATS_CACHE_KEY, CACHE_TTL_SECONDS, MAP_TYPE, () -> {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("studentCount", studentRepository.count());
            map.put("teacherCount", teacherRepository.count());
            map.put("courseCount", courseRepository.count());
            map.put("noticeCount", noticeRepository.count());
            map.put("todayNoticeCount",
                    noticeRepository.countByCreatedAtAfter(LocalDate.now().atStartOfDay()));
            map.put("scoreCount", scoreRepository.count());

            Double average = scoreRepository.averageScore();
            double rounded = average == null ? 0D : Math.round(average * 10) / 10D;
            map.put("averageScore", rounded);
            map.put("updatedAt", LocalDateTime.now()
                    .format(DateTimeFormatter.ofPattern("HH:mm:ss")));
            map.put("cacheTtl", CACHE_TTL_SECONDS);
            return map;
        }, objectMapper);
    }
}
