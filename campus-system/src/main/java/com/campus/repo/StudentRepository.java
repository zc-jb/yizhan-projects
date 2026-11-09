package com.campus.repo;

import com.campus.entity.Student;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface StudentRepository extends JpaRepository<Student, Long> {

    Optional<Student> findByStudentNo(String studentNo);

    boolean existsByStudentNo(String studentNo);

    boolean existsByStudentNoAndIdNot(String studentNo, Long id);

    /** 按学号 / 姓名 / 班级模糊搜索 */
    List<Student> findByNameContainingIgnoreCaseOrStudentNoContainingIgnoreCaseOrClassNameContainingIgnoreCaseOrderByStudentNoAsc(
            String name, String studentNo, String className);
}
