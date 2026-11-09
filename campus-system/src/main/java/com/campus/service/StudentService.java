package com.campus.service;

import com.campus.entity.Student;
import com.campus.repo.ScoreRepository;
import com.campus.repo.StudentRepository;
import com.campus.security.ApiException;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 学生管理服务
 */
@Service
public class StudentService {

    private final StudentRepository studentRepository;
    private final ScoreRepository scoreRepository;

    public StudentService(StudentRepository studentRepository, ScoreRepository scoreRepository) {
        this.studentRepository = studentRepository;
        this.scoreRepository = scoreRepository;
    }

    public List<Student> list(String keyword) {
        if (keyword == null || keyword.isBlank()) {
            return studentRepository.findAll(Sort.by(Sort.Direction.ASC, "studentNo"));
        }
        String key = keyword.trim();
        return studentRepository
                .findByNameContainingIgnoreCaseOrStudentNoContainingIgnoreCaseOrClassNameContainingIgnoreCaseOrderByStudentNoAsc(
                        key, key, key);
    }

    public Student get(Long id) {
        return studentRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("学生不存在"));
    }

    @Transactional
    public Student create(Student input) {
        normalize(input);
        if (studentRepository.existsByStudentNo(input.getStudentNo())) {
            throw ApiException.badRequest("学号已存在");
        }
        input.setId(null);
        // 默认密码 123456
        input.setPassword(AuthService.sha256(
                input.getPassword() == null || input.getPassword().isBlank() ? "123456" : input.getPassword()));
        return studentRepository.save(input);
    }

    @Transactional
    public Student update(Long id, Student input) {
        Student student = get(id);
        normalize(input);
        if (studentRepository.existsByStudentNoAndIdNot(input.getStudentNo(), id)) {
            throw ApiException.badRequest("学号已存在");
        }
        student.setStudentNo(input.getStudentNo());
        student.setName(input.getName());
        student.setGender(input.getGender());
        student.setClassName(input.getClassName());
        student.setMajor(input.getMajor());
        student.setPhone(input.getPhone());
        student.setEmail(input.getEmail());
        student.setEnrollYear(input.getEnrollYear());
        return studentRepository.save(student);
    }

    /** 删除学生并同步清理其成绩 */
    @Transactional
    public void delete(Long id) {
        Student student = get(id);
        scoreRepository.deleteByStudentId(id);
        studentRepository.delete(student);
    }

    private void normalize(Student input) {
        if (input == null) {
            throw ApiException.badRequest("请求内容不能为空");
        }
        input.setStudentNo(trim(input.getStudentNo()));
        input.setName(trim(input.getName()));
        input.setGender(trim(input.getGender()));
        input.setClassName(trim(input.getClassName()));
        input.setMajor(trim(input.getMajor()));
        input.setPhone(trim(input.getPhone()));
        input.setEmail(trim(input.getEmail()));
        if (input.getStudentNo().isBlank()) {
            throw ApiException.badRequest("学号不能为空");
        }
        if (input.getName().isBlank()) {
            throw ApiException.badRequest("学生姓名不能为空");
        }
        if (input.getEnrollYear() == null) {
            input.setEnrollYear(2023);
        }
    }

    private String trim(String value) {
        return value == null ? "" : value.trim();
    }
}
