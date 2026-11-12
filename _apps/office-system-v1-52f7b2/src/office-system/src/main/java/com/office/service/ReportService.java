package com.office.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.office.entity.Report;
import com.office.repo.ReportRepository;
import com.office.security.ApiException;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.*;

@Service
public class ReportService {

    private final ReportRepository repo;
    private final ObjectMapper om = new ObjectMapper();

    public ReportService(ReportRepository repo) {
        this.repo = repo;
    }

    public List<Report> list() {
        return repo.findAllByOrderByUpdatedAtDesc();
    }

    public Report get(Long id) {
        return repo.findById(id).orElseThrow(() -> new ApiException(404, "报表不存在"));
    }

    public Report create(Map<String, Object> body, String owner) {
        Report r = new Report();
        String period = str(body.get("period"));
        if (period.isBlank()) period = java.time.YearMonth.now().toString();
        String dept = str(body.get("dept"));
        if (dept.isBlank()) dept = "综合行政部";
        String title = str(body.get("title"));
        if (title.isBlank()) title = period + " 办公费用月报";
        r.setTitle(title);
        r.setPeriod(period);
        r.setDept(dept);
        r.setStatus(str(body.get("status")).isBlank() ? "草稿" : str(body.get("status")));
        r.setOwner(owner == null ? "admin" : owner);
        Object data = body.get("data");
        r.setDataJson(data == null ? defaultData() : om.valueToTree(data).toString());
        r.setCreatedAt(LocalDateTime.now());
        r.setUpdatedAt(LocalDateTime.now());
        recompute(r);
        return repo.save(r);
    }

    public Report update(Long id, Map<String, Object> body) {
        Report r = get(id);
        if (body.containsKey("title")) r.setTitle(str(body.get("title")));
        if (body.containsKey("period")) r.setPeriod(str(body.get("period")));
        if (body.containsKey("dept")) r.setDept(str(body.get("dept")));
        if (body.containsKey("status")) r.setStatus(str(body.get("status")));
        if (body.containsKey("data")) r.setDataJson(om.valueToTree(body.get("data")).toString());
        r.setUpdatedAt(LocalDateTime.now());
        recompute(r);
        return repo.save(r);
    }

    public void delete(Long id) {
        if (!repo.existsById(id)) throw new ApiException(404, "报表不存在");
        repo.deleteById(id);
    }

    /** 由明细行重新汇总预算、实际与执行率 */
    private void recompute(Report r) {
        BigDecimal budget = BigDecimal.ZERO;
        BigDecimal actual = BigDecimal.ZERO;
        try {
            JsonNode root = om.readTree(r.getDataJson() == null ? defaultData() : r.getDataJson());
            JsonNode rows = root.path("rows");
            if (rows.isArray()) {
                for (JsonNode row : rows) {
                    budget = budget.add(dec(row.path("budget")));
                    actual = actual.add(dec(row.path("actual")));
                }
            }
        } catch (Exception ignored) {
            // 数据异常时保持 0，不影响保存
        }
        r.setBudget(budget);
        r.setTotal(actual);
        r.setRate(budget.compareTo(BigDecimal.ZERO) > 0
                ? actual.multiply(BigDecimal.valueOf(100)).divide(budget, 2, RoundingMode.HALF_UP)
                : BigDecimal.ZERO);
    }

    private BigDecimal dec(JsonNode n) {
        if (n == null || n.isMissingNode() || n.isNull()) return BigDecimal.ZERO;
        if (n.isNumber()) return n.decimalValue();
        try {
            String t = n.asText().replace(",", "").trim();
            return t.isEmpty() ? BigDecimal.ZERO : new BigDecimal(t);
        } catch (Exception e) {
            return BigDecimal.ZERO;
        }
    }

    private String str(Object o) {
        return o == null ? "" : String.valueOf(o).trim();
    }

    /** 默认 8 个办公费用科目 */
    public static String defaultData() {
        List<Map<String, Object>> rows = new ArrayList<>();
        String[] names = {"办公耗材", "打印复印", "快递物流", "差旅交通", "会议接待", "软件订阅", "水电物业", "其他杂项"};
        for (String n : names) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("name", n);
            row.put("budget", 0);
            row.put("actual", 0);
            row.put("note", "");
            rows.add(row);
        }
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("rows", rows);
        try {
            return new ObjectMapper().writeValueAsString(root);
        } catch (Exception e) {
            return "{\"rows\":[]}";
        }
    }
}
