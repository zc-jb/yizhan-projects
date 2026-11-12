package com.office.seed;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.office.entity.Report;
import com.office.entity.Tip;
import com.office.repo.ReportRepository;
import com.office.repo.TipRepository;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.LocalDateTime;
import java.util.*;

/**
 * 首次启动生成演示数据（报表为空 / 技巧为空时才写入）。
 */
@Component
public class DataSeeder implements CommandLineRunner {

    private final ReportRepository reports;
    private final TipRepository tips;
    private final ObjectMapper om = new ObjectMapper();

    public DataSeeder(ReportRepository reports, TipRepository tips) {
        this.reports = reports;
        this.tips = tips;
    }

    @Override
    public void run(String... args) {
        if (reports.count() == 0) seedReports();
        if (tips.count() == 0) seedTips();
    }

    /* ---------------- 月报演示数据 ---------------- */

    private void seedReports() {
        seedReport("2026-06", "综合行政部", "已归档", 12, new int[][]{
                {12800, 12150, 8600, 7900, 3600, 4120, 7200, 6600, 5400, 5800, 9800, 9800, 3600, 3100, 2600, 2950}
        }, new String[]{"办公耗材", "打印复印", "快递物流", "差旅交通", "会议接待", "软件订阅", "水电物业", "其他杂项"});

        seedReport("2026-07", "综合行政部", "已归档", 11, new int[][]{
                {12800, 11420, 8600, 8350, 3600, 3280, 7200, 6900, 5400, 4950, 9800, 9800, 3600, 3880, 2600, 2410}
        }, null);

        seedReport("2026-08", "人力资源部", "已归档", 10, new int[][]{
                {12000, 13240, 8000, 8650, 3200, 3010, 7600, 8420, 6000, 6320, 9800, 9800, 3900, 4150, 2800, 2620}
        }, null);

        seedReport("2026-09", "财务部", "已归档", 9, new int[][]{
                {13500, 13980, 9000, 8720, 3800, 4050, 8200, 7860, 5600, 5380, 10200, 10200, 4200, 3960, 3000, 3260}
        }, null);

        seedReport("2026-10", "综合行政部", "已提交", 8, new int[][]{
                {14000, 12680, 9200, 8940, 4000, 3720, 8600, 9120, 6000, 5860, 10200, 10200, 4400, 4680, 3200, 2980}
        }, null);

        seedReport("2026-11", "综合行政部", "草稿", 5, new int[][]{
                {14000, 12860, 9200, 8640, 4000, 2480, 8600, 5320, 6000, 4260, 10200, 10200, 4400, 4400, 3200, 1760}
        }, null);
    }

    private void seedReport(String period, String dept, String status, int day, int[][] pairs, String[] names) {
        String[] rowNames = names != null ? names
                : new String[]{"办公耗材", "打印复印", "快递物流", "差旅交通", "会议接待", "软件订阅", "水电物业", "其他杂项"};
        List<Map<String, Object>> rows = new ArrayList<>();
        BigDecimal budgetSum = BigDecimal.ZERO;
        BigDecimal actualSum = BigDecimal.ZERO;
        for (int i = 0; i < rowNames.length; i++) {
            Map<String, Object> row = new LinkedHashMap<>();
            int budget = pairs[0][i * 2];
            int actual = pairs[0][i * 2 + 1];
            row.put("name", rowNames[i]);
            row.put("budget", budget);
            row.put("actual", actual);
            row.put("note", i == 0 && "2026-11".equals(period) ? "纸品与文具补货" : "");
            rows.add(row);
            budgetSum = budgetSum.add(BigDecimal.valueOf(budget));
            actualSum = actualSum.add(BigDecimal.valueOf(actual));
        }
        Map<String, Object> root = new LinkedHashMap<>();
        root.put("rows", rows);

        Report r = new Report();
        r.setTitle(period.replace("-", " 年 ") + " 月 办公费用月报");
        r.setPeriod(period);
        r.setDept(dept);
        r.setStatus(status);
        try {
            r.setDataJson(om.writeValueAsString(root));
        } catch (Exception e) {
            r.setDataJson("{\"rows\":[]}");
        }
        r.setBudget(budgetSum);
        r.setTotal(actualSum);
        r.setRate(budgetSum.compareTo(BigDecimal.ZERO) > 0
                ? actualSum.multiply(BigDecimal.valueOf(100)).divide(budgetSum, 2, RoundingMode.HALF_UP)
                : BigDecimal.ZERO);
        r.setOwner("admin");
        LocalDateTime t = LocalDateTime.of(2026, Integer.parseInt(period.substring(5)), day, 10, 0);
        r.setCreatedAt(t);
        r.setUpdatedAt(t);
        reports.save(r);
    }

