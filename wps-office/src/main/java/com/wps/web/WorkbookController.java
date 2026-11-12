package com.wps.web;

import com.wps.service.WorkbookService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/workbooks")
public class WorkbookController {

    private final WorkbookService service;

    public WorkbookController(WorkbookService service) {
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list() {
        return service.list();
    }

    @GetMapping("/trash")
    public List<Map<String, Object>> trash() {
        return service.trash();
    }

    @DeleteMapping("/trash")
    public Map<String, Object> emptyTrash() {
        service.emptyTrash();
        return Map.of("ok", true);
    }

    @PostMapping("/{id}/restore")
    public Map<String, Object> restore(@PathVariable Long id) {
        service.restore(id);
        return Map.of("ok", true);
    }

    @GetMapping("/{id}")
    public Map<String, Object> detail(@PathVariable Long id) {
        return service.detail(id);
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody Map<String, Object> body,
                                      @RequestAttribute(value = "user", required = false) String user) {
        return service.create(body, user);
    }

    @PutMapping("/{id}")
    public Map<String, Object> save(@PathVariable Long id, @RequestBody Map<String, Object> body) {
        return service.save(id, body);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id) {
        service.delete(id);
        return Map.of("ok", true);
    }
}
