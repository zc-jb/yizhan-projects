package com.office.service;

import com.office.entity.CalcLog;
import com.office.repo.CalcLogRepository;
import com.office.security.ApiException;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;

/**
 * 安全的自研公式解析器：不使用脚本引擎，只支持四则运算、比较与常用办公函数。
 */
@Service
public class FormulaService {

    private final CalcLogRepository logs;

    public FormulaService(CalcLogRepository logs) {
        this.logs = logs;
    }

    public String evaluate(String expr) {
        if (expr == null || expr.isBlank()) {
            throw new ApiException(400, "请输入要计算的公式");
        }
        if (expr.length() > 500) {
            throw new ApiException(400, "公式过长（最多 500 字符）");
        }
        try {
            double v = new Parser(expr).parse();
            if (Double.isNaN(v) || Double.isInfinite(v)) {
                throw new ApiException(400, "计算结果不是有效数字（可能除以 0）");
            }
            String out = format(v);
            logs.save(new CalcLog(expr.trim(), out, true));
            return out;
        } catch (ApiException e) {
            logs.save(new CalcLog(expr.trim(), e.getMessage(), false));
            throw e;
        }
    }

    public List<CalcLog> history() {
        return logs.findTop20ByOrderByCreatedAtDesc();
    }

    public static String format(double v) {
        if (Math.abs(v - Math.rint(v)) < 1e-9 && Math.abs(v) < 1e15) {
            return String.valueOf((long) Math.rint(v));
        }
        String s = String.format("%.4f", v);
        s = s.replaceAll("0+$", "").replaceAll("\\.$", "");
        return s;
    }

    /* ---------------- 递归下降解析 ---------------- */

    private static class Parser {
        private final String s;
        private int i;

        Parser(String s) {
            this.s = s;
        }

        double parse() {
            double v = or();
            skip();
            if (i < s.length()) {
                throw new ApiException(400, "第 " + (i + 1) + " 个字符 '" + s.charAt(i) + "' 无法识别");
            }
            return v;
        }

        private void skip() {
            while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
        }

        private boolean eat(char c) {
            skip();
            if (i < s.length() && s.charAt(i) == c) {
                i++;
                return true;
            }
            return false;
        }

        private boolean eatOp(String op) {
            skip();
            if (s.startsWith(op, i)) {
                i += op.length();
                return true;
            }
            return false;
        }

        private void expect(char c) {
            if (!eat(c)) {
                throw new ApiException(400, "缺少 '" + c + "'，请检查公式");
            }
        }

        private double or() {
            double v = and();
            while (true) {
                skip();
                if (eatOp("||") || wordIs("OR")) {
                    double r = and();
                    v = (v != 0 || r != 0) ? 1 : 0;
                } else {
                    return v;
                }
            }
        }

        private double and() {
            double v = compare();
            while (true) {
                skip();
                if (eatOp("&&") || wordIs("AND")) {
                    double r = compare();
                    v = (v != 0 && r != 0) ? 1 : 0;
                } else {
                    return v;
                }
            }
        }

        private double compare() {
            double v = add();
            skip();
            if (i >= s.length()) return v;
            String op = null;
            for (String cand : new String[]{">=", "<=", "<>", "!=", "=", ">", "<"}) {
                if (s.startsWith(cand, i)) {
                    op = cand;
                    i += cand.length();
                    break;
                }
            }
            if (op == null) return v;
            double r = add();
            return switch (op) {
                case ">=" -> v >= r ? 1 : 0;
                case "<=" -> v <= r ? 1 : 0;
                case ">" -> v > r ? 1 : 0;
                case "<" -> v < r ? 1 : 0;
                case "<>", "!=" -> Math.abs(v - r) > 1e-12 ? 1 : 0;
                default -> Math.abs(v - r) <= 1e-12 ? 1 : 0;
            };
        }

        private double add() {
            double v = mul();
            while (true) {
                skip();
                if (eatOp("+")) {
                    v += mul();
                } else if (i < s.length() && s.charAt(i) == '-') {
                    i++;
                    v -= mul();
                } else {
                    return v;
                }
            }
        }

        private double mul() {
            double v = unary();
            while (true) {
                skip();
                if (i < s.length() && s.charAt(i) == '*') {
                    i++;
                    v *= unary();
                } else if (i < s.length() && s.charAt(i) == '/') {
                    i++;
                    double d = unary();
                    if (Math.abs(d) < 1e-12) throw new ApiException(400, "除数不能为 0");
                    v /= d;
                } else {
                    return v;
                }
            }
        }

        private double unary() {
            skip();
            if (i < s.length() && s.charAt(i) == '-') {
                i++;
                return -unary();
            }
            if (i < s.length() && s.charAt(i) == '+') {
                i++;
                return unary();
            }
            return power();
        }

        private double power() {
            double base = primary();
            skip();
            if (i < s.length() && s.charAt(i) == '^') {
                i++;
                double exp = unary();
                return Math.pow(base, exp);
            }
            return base;
        }

