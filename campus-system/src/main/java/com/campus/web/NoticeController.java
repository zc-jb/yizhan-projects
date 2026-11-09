package com.campus.web;

import com.campus.entity.Notice;
import com.campus.security.ApiException;
import com.campus.security.AuthInterceptor;
import com.campus.security.LoginUser;
import com.campus.service.NoticeService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 公告接口
 */
@RestController
@RequestMapping("/api/notices")
public class NoticeController {

    private final NoticeService noticeService;

    public NoticeController(NoticeService noticeService) {
        this.noticeService = noticeService;
    }

    /** 公告列表：重要公告在前，其余按时间倒序 */
    @GetMapping
    public List<Notice> list() {
        return noticeService.list();
    }

    /** 发布公告（仅管理员） */
    @PostMapping
    public Notice create(@RequestBody NoticeRequest request,
                         @RequestAttribute(AuthInterceptor.CURRENT_USER) LoginUser user) {
        if (!user.isAdmin()) {
            throw ApiException.forbidden("仅管理员可发布公告");
        }
        return noticeService.create(request.title(), request.content(),
                request.important(), user.name());
    }

    /** 公告发布请求体 */
    public record NoticeRequest(String title, String content, Boolean important) {
    }
}
