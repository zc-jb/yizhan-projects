package com.yizhan.hotel.web;

import com.yizhan.hotel.entity.Room;
import com.yizhan.hotel.repo.ReservationRepository;
import com.yizhan.hotel.repo.RoomRepository;
import com.yizhan.hotel.repo.RoomTypeRepository;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/rooms")
public class RoomController {
    private final RoomRepository repo;
    private final RoomTypeRepository typeRepo;
    private final ReservationRepository reservationRepo;

    public RoomController(RoomRepository repo, RoomTypeRepository typeRepo, ReservationRepository reservationRepo) {
        this.repo = repo;
        this.typeRepo = typeRepo;
        this.reservationRepo = reservationRepo;
    }

    @GetMapping
    public List<Room> list(@RequestParam(required = false) String status,
                       @RequestParam(required = false) Long typeId) {
        return repo.findAll().stream()
                .filter(r -> status == null || status.isBlank() || r.getStatus().equals(status))
                .filter(r -> typeId == null || r.getTypeId().equals(typeId))
                .toList();
    }

    @GetMapping("/available")
    public List<Room> available(@RequestParam Long typeId,
                                @RequestParam String in,
                                @RequestParam String out) {
        LocalDate from = LocalDate.parse(in);
        LocalDate to = LocalDate.parse(out);
        if (!to.isAfter(from)) throw new IllegalArgumentException("离店日期必须晚于入住日期");
        return repo.findAvailable(typeId, from, to);
    }

    @PostMapping
    @CacheEvict(cacheNames = "dashboard", allEntries = true)
    public Room create(@RequestBody Room body) {
        if (body.getNo() == null || body.getNo().isBlank()) throw new IllegalArgumentException("请填写房间号");
        if (body.getTypeId() == null || typeRepo.findById(body.getTypeId()).isEmpty())
            throw new IllegalArgumentException("请选择有效房型");
        body.setId(null);
        if (body.getStatus() == null || body.getStatus().isBlank()) body.setStatus("IDLE");
        return repo.save(body);
    }

    @PutMapping("/{id}")
    @CacheEvict(cacheNames = "dashboard", allEntries = true)
    public Room update(@PathVariable Long id, @RequestBody Room body) {
        Room r = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("房间不存在"));
        if (body.getNo() != null && !body.getNo().isBlank()) r.setNo(body.getNo());
        if (body.getFloor() != null) r.setFloor(body.getFloor());
        if (body.getTypeId() != null) r.setTypeId(body.getTypeId());
        return repo.save(r);
    }

    @PutMapping("/{id}/status")
    @CacheEvict(cacheNames = "dashboard", allEntries = true)
    public Room changeStatus(@PathVariable Long id, @RequestBody Map<String, String> body) {
        Room r = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("房间不存在"));
        String status = body.getOrDefault("status", "");
        if (!List.of("IDLE", "OCCUPIED", "CLEANING", "MAINTENANCE").contains(status))
            throw new IllegalArgumentException("非法的房间状态");
        r.setStatus(status);
        return repo.save(r);
    }

    @DeleteMapping("/{id}")
    @CacheEvict(cacheNames = "dashboard", allEntries = true)
    public void delete(@PathVariable Long id) {
        if (reservationRepo.countByRoomIdAndStatusIn(id, List.of("BOOKED", "CHECKED_IN")) > 0)
            throw new IllegalArgumentException("该房间还有未完成订单，无法删除");
        repo.deleteById(id);
    }
}
