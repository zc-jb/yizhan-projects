package com.campus.web;

import com.campus.entity.Course;
import com.campus.entity.Teacher;
import com.campus.repo.TeacherRepository;
import com.campus.security.AuthInterceptor;
import com.campus.security.LoginUser;
import com.campus.service.CourseService;
import org.springframework.data.domain.Sort;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 课程管理接口
 */
@RestController
@RequestMapping("/api")
public class CourseController {

    private final CourseService courseService;
    private final TeacherRepository teacherRepository;

    public CourseController(CourseService courseService, TeacherRepository teacherRepository) {
        this.courseService = courseService;
        this.teacherRepository = teacherRepository;
    }

    /** 课程列表 */
    @GetMapping("/courses")
    public List<Course> list() {
        return courseService.list();
    }

    /** 新增课程（仅管理员） */
    @PostMapping("/courses")
    public Course create(@RequestBody Course course,
                         @RequestAttribute(AuthInterceptor.CURRENT_USER) LoginUser user) {
        user.requireAdmin();
        return courseService.create(course);
    }

    /** 删除课程（仅管理员） */
    @DeleteMapping("/courses/{id}")
    public Map<String, Object> delete(@PathVariable Long id,
                                      @RequestAttribute(AuthInterceptor.CURRENT_USER) LoginUser user) {
        user.requireAdmin();
        courseService.delete(id);
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("success", true);
        return result;
    }

    /** 教师列表（课程表单下拉使用） */
    @GetMapping("/teachers")
    public List<Teacher> teachers() {
        return teacherRepository.findAll(Sort.by(Sort.Direction.ASC, "id"));
    }
}
