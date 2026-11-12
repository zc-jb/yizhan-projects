package com.wps.seed;

import com.wps.service.WorkbookService;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

@Component
public class DataSeeder implements CommandLineRunner {

    private final WorkbookService service;

    public DataSeeder(WorkbookService service) {
        this.service = service;
    }

    @Override
    public void run(String... args) {
        service.seedIfEmpty();
    }
}
