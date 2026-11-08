package com.yizhan.hotel.web;

import com.yizhan.hotel.service.ReservationService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
public class BillController {
    private final ReservationService service;

    public BillController(ReservationService service) {
        this.service = service;
    }

    @GetMapping("/api/bills")
    public Map<String, Object> bills(@RequestParam(required = false) String from,
                                     @RequestParam(required = false) String to) {
        LocalDate today = LocalDate.now();
        LocalDate f = from == null || from.isBlank() ? today.withDayOfMonth(1) : LocalDate.parse(from);
        LocalDate t = to == null || to.isBlank() ? today : LocalDate.parse(to);
        if (t.isBefore(f)) throw new IllegalArgumentException("结束日期不能早于开始日期");

        List<Map<String, Object>> rows = service.bills(f, t);
        BigDecimal total = rows.stream()
                .map(r -> new BigDecimal(String.valueOf(r.get("paidAmount"))))
                .reduce(BigDecimal.ZERO, BigDecimal::add);

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("from", f);
        m.put("to", t);
        m.put("count", rows.size());
        m.put("total", total);
        m.put("list", rows);
        return m;
    }
}
