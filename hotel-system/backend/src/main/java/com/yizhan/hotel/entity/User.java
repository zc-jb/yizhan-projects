package com.yizhan.hotel.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "users")
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 32)
    private String username;

    @Column(nullable = false, length = 80)
    private String password;

    @Column(nullable = false, length = 32)
    private String name;

    @Column(nullable = false, length = 16)
    private String role;

    private LocalDateTime createdAt;

    @PrePersist
    void created() {
        if (createdAt == null) createdAt = LocalDateTime.now();
    }
}
