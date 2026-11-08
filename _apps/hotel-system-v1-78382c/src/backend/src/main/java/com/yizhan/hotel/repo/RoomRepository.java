package com.yizhan.hotel.repo;

import com.yizhan.hotel.entity.Room;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;

public interface RoomRepository extends JpaRepository<Room, Long> {
    List<Room> findByStatus(String status);
    List<Room> findByTypeIdAndStatus(Long typeId, String status);
    long countByStatus(String status);
    long countByTypeId(Long typeId);

    @Query("""
        select r from Room r
        where r.typeId = :typeId
          and r.status = 'IDLE'
          and r.id not in (
            select rv.roomId from Reservation rv
            where rv.status in ('BOOKED','CHECKED_IN')
              and rv.checkInDate < :outDate
              and rv.checkOutDate > :inDate
          )
        order by r.floor, r.no
        """)
    List<Room> findAvailable(@Param("typeId") Long typeId,
                             @Param("inDate") LocalDate inDate,
                             @Param("outDate") LocalDate outDate);
}