    /* ---------------- 办公技巧演示数据 ---------------- */

    private void seedTips() {
        tip("快捷键", "复制 / 粘贴 / 剪切三件套", "Ctrl + C / V / X，配合 Ctrl + Shift + V 可粘贴为纯文本。",
                "1. Ctrl + C 复制，Ctrl + V 粘贴，Ctrl + X 剪切。\n2. 从网页复制内容时用 Ctrl + Shift + V 去掉多余样式。\n3. Win + V 打开剪贴板历史，可找回之前复制过的多条内容。", "Ctrl+C / Ctrl+V / Ctrl+X", 268);
        tip("快捷键", "Win + Shift + S 区域截图", "系统自带截图，支持矩形、窗口、全屏与自由形状。",
                "1. 按 Win + Shift + S 屏幕变暗，进入截图模式。\n2. 拖拽选择区域后自动复制到剪贴板，直接 Ctrl + V 粘贴到文档或聊天窗口。\n3. 需要标注时点击弹出的通知进入「截图工具」编辑。", "Win + Shift + S", 241);
        tip("快捷键", "Alt + Tab 与 Win + Tab 切换窗口", "Alt + Tab 快速切换，Win + Tab 查看任务视图与虚拟桌面。",
                "1. 按住 Alt 连续点 Tab 可在多个窗口间循环。\n2. Win + Tab 打开任务视图，可新建虚拟桌面把工作与娱乐分开。\n3. Win + Ctrl + 左右方向键可切换虚拟桌面。", "Alt + Tab / Win + Tab", 203);
        tip("快捷键", "Win + E 秒开资源管理器", "无论当前在哪个程序，都能立刻打开文件资源管理器。",
                "1. Win + E 打开「此电脑」。\n2. 在地址栏输入 \\\\服务器名 可访问共享文件夹。\n3. Ctrl + Shift + N 新建文件夹，F2 重命名。", "Win + E", 189);

        tip("Excel 函数", "SUM 求和：月报合计首选", "SUM 自动忽略文本，配合区域引用一次算出整列合计。",
                "=SUM(B2:B9) 计算 B2 到 B9 的合计。\n小技巧：选中数据区域后按 Alt + = 可一键生成 SUM 公式。\n跨表汇总：=SUM(1月!B2:B9,2月!B2:B9)。", "=SUM(区域)", 322);
        tip("Excel 函数", "IF 条件判断：执行率是否超标", "IF 根据条件返回不同结果，常用于超标提醒。",
                "=IF(D2>C2,\"超预算\",\"正常\")\n嵌套写法：=IF(D2>C2,\"超支\",IF(D2=C2,\"持平\",\"结余\"))\n配合条件格式可让超标行自动变红。", "=IF(条件,真值,假值)", 287);
        tip("Excel 函数", "ROUND 四舍五入保留两位小数", "金额类报表统一保留两位小数，避免出现 0.30000000004。",
                "=ROUND(D2/C2*100,2) 计算执行率并保留两位小数。\n向上取整用 ROUNDUP，向下取整用 ROUNDDOWN。", "=ROUND(数值,2)", 231);
        tip("Excel 函数", "SUMIF / COUNTIF 条件汇总", "按部门、科目等条件汇总，做分类月报非常高效。",
                "=SUMIF(A:A,\"差旅交通\",D:D) 汇总差旅交通的实际金额。\n=COUNTIF(D:D,\">10000\") 统计超过一万元的条目数量。", "=SUMIF(条件区域,条件,求和区域)", 265);
        tip("Excel 函数", "VLOOKUP 跨表取数", "从员工表、科目表里自动带出对应信息。",
                "=VLOOKUP(A2,科目表!A:B,2,FALSE)\n注意第四个参数写 FALSE 表示精确匹配。\n查不到时用 IFERROR 包裹：=IFERROR(VLOOKUP(...),\"未找到\")。", "=VLOOKUP(查找值,区域,列号,FALSE)", 254);
        tip("Excel 函数", "TEXT 与日期函数格式化", "把日期显示成「2026年11月」，或计算月份差。",
                "=TEXT(TODAY(),\"yyyy年m月\")\n=DATEDIF(起始日期,TODAY(),\"m\") 计算相差月数。\n月报标题可用 =TEXT(EOMONTH(TODAY(),-1),\"yyyy年m月\") 取上月。", "=TEXT(值,\"格式\")", 176);

        tip("系统操作", "Win + L 一键锁屏", "离开工位前锁屏，保护公司数据安全。",
                "1. Win + L 立即锁屏。\n2. 可设置「屏幕保护程序」在闲置 5 分钟后自动锁定。\n3. 笔记本合盖也能设置为锁定。", "Win + L", 198);
        tip("系统操作", "清理 C 盘：存储感知自动释放空间", "Windows 自带的存储感知可以定期清理临时文件。",
                "1. 设置 → 系统 → 存储 → 打开「存储感知」。\n2. 配置自动清理临时文件与回收站。\n3. 点击「临时文件」可手动释放数 GB 空间。", "设置 → 存储", 167);
        tip("系统操作", "固定常用文件夹到快速访问", "把月报目录、共享盘固定到侧边栏，减少点击层级。",
                "1. 右键目标文件夹 → 「固定到快速访问」。\n2. 拖动可调整顺序。\n3. 右键快速访问项可取消固定。", "右键 → 固定到快速访问", 132);
        tip("系统操作", "任务管理器看卡顿元凶", "电脑变慢时，先看是 CPU、内存还是磁盘占满。",
                "1. Ctrl + Shift + Esc 直接打开任务管理器。\n2. 「启动」选项卡禁用不必要的开机自启项。\n3. 发现异常进程可右键「结束任务」。", "Ctrl + Shift + Esc", 214);

        tip("打印与文件", "打印前先看打印预览", "避免排版错位、表格被截断造成纸张浪费。",
                "1. Ctrl + P 打开打印面板，右侧即为预览。\n2. 表格太宽时选择「横向」或「将所有列调整为一页」。\n3. 长期存档建议先「导出为 PDF」再打印。", "Ctrl + P", 175);
        tip("打印与文件", "批量重命名文件", "一次给几十个文件统一改名，不用一个个敲。",
                "1. 全选文件（Ctrl + A）后按 F2。\n2. 输入基础名称，系统自动追加 (1)(2)(3)。\n3. 需要更复杂的规则可用 PowerToys 的 PowerRename。", "全选 → F2", 151);
        tip("打印与文件", "文件压缩与解压", "发邮件附件过大时，先压缩再发送。",
                "1. 右键文件 → 发送到 → 压缩(zipped)文件夹。\n2. 或使用 7-Zip 选择「添加到压缩包」，可设置密码。\n3. 解压时注意不要直接双击压缩包内的可执行文件。", "右键 → 发送到 → 压缩文件夹", 143);
        tip("打印与文件", "给文件夹设置密码保护", "敏感报表可放进加密压缩包或使用 BitLocker。",
                "1. 用 7-Zip 添加压缩包时设置密码并勾选「加密文件名」。\n2. 整盘加密使用 BitLocker（专业版）。\n3. 密码务必走公司密码管理流程保管。", "7-Zip 加密", 118);

        tip("办公效率", "邮件定时发送", "下班前写好邮件，设置次日早上 9 点自动发出。",
                "1. Outlook 中写完邮件 → 「延迟传递」。\n2. 设置发送时间，如明日 09:00。\n3. 邮件会停留在「发件箱」直到时间到达。", "Outlook → 延迟传递", 162);
        tip("办公效率", "会议室投屏与扩展屏", "Win + P 切换复制 / 扩展模式，演示更自然。",
                "1. Win + P 选择「复制」或「扩展」。\n2. 扩展模式下把讲稿放在笔记本屏幕，投影只放幻灯片。\n3. 演示时按 Alt + F5 进入演讲者视图。", "Win + P", 154);
        tip("办公效率", "用待办清单管理每日工作", "每天上班先列 3 件最重要的事，下班前复盘。",
                "1. 用 Windows「任务」或 To Do 建立「今天」清单。\n2. 每件事拆成 30 分钟内可完成的小步骤。\n3. 完成后打勾，未完成项顺延并标注原因。", "To Do / 微软待办", 128);
        tip("办公效率", "批量处理 Excel 工作簿", "多个部门的月报结构一致时，可用 Power Query 合并。",
                "1. 数据 → 获取数据 → 从文件夹。\n2. 选择月报所在文件夹，合并并转换。\n3. 后续新增文件只需点击「刷新」。", "Power Query", 137);
    }

    private void tip(String category, String title, String summary, String content, String shortcut, int views) {
        Tip t = new Tip();
        t.setCategory(category);
        t.setTitle(title);
        t.setSummary(summary);
        t.setContent(content);
        t.setShortcut(shortcut);
        t.setViews(views);
        t.setCreatedAt(LocalDateTime.of(2026, 11, 1 + (views % 9), 9, 0));
        tips.save(t);
    }
}
