package com.campus.service;

import com.campus.entity.Course;
import com.campus.repo.CourseRepository;
import com.campus.repo.ScoreRepository;
import com.campus.security.ApiException;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 课程管理服务
 */
@Service
public class CourseService {

    private final CourseRepository courseRepository;
    private final ScoreRepository scoreRepository;

    public CourseService(CourseRepository courseRepository, ScoreRepository scoreRepository) {
        this.courseRepository = courseRepository;
        this.scoreRepository = scoreRepository;
    }

    public List<Course> list() {
        return courseRepository.findAll(Sort.by(Sort.Direction.ASC, "id"));
    }

    @Transactional
    public Course create(Course input) {
        if (input == null) {
            throw ApiException.badRequest("请求内容不能为空");
        }
        String name = input.getName() == null ? "" : input.getName().trim();
        String teacher = input.getTeacher() == null ? "" : input.getTeacher().trim();
        if (name.isBlank()) {
            throw ApiException.badRequest("课程名称不能为空");
        }
        if (teacher.isBlank()) {
            throw ApiException.badRequest("授课教师不能为空");
        }
        if (input.getCredit() == null || input.getCredit() <= 0) {
            throw ApiException.badRequest("学分必须大于 0");
        }
        String courseNo = input.getCourseNo() == null ? "" : input.getCourseNo().trim();
        if (courseNo.isBlank()) {
            courseNo = "C" + (System.currentTimeMillis() % 100000);
        }
        if (courseRepository.existsByCourseNo(courseNo)) {
            throw ApiException.badRequest("课程编号已存在");
        }
        input.setId(null);
        input.setCourseNo(courseNo);
        input.setName(name);
        input.setTeacher(teacher);
        input.setSchedule(input.getSchedule() == null ? "" : input.getSchedule().trim());
        input.setLocation(input.getLocation() == null ? "" : input.getLocation().trim());
        return courseRepository.save(input);
    }

    /** 删除课程并清理关联成绩 */
    @Transactional
    public void delete(Long id) {
        Course course = courseRepository.findById(id)
                .orElseThrow(() -> ApiException.notFound("课程不存在"));
        scoreRepository.deleteByCourseId(id);
        courseRepository.delete(course);
    }
}
