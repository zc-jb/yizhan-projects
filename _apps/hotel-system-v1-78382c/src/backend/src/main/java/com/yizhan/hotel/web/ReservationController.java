package com.yizhan.hotel.web;

import com.yizhan.hotel.service.ReservationService;
import com.yizhan.hotel.web.dto.CheckoutRequest;
import com.yizhan.hotel.web.dto.ReservationRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/reservations")
public class ReservationController {
    private final ReservationService service;

    public ReservationController(ReservationService service) {
        this.service = service;
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestParam(required = false) String status,
                                          @RequestParam(required = false) String q) {
        return service.list(status, q);
    }

    @GetMapping("/{id}")
    public Map<String, Object> get(@PathVariable Long id) {
        return service.get(id);
    }

    @PostMapping
    public Map<String, Object> create(@RequestBody ReservationRequest req) {
        return service.create(req.guestId(), req.roomId(), req.checkInDate(), req.checkOutDate(), req.remark());
    }

    @PutMapping("/{id}")
    public Map<String, Object> update(@PathVariable Long id, @RequestBody ReservationRequest req) {
        return service.update(id, req.guestId(), req.roomId(), req.checkInDate(), req.checkOutDate(), req.remark());
    }

    @PostMapping("/{id}/checkin")
    public Map<String, Object> checkin(@PathVariable Long id) {
        return service.checkin(id);
    }

    @PostMapping("/{id}/checkout")
    public Map<String, Object> checkout(@PathVariable Long id, @RequestBody(required = false) CheckoutRequest req) {
        return service.checkout(id, req == null ? "CASH" : req.paymentMethod());
    }

    @PostMapping("/{id}/cancel")
    public Map<String, Object> cancel(@PathVariable Long id) {
        return service.cancel(id);
    }
}
