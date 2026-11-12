package com.office.entity;

import jakarta.persistence.*;

import java.time.LocalDateTime;

/**
 * 公式实验室计算记录。
 */
@Entity
@Table(name = "calc_logs")
public class CalcLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 500)
    private String expr;

    @Column(length = 200)
    private String result;

    private boolean ok;

    private LocalDateTime createdAt = LocalDateTime.now();

    public CalcLog() {}

    public CalcLog(String expr, String result, boolean ok) {
        this.expr = expr;
        this.result = result;
        this.ok = ok;
    }

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getExpr() { return expr; }
    public void setExpr(String expr) { this.expr = expr; }

    public String getResult() { return result; }
    public void setResult(String result) { this.result = result; }

    public boolean isOk() { return ok; }
    public void setOk(boolean ok) { this.ok = ok; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
