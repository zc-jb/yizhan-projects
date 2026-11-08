package com.yizhan.hotel.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/** status: IDLE / OCCUPIED / CLEANING / MAINTENANCE */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "rooms")
public class Room {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 16)
    private String no;

    @Column(nullable = false)
    private Integer floor;

    @Column(nullable = false)
    private Long typeId;

    @Column(nullable = false, length = 16)
    private String status = "IDLE";
}
