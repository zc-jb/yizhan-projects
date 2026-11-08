package com.yizhan.hotel.repo;

import com.yizhan.hotel.entity.Reservation;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

public interface ReservationRepository extends JpaRepository<Reservation, Long> {
    List<Reservation> findAllByOrderByIdDesc();
    List<Reservation> findByStatusOrderByIdDesc(String status);
    List<Reservation> findByCheckInDateAndStatus(LocalDate date, String status);
    List<Reservation> findByCheckOutDateAndStatus(LocalDate date, String status);
    long countByStatus(String status);
    long countByGuestId(Long guestId);
    boolean existsByRoomIdAndStatusIn(Long roomId, List<String> statuses);
    long countByRoomIdAndStatusIn(Long roomId, List<String> statuses);

    List<Reservation> findByStatusAndCheckedOutAtBetweenOrderByIdDesc(String status, LocalDateTime from, LocalDateTime to);

    @Query("""
        select count(rv) > 0 from Reservation rv
        where rv.roomId = :roomId
          and rv.status in ('BOOKED','CHECKED_IN')
          and rv.checkInDate < :outDate
          and rv.checkOutDate > :inDate
        """)
    boolean hasOverlap(@Param("roomId") Long roomId,
                       @Param("inDate") LocalDate inDate,
                       @Param("outDate") LocalDate outDate);

    @Query("""
        select coalesce(sum(r.totalAmount), 0) from Reservation r
        where r.status = 'CHECKED_OUT' and r.checkedOutAt >= :from and r.checkedOutAt < :to
        """)
    BigDecimal sumRevenue(@Param("from") LocalDateTime from, @Param("to") LocalDateTime to);
}
