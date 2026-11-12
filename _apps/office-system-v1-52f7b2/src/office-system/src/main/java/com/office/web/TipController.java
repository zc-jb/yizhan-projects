package com.office.web;

import com.office.entity.Tip;
import com.office.service.TipService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/tips")
public class TipController {

    private final TipService service;

    public TipController(TipService service) {
        this.service = service;
    }

    @GetMapping
    public List<Tip> list(@RequestParam(required = false) String category,
                          @RequestParam(required = false) String q) {
        return service.list(category, q);
    }

    @GetMapping("/categories")
    public List<String> categories() {
        return service.categories();
    }

    @GetMapping("/{id}")
    public Tip detail(@PathVariable Long id) {
        return service.detail(id);
    }
}
