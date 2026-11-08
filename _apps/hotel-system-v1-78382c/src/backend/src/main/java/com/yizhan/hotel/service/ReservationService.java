package com.yizhan.hotel.service;

import com.yizhan.hotel.entity.Guest;
import com.yizhan.hotel.entity.Reservation;
import com.yizhan.hotel.entity.Room;
import com.yizhan.hotel.entity.RoomType;
import com.yizhan.hotel.repo.GuestRepository;
import com.yizhan.hotel.repo.ReservationRepository;
import com.yizhan.hotel.repo.RoomRepository;
import com.yizhan.hotel.repo.RoomTypeRepository;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.*;

@Service
public class ReservationService {
    private static final Set<String> ACTIVE = Set.of("BOOKED", "CHECKED_IN");

    private final ReservationRepository reservationRepo;
    private final RoomRepository roomRepo;
    private final RoomTypeRepository typeRepo;
    private final GuestRepository guestRepo;

    public ReservationService(ReservationRepository reservationRepo, RoomRepository roomRepo,
                              RoomTypeRepository typeRepo, GuestRepository guestRepo) {
        this.reservationRepo = reservationRepo;
        this.roomRepo = roomRepo;
        this.typeRepo = typeRepo;
        this.guestRepo = guestRepo;
    }

    public Map<String, Object> dto(Reservation r) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", r.getId());
        m.put("code", r.getCode());
        m.put("status", r.getStatus());
        m.put("checkInDate", r.getCheckInDate());
        m.put("checkOutDate", r.getCheckOutDate());
        m.put("totalAmount", r.getTotalAmount());
        m.put("paidAmount", r.getPaidAmount());
        m.put("paymentMethod", r.getPaymentMethod());
        m.put("remark", r.getRemark());
        m.put("createdAt", r.getCreatedAt());
        m.put("checkedInAt", r.getCheckedInAt());
        m.put("checkedOutAt", r.getCheckedOutAt());

        Guest g = guestRepo.findById(r.getGuestId()).orElse(null);
        m.put("guestId", r.getGuestId());
        m.put("guestName", g == null ? "未知客人" : g.getName());
        m.put("guestPhone", g == null ? "" : g.getPhone());

