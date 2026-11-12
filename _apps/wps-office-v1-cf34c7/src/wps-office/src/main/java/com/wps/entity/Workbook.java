package com.wps.entity;

import jakarta.persistence.*;

import java.time.LocalDateTime;

/**
 * 工作簿：一个工作簿内含多个工作表，整体以 JSON 形式持久化到 MySQL。
 */
@Entity
@Table(name = "workbooks")
public class Workbook {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String name;

    private String owner;

    /** 工作表数量（冗余字段，便于列表展示） */
    private Integer sheetCount = 0;

    /** 工作簿内容：{ sheets: [ { id, name, rows, cols, data, fmts } ] } */
    @Lob
    @Column(columnDefinition = "LONGTEXT")
    private String dataJson;

    private LocalDateTime createdAt = LocalDateTime.now();

    private LocalDateTime updatedAt = LocalDateTime.now();

    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }

    public String getName() { return name; }
    public void setName(String name) { this.name = name; }

    public String getOwner() { return owner; }
    public void setOwner(String owner) { this.owner = owner; }

    public Integer getSheetCount() { return sheetCount; }
    public void setSheetCount(Integer sheetCount) { this.sheetCount = sheetCount; }

    public String getDataJson() { return dataJson; }
    public void setDataJson(String dataJson) { this.dataJson = dataJson; }

    public LocalDateTime getCreatedAt() { return createdAt; }
    public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }

    public LocalDateTime getUpdatedAt() { return updatedAt; }
    public void setUpdatedAt(LocalDateTime updatedAt) { this.updatedAt = updatedAt; }
}
