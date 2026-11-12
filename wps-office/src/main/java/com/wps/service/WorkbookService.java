package com.wps.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.wps.entity.Workbook;
import com.wps.repo.WorkbookRepository;
import com.wps.security.ApiException;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
public class WorkbookService {

    /** 回收站保留天数，超期自动清除 */
    private static final int TRASH_DAYS = 3;

    private final WorkbookRepository repo;
    private final ObjectMapper om = new ObjectMapper();

    public WorkbookService(WorkbookRepository repo) {
        this.repo = repo;
    }

    public List<Map<String, Object>> list() {
        purgeExpired();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Workbook w : repo.findAllByDeletedAtIsNullOrderByUpdatedAtDesc()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", w.getId());
            m.put("name", w.getName());
            m.put("owner", w.getOwner());
            m.put("sheetCount", w.getSheetCount() == null ? 0 : w.getSheetCount());
            m.put("createdAt", w.getCreatedAt());
            m.put("updatedAt", w.getUpdatedAt());
            out.add(m);
        }
        return out;
    }

    /** 回收站列表：含删除时间与剩余可恢复时间 */
    public List<Map<String, Object>> trash() {
        purgeExpired();
        LocalDateTime now = LocalDateTime.now();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Workbook w : repo.findAllByDeletedAtIsNotNullOrderByDeletedAtDesc()) {
            LocalDateTime deletedAt = w.getDeletedAt();
            LocalDateTime expireAt = deletedAt.plusDays(TRASH_DAYS);
            double remainHours = Math.max(0, Duration.between(now, expireAt).toMinutes() / 60.0);
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", w.getId());
            m.put("name", w.getName());
            m.put("sheetCount", w.getSheetCount() == null ? 0 : w.getSheetCount());
            m.put("deletedAt", deletedAt);
            m.put("expireAt", expireAt);
            m.put("remainHours", Math.round(remainHours * 10) / 10.0);
            out.add(m);
        }
        return out;
    }

    public void restore(Long id) {
        Workbook w = find(id);
        w.setDeletedAt(null);
        w.setUpdatedAt(LocalDateTime.now());
        repo.save(w);
    }

    public void emptyTrash() {
        repo.deleteAll(repo.findAllByDeletedAtIsNotNullOrderByDeletedAtDesc());
    }

    /** 清除超过保留期的回收站记录 */
    public void purgeExpired() {
        List<Workbook> expired = repo.findAllByDeletedAtBefore(LocalDateTime.now().minusDays(TRASH_DAYS));
        if (!expired.isEmpty()) repo.deleteAll(expired);
    }

    public Map<String, Object> detail(Long id) {
        Workbook w = find(id);
        if (w.getDeletedAt() != null) throw new ApiException(404, "工作簿已在回收站中");
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", w.getId());
        m.put("name", w.getName());
        m.put("owner", w.getOwner());
        m.put("sheetCount", w.getSheetCount());
        m.put("createdAt", w.getCreatedAt());
        m.put("updatedAt", w.getUpdatedAt());
        JsonNode data = null;
        try {
            if (w.getDataJson() != null && !w.getDataJson().isBlank()) {
                data = om.readTree(w.getDataJson());
            }
        } catch (Exception ignored) {
            data = null;
        }
        m.put("data", data == null ? om.createObjectNode() : data);
        return m;
    }

    public Map<String, Object> create(Map<String, Object> body, String owner) {
        String name = str(body.get("name"));
        if (name.isBlank()) name = "未命名工作簿";
        Workbook w = new Workbook();
        w.setName(name);
        w.setOwner(owner == null ? "admin" : owner);
        w.setSheetCount(0);
        w.setDataJson(null);
        w.setCreatedAt(LocalDateTime.now());
        w.setUpdatedAt(LocalDateTime.now());
        Workbook saved = repo.save(w);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", saved.getId());
        m.put("name", saved.getName());
        return m;
    }

    public Map<String, Object> save(Long id, Map<String, Object> body) {
        Workbook w = find(id);
        if (body.containsKey("name")) {
            String n = str(body.get("name"));
            if (!n.isBlank()) w.setName(n);
        }
        if (body.containsKey("data")) {
            try {
                w.setDataJson(om.writeValueAsString(body.get("data")));
            } catch (Exception e) {
                throw new ApiException(400, "工作簿数据格式不正确");
            }
        }
        if (body.containsKey("sheetCount")) {
            w.setSheetCount((int) toLong(body.get("sheetCount")));
        } else if (body.containsKey("data")) {
            JsonNode n = om.valueToTree(body.get("data"));
            JsonNode sheets = n.path("sheets");
            w.setSheetCount(sheets.isArray() ? sheets.size() : 0);
        }
        w.setUpdatedAt(LocalDateTime.now());
        Workbook saved = repo.save(w);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("ok", true);
        m.put("id", saved.getId());
        m.put("updatedAt", saved.getUpdatedAt());
        m.put("sheetCount", saved.getSheetCount());
        return m;
    }

    /** 软删除：移入回收站，保留 3 天可恢复 */
    public void delete(Long id) {
        Workbook w = find(id);
        if (w.getDeletedAt() == null) w.setDeletedAt(LocalDateTime.now());
        repo.save(w);
    }

    private Workbook find(Long id) {
        return repo.findById(id).orElseThrow(() -> new ApiException(404, "工作簿不存在"));
    }

    private long toLong(Object o) {
        try {
            return Long.parseLong(String.valueOf(o).trim());
        } catch (Exception e) {
            return 0;
        }
    }

    private String str(Object o) {
        return o == null ? "" : String.valueOf(o).trim();
    }
}
