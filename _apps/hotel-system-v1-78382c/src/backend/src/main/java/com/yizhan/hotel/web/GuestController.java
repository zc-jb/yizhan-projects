package com.yizhan.hotel.web;

import com.yizhan.hotel.entity.Guest;
import com.yizhan.hotel.repo.GuestRepository;
import com.yizhan.hotel.repo.ReservationRepository;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/guests")
public class GuestController {
    private final GuestRepository repo;
    private final ReservationRepository reservationRepo;

    public GuestController(GuestRepository repo, ReservationRepository reservationRepo) {
        this.repo = repo;
        this.reservationRepo = reservationRepo;
    }

    @GetMapping
    public List<Guest> list(@RequestParam(required = false) String q) {
        if (q == null || q.isBlank()) return repo.findAll();
        return repo.findByNameContainingOrPhoneContainingOrderByIdDesc(q, q);
    }

    @PostMapping
    public Guest create(@RequestBody Guest body) {
        if (body.getName() == null || body.getName().isBlank()) throw new IllegalArgumentException("请填写客人姓名");
        body.setId(null);
        return repo.save(body);
    }

    @PutMapping("/{id}")
    public Guest update(@PathVariable Long id, @RequestBody Guest body) {
        Guest g = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("客人不存在"));
        g.setName(body.getName());
        g.setPhone(body.getPhone());
        g.setIdCard(body.getIdCard());
        g.setGender(body.getGender());
        g.setRemark(body.getRemark());
        return repo.save(g);
    }

    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {
        if (reservationRepo.countByGuestId(id) > 0)
            throw new IllegalArgumentException("该客人存在历史订单，无法删除");
        repo.deleteById(id);
    }
}
