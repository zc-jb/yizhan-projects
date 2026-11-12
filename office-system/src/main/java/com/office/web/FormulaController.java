package com.office.web;

import com.office.entity.CalcLog;
import com.office.service.FormulaService;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/formula")
public class FormulaController {

    private final FormulaService service;

    public FormulaController(FormulaService service) {
        this.service = service;
    }

    @PostMapping("/eval")
    public Map<String, Object> eval(@RequestBody Map<String, Object> body) {
        String expr = body.get("expr") == null ? "" : String.valueOf(body.get("expr"));
        String value = service.evaluate(expr);
        Map<String, Object> res = new LinkedHashMap<>();
        res.put("expr", expr.trim());
        res.put("result", value);
        return res;
    }

    @GetMapping("/history")
    public List<CalcLog> history() {
        return service.history();
    }

    @GetMapping("/functions")
    public List<Map<String, String>> functions() {
        String[][] list = {
                {"SUM(a,b,...)", "求和", "SUM(12000,8600,4300)"},
                {"AVG(a,b,...)", "平均值", "AVG(88,92,79,95)"},
                {"MAX / MIN", "最大值 / 最小值", "MAX(12,45,38)"},
                {"ROUND(x,n)", "四舍五入到 n 位", "ROUND(1234.5678,2)"},
                {"PERCENT(a,b)", "a 占 b 的百分比", "PERCENT(11350,12000)"},
                {"IF(条件,真,假)", "条件判断", "IF(90>=60,1,0)"},
                {"ABS(x)", "绝对值", "ABS(-128)"},
                {"MOD(a,b)", "取余", "MOD(17,5)"},
                {"POWER(x,y)", "乘幂", "POWER(2,10)"},
                {"SQRT(x)", "平方根", "SQRT(144)"},
                {"CEIL / FLOOR", "向上 / 向下取整", "CEIL(3.2)"},
                {"COUNT(...)", "参数个数", "COUNT(1,2,3)"}
        };
        List<Map<String, String>> out = new ArrayList<>();
        for (String[] row : list) {
            Map<String, String> m = new LinkedHashMap<>();
            m.put("name", row[0]);
            m.put("desc", row[1]);
            m.put("demo", row[2]);
            out.add(m);
        }
        return out;
    }
}
