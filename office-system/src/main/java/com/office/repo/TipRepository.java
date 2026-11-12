package com.office.repo;

import com.office.entity.Tip;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TipRepository extends JpaRepository<Tip, Long> {
    List<Tip> findAllByOrderByViewsDesc();
    List<Tip> findByCategoryOrderByViewsDesc(String category);
}
