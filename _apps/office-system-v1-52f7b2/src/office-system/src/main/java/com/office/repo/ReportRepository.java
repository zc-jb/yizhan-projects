package com.office.repo;

import com.office.entity.Report;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ReportRepository extends JpaRepository<Report, Long> {
    List<Report> findAllByOrderByUpdatedAtDesc();
    List<Report> findAllByOrderByPeriodDesc();
}
