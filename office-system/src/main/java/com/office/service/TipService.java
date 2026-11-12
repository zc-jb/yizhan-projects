package com.office.service;

import com.office.entity.Tip;
import com.office.repo.TipRepository;
import com.office.security.ApiException;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;

@Service
public class TipService {

    private final TipRepository repo;

    public TipService(TipRepository repo) {
        this.repo = repo;
    }

    public List<Tip> list(String category, String q) {
        List<Tip> all = (category == null || category.isBlank() || "全部".equals(category))
                ? repo.findAllByOrderByViewsDesc()
                : repo.findByCategoryOrderByViewsDesc(category);
        if (q == null || q.isBlank()) return all;
        String key = q.toLowerCase(Locale.ROOT).trim();
        return all.stream().filter(t ->
                contains(t.getTitle(), key) || contains(t.getSummary(), key)
                        || contains(t.getContent(), key) || contains(t.getShortcut(), key)
        ).toList();
    }

    public Tip detail(Long id) {
        Tip t = repo.findById(id).orElseThrow(() -> new ApiException(404, "技巧不存在"));
        t.setViews((t.getViews() == null ? 0 : t.getViews()) + 1);
        return repo.save(t);
    }

    public List<String> categories() {
        return repo.findAll().stream()
                .map(Tip::getCategory)
                .filter(Objects -> Objects != null && !Objects.isBlank())
                .distinct()
                .toList();
    }

    public long count() {
        return repo.count();
    }

    private boolean contains(String src, String key) {
        return src != null && src.toLowerCase(Locale.ROOT).contains(key);
    }
}
