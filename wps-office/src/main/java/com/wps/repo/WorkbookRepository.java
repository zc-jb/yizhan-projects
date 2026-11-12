package com.wps.repo;

import com.wps.entity.Workbook;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDateTime;
import java.util.List;

public interface WorkbookRepository extends JpaRepository<Workbook, Long> {

    List<Workbook> findAllByDeletedAtIsNullOrderByUpdatedAtDesc();

    List<Workbook> findAllByDeletedAtIsNotNullOrderByDeletedAtDesc();

    List<Workbook> findAllByDeletedAtBefore(LocalDateTime time);
}
