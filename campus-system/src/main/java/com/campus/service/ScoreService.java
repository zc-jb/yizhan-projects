package com.campus.service;

import com.campus.entity.Course;
import com.campus.entity.Score;
import com.campus.entity.Student;
import com.campus.repo.CourseRepository;
import com.campus.repo.ScoreRepository;
import com.campus.repo.StudentRepository;
import com.campus.security.ApiException;
import com.campus.security.LoginUser;
import com.fasterxml.jackson.annotation.JsonFormat;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 成绩管理服务
 */
@Service
public class ScoreService {

    private final ScoreRepository scoreRepository;
    private final StudentRepository studentRepository;
    private final CourseRepository courseRepository;

    public ScoreService(ScoreRepository scoreRepository,
                        StudentRepository studentRepository,
                        CourseRepository courseRepository) {
        this.scoreRepository = scoreRepository;
        this.studentRepository = studentRepository;
        this.courseRepository = courseRepository;
    }

    /** 按学生查看成绩；学生只能查看自己的 */
    public List<ScoreView> listByStudent(Long studentId, LoginUser user) {
        if (studentId == null) {
            throw ApiException.badRequest("请选择学生");
        }
        if (!user.isAdmin() && !studentId.equals(user.id())) {
            throw ApiException.forbidden("只能查看自己的成绩");
        }
        Student student = studentRepository.findById(studentId)
                .orElseThrow(() -> ApiException.notFound("学生不存在"));

        List<Score> scores = scoreRepository.findByStudentIdOrderByCreatedAtDesc(studentId);
        Map<Long, Course> courseMap = new HashMap<>();
        for (Course course : courseRepository.findAllById(
                scores.stream().map(Score::getCourseId).toList())) {
            courseMap.put(course.getId(), course);
        }

        List<ScoreView> result = new ArrayList<>();
        for (Score score : scores) {
            Course course = courseMap.get(score.getCourseId());
            result.add(new ScoreView(
                    score.getId(),
                    student.getId(),
                    student.getStudentNo(),
                    student.getName(),
                    score.getCourseId(),
                    course == null ? "已删除课程" : course.getName(),
                    course == null ? 0D : course.getCredit(),
                    score.getScore(),
                    score.getSemester(),
                    score.getCreatedAt()
            ));
        }
        return result;
    }

    /** 录入成绩：同一学生同一课程重复录入时更新原记录 */
    @Transactional
    public ScoreView createOrUpdate(Long studentId, Long courseId, Double value, String semester) {
        if (studentId == null || courseId == null) {
            throw ApiException.badRequest("请选择学生和课程");
        }
        if (value == null || value < 0 || value > 100) {
            throw ApiException.badRequest("成绩必须在 0 到 100 之间");
        }
        Student student = studentRepository.findById(studentId)
                .orElseThrow(() -> ApiException.notFound("学生不存在"));
        Course course = courseRepository.findById(courseId)
                .orElseThrow(() -> ApiException.notFound("课程不存在"));

        Score score = scoreRepository.findByStudentIdAndCourseId(studentId, courseId).orElseGet(Score::new);
        score.setStudentId(studentId);
        score.setCourseId(courseId);
        score.setScore(value);
        if (semester != null && !semester.isBlank()) {
            score.setSemester(semester.trim());
        }
        Score saved = scoreRepository.save(score);

        return new ScoreView(saved.getId(), student.getId(), student.getStudentNo(), student.getName(),
                course.getId(), course.getName(), course.getCredit(), saved.getScore(),
                saved.getSemester(), saved.getCreatedAt());
    }

    /** 成绩视图对象：附带学生与课程信息，方便前端直接展示 */
    public record ScoreView(
            Long id,
            Long studentId,
            String studentNo,
            String studentName,
            Long courseId,
            String courseName,
            Double credit,
            Double score,
            String semester,
            @JsonFormat(pattern = "yyyy-MM-dd HH:mm") LocalDateTime createdAt
    ) {
    }
}
