package com.campus.service;

import com.campus.entity.Notice;
import com.campus.repo.NoticeRepository;
import com.campus.security.ApiException;
import org.springframework.stereotype.Service;

import java.util.List;

/**
 * 公告服务
 */
@Service
public class NoticeService {

    private final NoticeRepository noticeRepository;

    public NoticeService(NoticeRepository noticeRepository) {
        this.noticeRepository = noticeRepository;
    }

    public List<Notice> list() {
        return noticeRepository.findAllByOrderByImportantDescCreatedAtDesc();
    }

    public List<Notice> top3() {
        return noticeRepository.findTop3ByOrderByCreatedAtDesc();
    }

    public Notice create(String title, String content, Boolean important, String publisher) {
        String safeTitle = title == null ? "" : title.trim();
        String safeContent = content == null ? "" : content.trim();
        if (safeTitle.isBlank()) {
            throw ApiException.badRequest("公告标题不能为空");
        }
        if (safeContent.isBlank()) {
            throw ApiException.badRequest("公告内容不能为空");
        }
        if (safeTitle.length() > 120) {
            throw ApiException.badRequest("公告标题不能超过 120 个字符");
        }
        if (safeContent.length() > 1000) {
            throw ApiException.badRequest("公告内容不能超过 1000 个字符");
        }

        Notice notice = new Notice();
        notice.setTitle(safeTitle);
        notice.setContent(safeContent);
        notice.setImportant(Boolean.TRUE.equals(important));
        notice.setPublisher(publisher);
        return noticeRepository.save(notice);
    }
}
