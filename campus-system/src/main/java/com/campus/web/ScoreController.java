package com.campus.web;

import com.campus.security.AuthInterceptor;
import com.campus.security.LoginUser;
import com.campus.service.ScoreService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 成绩管理接口
 */
@RestController
@RequestMapping("/api/scores")
public class ScoreController {

    private final ScoreService scoreService;

    public ScoreController(ScoreService scoreService) {
        this.scoreService = scoreService;
    }

    /** 查询某学生成绩；学生角色只能查询自己 */
    @GetMapping
    public List<ScoreService.ScoreView> list(
            @RequestParam Long studentId,
            @RequestAttribute(AuthInterceptor.CURRENT_USER) LoginUser user) {
        return scoreService.listByStudent(studentId, user);
    }

    /** 录入 / 更新成绩（仅管理员） */
    @PostMapping
    public ScoreService.ScoreView create(
            @RequestBody ScoreRequest request,
            @RequestAttribute(AuthInterceptor.CURRENT_USER) LoginUser user) {
        user.requireAdmin();
        return scoreService.createOrUpdate(request.studentId(), request.courseId(),
                request.score(), request.semester());
    }

    /** 成绩录入请求体 */
    public record ScoreRequest(Long studentId, Long courseId, Double score, String semester) {
    }
}