        private double primary() {
            skip();
            if (i >= s.length()) throw new ApiException(400, "公式不完整");
            char c = s.charAt(i);
            if (c == '(') {
                i++;
                double v = or();
                expect(')');
                return v;
            }
            if (Character.isDigit(c) || c == '.') {
                return number();
            }
            if (Character.isLetter(c) || c == '_') {
                return identifier();
            }
            throw new ApiException(400, "第 " + (i + 1) + " 个字符 '" + c + "' 无法识别");
        }

        private double number() {
            int start = i;
            while (i < s.length() && (Character.isDigit(s.charAt(i)) || s.charAt(i) == '.')) i++;
            String num = s.substring(start, i);
            double v;
            try {
                v = Double.parseDouble(num);
            } catch (NumberFormatException e) {
                throw new ApiException(400, "数字格式不正确：" + num);
            }
            skip();
            if (i < s.length() && s.charAt(i) == '%') {
                i++;
                v = v / 100.0;
            }
            return v;
        }

        private boolean wordIs(String word) {
            skip();
            if (s.regionMatches(true, i, word, 0, word.length())) {
                int end = i + word.length();
                if (end >= s.length() || !Character.isLetterOrDigit(s.charAt(end))) {
                    i = end;
                    return true;
                }
            }
            return false;
        }

        private double identifier() {
            skip();
            int start = i;
            while (i < s.length() && (Character.isLetterOrDigit(s.charAt(i)) || s.charAt(i) == '_')) i++;
            String name = s.substring(start, i).toUpperCase();
            skip();
            if (i >= s.length() || s.charAt(i) != '(') {
                throw new ApiException(400, "未知的名称：" + name + "（函数需要写成 " + name + "(...)）");
            }
            i++; // (
            List<Double> args = new ArrayList<>();
            skip();
            if (i < s.length() && s.charAt(i) == ')') {
                i++;
            } else {
                args.add(or());
                while (eat(',')) {
                    args.add(or());
                }
                expect(')');
            }
            return call(name, args);
        }

        private double call(String name, List<Double> a) {
            return switch (name) {
                case "SUM" -> {
                    require(a, 1, name);
                    double t = 0;
                    for (double v : a) t += v;
                    yield t;
                }
                case "AVG", "AVERAGE" -> {
                    require(a, 1, name);
                    double t = 0;
                    for (double v : a) t += v;
                    yield t / a.size();
                }
                case "MAX" -> {
                    require(a, 1, name);
                    double t = Double.NEGATIVE_INFINITY;
                    for (double v : a) t = Math.max(t, v);
                    yield t;
                }
                case "MIN" -> {
                    require(a, 1, name);
                    double t = Double.POSITIVE_INFINITY;
                    for (double v : a) t = Math.min(t, v);
                    yield t;
                }
                case "COUNT" -> (double) a.size();
                case "ROUND" -> {
                    require(a, 1, name);
                    int scale = a.size() > 1 ? (int) Math.round(a.get(1)) : 0;
                    yield new java.math.BigDecimal(String.valueOf(a.get(0)))
                            .setScale(Math.max(0, Math.min(8, scale)), java.math.RoundingMode.HALF_UP)
                            .doubleValue();
                }
                case "ABS" -> {
                    require(a, 1, name);
                    yield Math.abs(a.get(0));
                }
                case "INT" -> {
                    require(a, 1, name);
                    yield Math.floor(a.get(0));
                }
                case "CEIL", "CEILING" -> {
                    require(a, 1, name);
                    yield Math.ceil(a.get(0));
                }
                case "FLOOR" -> {
                    require(a, 1, name);
                    yield Math.floor(a.get(0));
                }
                case "SQRT" -> {
                    require(a, 1, name);
                    yield Math.sqrt(a.get(0));
                }
                case "POWER" -> {
                    require(a, 2, name);
                    yield Math.pow(a.get(0), a.get(1));
                }
                case "MOD" -> {
                    require(a, 2, name);
                    if (Math.abs(a.get(1)) < 1e-12) throw new ApiException(400, "MOD 的除数不能为 0");
                    yield a.get(0) % a.get(1);
                }
                case "IF" -> {
                    require(a, 3, name);
                    yield a.get(0) != 0 ? a.get(1) : a.get(2);
                }
                case "AND" -> {
                    require(a, 1, name);
                    boolean ok = true;
                    for (double v : a) ok = ok && v != 0;
                    yield ok ? 1 : 0;
                }
                case "OR" -> {
                    require(a, 1, name);
                    boolean ok = false;
                    for (double v : a) ok = ok || v != 0;
                    yield ok ? 1 : 0;
                }
                case "NOT" -> {
                    require(a, 1, name);
                    yield a.get(0) == 0 ? 1 : 0;
                }
                case "PERCENT" -> {
                    require(a, 2, name);
                    if (Math.abs(a.get(1)) < 1e-12) throw new ApiException(400, "PERCENT 的分母不能为 0");
                    yield a.get(0) / a.get(1) * 100.0;
                }
                default -> throw new ApiException(400, "不支持的函数：" + name);
            };
        }

        private void require(List<Double> a, int n, String name) {
            if (a.size() < n) {
                throw new ApiException(400, "函数 " + name + " 至少需要 " + n + " 个参数");
            }
        }
    }
}
