package com.office.web;

import com.office.service.StatsService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api")
public class StatsController {

    private final StatsService service;

    public StatsController(StatsService service) {
        this.service = service;
    }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        return service.dashboard();
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of("ok", true, "app", "Workplace--Office Software", "stack", "Vue3 + Spring Boot 3 + MySQL");
    }
}
