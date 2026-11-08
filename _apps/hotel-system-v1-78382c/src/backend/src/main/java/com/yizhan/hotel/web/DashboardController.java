package com.yizhan.hotel.web;

import com.yizhan.hotel.entity.Room;
import com.yizhan.hotel.entity.RoomType;
import com.yizhan.hotel.repo.ReservationRepository;
import com.yizhan.hotel.repo.RoomRepository;
import com.yizhan.hotel.repo.RoomTypeRepository;
import com.yizhan.hotel.service.ReservationService;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

@RestController
public class DashboardController {
    private final RoomRepository roomRepo;
    private final RoomTypeRepository typeRepo;
    private final ReservationRepository reservationRepo;
    private final ReservationService reservationService;

    public DashboardController(RoomRepository roomRepo, RoomTypeRepository typeRepo,
                               ReservationRepository reservationRepo, ReservationService reservationService) {
        this.roomRepo = roomRepo;
        this.typeRepo = typeRepo;
        this.reservationRepo = reservationRepo;
        this.reservationService = reservationService;
    }

    @GetMapping("/api/dashboard")
    @Cacheable(cacheNames = "dashboard")
    public Map<String, Object> stats() {
        LocalDate today = LocalDate.now();
        List<Room> rooms = roomRepo.findAll();
        long total = rooms.size();
        long idle = rooms.stream().filter(r -> "IDLE".equals(r.getStatus())).count();
        long occupied = rooms.stream().filter(r -> "OCCUPIED".equals(r.getStatus())).count();
        long cleaning = rooms.stream().filter(r -> "CLEANING".equals(r.getStatus())).count();
        long maintenance = rooms.stream().filter(r -> "MAINTENANCE".equals(r.getStatus())).count();

        Map<String, Object> m = new LinkedHashMap<>();
        m.put("totalRooms", total);
        m.put("idleRooms", idle);
        m.put("occupiedRooms", occupied);
        m.put("cleaningRooms", cleaning);
        m.put("maintenanceRooms", maintenance);
        m.put("occupancyRate", total == 0 ? 0 : Math.round(occupied * 10000.0 / total) / 100.0);
        m.put("todayArrivals", reservationRepo.findByCheckInDateAndStatus(today, "BOOKED").size());
        m.put("todayDepartures", reservationRepo.findByCheckOutDateAndStatus(today, "CHECKED_IN").size());
        m.put("pendingBookings", reservationRepo.countByStatus("BOOKED"));

        LocalDateTime monthStart = today.withDayOfMonth(1).atStartOfDay();
        BigDecimal revenue = reservationRepo.sumRevenue(monthStart, monthStart.plusMonths(1));
        m.put("monthRevenue", revenue == null ? BigDecimal.ZERO : revenue);

        List<RoomType> types = typeRepo.findAll();
        List<Map<String, Object>> byType = new ArrayList<>();
        for (RoomType t : types) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("typeId", t.getId());
            row.put("name", t.getName());
            row.put("price", t.getPrice());
            row.put("total", rooms.stream().filter(r -> r.getTypeId().equals(t.getId())).count());
            row.put("idle", rooms.stream().filter(r -> r.getTypeId().equals(t.getId()) && "IDLE".equals(r.getStatus())).count());
            byType.add(row);
        }
        m.put("roomTypes", byType);

        m.put("recentReservations", reservationRepo.findAllByOrderByIdDesc().stream()
                .limit(6).map(reservationService::dto).toList());
        return m;
    }
}
