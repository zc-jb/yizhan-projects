package com.campus.repo;

import com.campus.entity.Score;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.util.List;
import java.util.Optional;

public interface ScoreRepository extends JpaRepository<Score, Long> {

    List<Score> findByStudentIdOrderByCreatedAtDesc(Long studentId);

    Optional<Score> findByStudentIdAndCourseId(Long studentId, Long courseId);

    void deleteByStudentId(Long studentId);

    void deleteByCourseId(Long courseId);

    @Query("select avg(s.score) from Score s")
    Double averageScore();
}
