package com.campus.web;

import com.campus.entity.Student;
import com.campus.security.AuthInterceptor;
import com.campus.security.LoginUser;
import com.campus.service.StudentService;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 学生管理接口
 */
@RestController
@RequestMapping("/api/students")
public class StudentController {

    private final StudentService studentService;

    public StudentController(StudentService studentService) {
        this.studentService = studentService;
    }

    /** 学生列表，支持按学号/姓名/班级搜索 */
    @GetMapping
    public List<Student> list(@RequestParam(required = false) String keyword) {
        return studentService.list(keyword);
    }

    @GetMapping("/{id}")
    public Student detail(@PathVariable Long id) {
        return studentService.get(id);
    }

    /** 新增学生（仅管理员） */
    @PostMapping
    public Student create(@RequestBody Student student,
                          @RequestAttribute(AuthInterceptor.CURRENT_USER) LoginUser user) {
        user.requireAdmin();
        return studentService.create(student);
    }

    /** 编辑学生（仅管理员） */
    @PutMapping("/{id}")
    public Student update(@PathVariable Long id,
                          @RequestBody Student student,
                          @RequestAttribute(AuthInterceptor.CURRENT_USER) LoginUser user) {
        user.requireAdmin();
        return studentService.update(id, student);
    }

    /** 删除学生（仅管理员） */
    @DeleteMapping("/{id}")
    public Map<String, Object> delete(@PathVariable Long id,
                                      @RequestAttribute(AuthInterceptor.CURRENT_USER) LoginUser user) {
        user.requireAdmin();
        studentService.delete(id);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        return result;
    }
}