        Room room = roomRepo.findById(r.getRoomId()).orElse(null);
        m.put("roomId", r.getRoomId());
        m.put("roomNo", room == null ? "-" : room.getNo());
        if (room != null) {
            RoomType t = typeRepo.findById(room.getTypeId()).orElse(null);
            m.put("typeName", t == null ? "-" : t.getName());
        }
        return m;
    }

    public List<Map<String, Object>> list(String status, String keyword) {
        List<Reservation> rows = (status == null || status.isBlank())
                ? reservationRepo.findAllByOrderByIdDesc()
                : reservationRepo.findByStatusOrderByIdDesc(status);
        String kw = keyword == null ? "" : keyword.trim().toLowerCase();
        return rows.stream()
                .map(this::dto)
                .filter(m -> kw.isEmpty()
                        || String.valueOf(m.get("guestName")).toLowerCase().contains(kw)
                        || String.valueOf(m.get("guestPhone")).contains(kw)
                        || String.valueOf(m.get("roomNo")).contains(kw)
                        || String.valueOf(m.get("code")).toLowerCase().contains(kw))
                .toList();
    }

    public Map<String, Object> get(Long id) {
        return dto(find(id));
    }

    @Transactional
    @CacheEvict(value = "dashboard", allEntries = true)
    public Map<String, Object> create(Long guestId, Long roomId, LocalDate in, LocalDate out, String remark) {
        validate(guestId, roomId, in, out);
        Room room = roomRepo.findById(roomId).orElseThrow(() -> new IllegalArgumentException("房间不存在"));
        if (!"IDLE".equals(room.getStatus()))
            throw new IllegalArgumentException("该房间当前不可预订（状态：" + room.getStatus() + "）");
        if (reservationRepo.hasOverlap(roomId, in, out))
            throw new IllegalArgumentException("该房间在所选日期已被预订，请换一个房间或日期");

        Reservation r = new Reservation();
        r.setCode(nextCode());
        r.setGuestId(guestId);
        r.setRoomId(roomId);
        r.setCheckInDate(in);
        r.setCheckOutDate(out);
        r.setStatus("BOOKED");
        r.setRemark(remark);
        r.setTotalAmount(amount(room, in, out));
        return dto(reservationRepo.save(r));
    }

    @Transactional
    @CacheEvict(value = "dashboard", allEntries = true)
    public Map<String, Object> update(Long id, Long guestId, Long roomId, LocalDate in, LocalDate out, String remark) {
        Reservation r = find(id);
        if (!"BOOKED".equals(r.getStatus())) throw new IllegalArgumentException("只有待入住状态可修改");
        validate(guestId, roomId, in, out);
        if (reservationRepo.hasOverlap(roomId, in, out) && !Objects.equals(roomId, r.getRoomId()))
            throw new IllegalArgumentException("该房间在所选日期已被预订");
        Room room = roomRepo.findById(roomId).orElseThrow(() -> new IllegalArgumentException("房间不存在"));
        r.setGuestId(guestId);
        r.setRoomId(roomId);
        r.setCheckInDate(in);
        r.setCheckOutDate(out);
        r.setRemark(remark);
        r.setTotalAmount(amount(room, in, out));
        return dto(reservationRepo.save(r));
    }

    @Transactional
    @CacheEvict(value = "dashboard", allEntries = true)
    public Map<String, Object> checkin(Long id) {
        Reservation r = find(id);
        if (!"BOOKED".equals(r.getStatus())) throw new IllegalArgumentException("只有待入住订单可以办理入住");
        Room room = roomRepo.findById(r.getRoomId()).orElseThrow(() -> new IllegalArgumentException("房间不存在"));
        if (!"IDLE".equals(room.getStatus())) throw new IllegalArgumentException("房间状态不是空闲，无法入住");
        r.setStatus("CHECKED_IN");
        r.setCheckedInAt(LocalDateTime.now());
        room.setStatus("OCCUPIED");
        roomRepo.save(room);
        return dto(reservationRepo.save(r));
    }

    @Transactional
    @CacheEvict(value = "dashboard", allEntries = true)
    public Map<String, Object> checkout(Long id, String paymentMethod) {
        Reservation r = find(id);
        if (!"CHECKED_IN".equals(r.getStatus())) throw new IllegalArgumentException("只有已入住订单可以退房");
        if (paymentMethod == null || paymentMethod.isBlank()) paymentMethod = "CASH";
        r.setStatus("CHECKED_OUT");
        r.setCheckedOutAt(LocalDateTime.now());
        r.setPaidAmount(r.getTotalAmount());
        r.setPaymentMethod(paymentMethod);
        Room room = roomRepo.findById(r.getRoomId()).orElse(null);
        if (room != null) {
            room.setStatus("CLEANING");
            roomRepo.save(room);
        }
        return dto(reservationRepo.save(r));
    }

    @Transactional
    @CacheEvict(value = "dashboard", allEntries = true)
    public Map<String, Object> cancel(Long id) {
        Reservation r = find(id);
        if (!"BOOKED".equals(r.getStatus())) throw new IllegalArgumentException("只有待入住订单可以取消");
        r.setStatus("CANCELLED");
        return dto(reservationRepo.save(r));
    }

    private Reservation find(Long id) {
        return reservationRepo.findById(id).orElseThrow(() -> new IllegalArgumentException("订单不存在"));
    }

    private void validate(Long guestId, Long roomId, LocalDate in, LocalDate out) {
        if (guestId == null || guestRepo.findById(guestId).isEmpty())
            throw new IllegalArgumentException("请选择有效的客人");
        if (roomId == null || roomRepo.findById(roomId).isEmpty())
            throw new IllegalArgumentException("请选择有效的房间");
        if (in == null || out == null) throw new IllegalArgumentException("请选择入住和离店日期");
        if (!out.isAfter(in)) throw new IllegalArgumentException("离店日期必须晚于入住日期");
        if (ChronoUnit.DAYS.between(in, out) > 60) throw new IllegalArgumentException("单次预订最长 60 晚");
    }

    private BigDecimal amount(Room room, LocalDate in, LocalDate out) {
        RoomType t = typeRepo.findById(room.getTypeId()).orElseThrow(() -> new IllegalArgumentException("房型不存在"));
        long nights = Math.max(1, ChronoUnit.DAYS.between(in, out));
        return t.getPrice().multiply(BigDecimal.valueOf(nights));
    }

    private String nextCode() {
        return "BK" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMddHHmmss"))
                + (int) (Math.random() * 90 + 10);
    }

    public List<Map<String, Object>> bills(LocalDate from, LocalDate to) {
        LocalDateTime f = from.atStartOfDay();
        LocalDateTime t = to.plusDays(1).atStartOfDay();
        return reservationRepo.findByStatusAndCheckedOutAtBetweenOrderByIdDesc("CHECKED_OUT", f, t)
                .stream().map(this::dto).toList();
    }
}
