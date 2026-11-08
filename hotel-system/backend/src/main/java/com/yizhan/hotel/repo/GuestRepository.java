package com.yizhan.hotel.repo;

import com.yizhan.hotel.entity.Guest;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface GuestRepository extends JpaRepository<Guest, Long> {
    List<Guest> findByNameContainingOrPhoneContainingOrderByIdDesc(String name, String phone);
}
