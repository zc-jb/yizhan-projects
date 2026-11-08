package com.yizhan.hotel.web;

import com.yizhan.hotel.entity.RoomType;
import com.yizhan.hotel.repo.RoomRepository;
import com.yizhan.hotel.repo.RoomTypeRepository;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/room-types")
public class RoomTypeController {
    private final RoomTypeRepository repo;
    private final RoomRepository roomRepo;

    public RoomTypeController(RoomTypeRepository repo, RoomRepository roomRepo) {
        this.repo = repo;
        this.roomRepo = roomRepo;
    }

    @GetMapping
    @Cacheable(cacheNames = "roomTypes")
    public List<RoomType> list() {
        return repo.findAll();
    }

    @PostMapping
    @CacheEvict(cacheNames = {"roomTypes", "dashboard"}, allEntries = true)
    public RoomType create(@RequestBody RoomType body) {
        if (body.getName() == null || body.getName().isBlank()) throw new IllegalArgumentException("请填写房型名称");
        if (body.getPrice() == null || body.getPrice().signum() <= 0) throw new IllegalArgumentException("价格必须大于 0");
        if (body.getCapacity() == null || body.getCapacity() <= 0) throw new IllegalArgumentException("可住人数必须大于 0");
        body.setId(null);
        return repo.save(body);
    }

    @PutMapping("/{id}")
    @CacheEvict(cacheNames = {"roomTypes", "dashboard"}, allEntries = true)
    public RoomType update(@PathVariable Long id, @RequestBody RoomType body) {
        RoomType t = repo.findById(id).orElseThrow(() -> new IllegalArgumentException("房型不存在"));
        t.setName(body.getName());
        t.setPrice(body.getPrice());
        t.setCapacity(body.getCapacity());
        t.setBedType(body.getBedType());
        t.setDescription(body.getDescription());
        return repo.save(t);
    }

    @DeleteMapping("/{id}")
    @CacheEvict(cacheNames = {"roomTypes", "dashboard"}, allEntries = true)
    public void delete(@PathVariable Long id) {
        if (roomRepo.countByTypeId(id) > 0) throw new IllegalArgumentException("该房型下还有房间，无法删除");
        repo.deleteById(id);
    }
}
