package com.office.service;

import com.office.entity.Report;
import com.office.entity.Tip;
import com.office.repo.CalcLogRepository;
import com.office.repo.ReportRepository;
import com.office.repo.TipRepository;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.*;

@Service
public class StatsService {

    private final ReportRepository reports;
    private final TipRepository tips;
    private final CalcLogRepository calcs;

    public StatsService(ReportRepository reports, TipRepository tips, CalcLogRepository calcs) {
        this.reports = reports;
        this.tips = tips;
        this.calcs = calcs;
    }

    public Map<String, Object> dashboard() {
        List<Report> all = reports.findAllByOrderByPeriodDesc();

        BigDecimal budget = BigDecimal.ZERO;
        BigDecimal actual = BigDecimal.ZERO;
        BigDecimal rateSum = BigDecimal.ZERO;
        int rateCount = 0;
        Map<String, BigDecimal> byPeriod = new TreeMap<>();

        for (Report r : all) {
            budget = budget.add(nz(r.getBudget()));
            actual = actual.add(nz(r.getTotal()));
            if (nz(r.getRate()).compareTo(BigDecimal.ZERO) > 0) {
                rateSum = rateSum.add(nz(r.getRate()));
                rateCount++;
            }
            String p = r.getPeriod() == null ? "" : r.getPeriod();
            if (!p.isBlank()) {
                byPeriod.merge(p, nz(r.getTotal()), BigDecimal::add);
            }
        }

        List<String> periods = new ArrayList<>(byPeriod.keySet());
        Collections.sort(periods);
        if (periods.size() > 6) periods = periods.subList(periods.size() - 6, periods.size());

        List<Map<String, Object>> trend = new ArrayList<>();
        for (String p : periods) {
            Map<String, Object> item = new LinkedHashMap<>();
            item.put("period", p);
            item.put("value", byPeriod.get(p));
            trend.add(item);
        }

        Map<String, Integer> status = new LinkedHashMap<>();
        for (Report r : all) {
            status.merge(r.getStatus() == null ? "草稿" : r.getStatus(), 1, Integer::sum);
        }

        List<Map<String, Object>> recent = new ArrayList<>();
        for (Report r : all.stream().limit(5).toList()) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", r.getId());
            m.put("title", r.getTitle());
            m.put("period", r.getPeriod());
            m.put("dept", r.getDept());
            m.put("status", r.getStatus());
            m.put("total", r.getTotal());
            m.put("rate", r.getRate());
            m.put("updatedAt", r.getUpdatedAt());
            recent.add(m);
        }

        Map<String, Object> topTip = new LinkedHashMap<>();
        List<Tip> hot = tips.findAllByOrderByViewsDesc();
        if (!hot.isEmpty()) {
            Tip t = hot.get(0);
            topTip.put("id", t.getId());
            topTip.put("title", t.getTitle());
            topTip.put("category", t.getCategory());
            topTip.put("views", t.getViews());
        }

        Map<String, Object> res = new LinkedHashMap<>();
        res.put("reportCount", all.size());
        res.put("budget", budget);
        res.put("actual", actual);
        res.put("avgRate", rateCount == 0 ? BigDecimal.ZERO
                : rateSum.divide(BigDecimal.valueOf(rateCount), 2, RoundingMode.HALF_UP));
        res.put("tipCount", tips.count());
        res.put("calcCount", calcs.count());
        res.put("trend", trend);
        res.put("status", status);
        res.put("recent", recent);
        res.put("topTip", topTip);
        return res;
    }

    private BigDecimal nz(BigDecimal v) {
        return v == null ? BigDecimal.ZERO : v;
    }
}
