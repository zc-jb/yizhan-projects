package com.campus.repo;

import com.campus.entity.Notice;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;

public interface NoticeRepository extends JpaRepository<Notice, Long> {

    List<Notice> findAllByOrderByImportantDescCreatedAtDesc();

    List<Notice> findTop3ByOrderByCreatedAtDesc();

    long countByCreatedAtAfter(LocalDateTime time);
}
