package com.office.repo;

import com.office.entity.CalcLog;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CalcLogRepository extends JpaRepository<CalcLog, Long> {
    List<CalcLog> findTop20ByOrderByCreatedAtDesc();
}
