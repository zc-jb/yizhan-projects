package com.office.web;

import com.office.entity.Report;
import com.office.service.ReportService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/reports")
public class ReportController {

    private final ReportService service;

    public ReportController(ReportService service) {
        this.service = service;
    }

    @GetMapping
    public List<Report> list() {
        return service.list();
    }

    @GetMapping("/{id}")
    public Report get(@PathVariable Long id) {
        return service.get(id);
    }

    @PostMapping
    public Report create(@RequestBody Map<String, Object> body,
                         @RequestAttribute(value = "user", required = false) String user) {
        return service.create(body, user);
    }

    @PutMapping("/{id}")
    public Report update(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return service.update(id, body);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        service.delete(id);
        return Map.of("ok", true);
    }
}
