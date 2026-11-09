package com.campus.web;

import com.campus.service.DashboardService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/**
 * 首页统计看板
 */
@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final DashboardService dashboardService;

    public DashboardController(DashboardService dashboardService) {
        this.dashboardService = dashboardService;
    }

    /** 学生数、教师数、课程数、今日公告数等，缓存 60 秒 */
    @GetMapping("/stats")
    public Map<String, Object> stats() {
        return dashboardService.stats();
    }
}
