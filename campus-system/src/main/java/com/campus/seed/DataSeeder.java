package com.campus.seed;

import com.campus.entity.*;
import com.campus.repo.*;
import com.campus.service.AuthService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * 演示数据初始化：各表为空时自动写入，重启不会重复插入
 */
@Component
public class DataSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);
    private static final String DEMO_PASSWORD = AuthService.sha256("123456");

    private final AdminUserRepository adminUserRepository;
    private final StudentRepository studentRepository;
    private final TeacherRepository teacherRepository;
    private final CourseRepository courseRepository;
    private final ScoreRepository scoreRepository;
    private final NoticeRepository noticeRepository;

    public DataSeeder(AdminUserRepository adminUserRepository,
                      StudentRepository studentRepository,
                      TeacherRepository teacherRepository,
                      CourseRepository courseRepository,
                      ScoreRepository scoreRepository,
                      NoticeRepository noticeRepository) {
        this.adminUserRepository = adminUserRepository;
        this.studentRepository = studentRepository;
        this.teacherRepository = teacherRepository;
        this.courseRepository = courseRepository;
        this.scoreRepository = scoreRepository;
        this.noticeRepository = noticeRepository;
    }

    @Override
    @Transactional
    public void run(String... args) {
        seedAdmin();
        seedTeachers();
        seedStudents();
        seedCourses();
        seedScores();
        seedNotices();

        log.info("演示数据就绪：学生 {} 人，教师 {} 人，课程 {} 门，成绩 {} 条，公告 {} 条",
                studentRepository.count(), teacherRepository.count(), courseRepository.count(),
                scoreRepository.count(), noticeRepository.count());
    }

    private void seedAdmin() {
        if (adminUserRepository.count() > 0) {
            return;
        }
        AdminUser admin = new AdminUser();
        admin.setUsername("admin");
        admin.setPassword(DEMO_PASSWORD);
        admin.setRealName("系统管理员");
        adminUserRepository.save(admin);
    }

    private void seedTeachers() {
        if (teacherRepository.count() > 0) {
            return;
        }
        teacherRepository.saveAll(List.of(
                teacher("T001", "张伟", "教授", "数学学院"),
                teacher("T002", "李娜", "副教授", "外国语学院"),
                teacher("T003", "王强", "讲师", "计算机学院"),
                teacher("T004", "赵敏", "副教授", "计算机学院"),
                teacher("T005", "陈杰", "讲师", "马克思主义学院"),
                teacher("T006", "刘洋", "讲师", "体育学院")
        ));
    }

    private void seedStudents() {
        if (studentRepository.count() > 0) {
            return;
        }
        String[][] rows = {
                {"stu001", "林小满", "女", "计算机2301", "计算机科学与技术", "13800000001", "linxm@campus.edu.cn", "2023"},
                {"stu002", "陈子昂", "男", "计算机2301", "计算机科学与技术", "13800000002", "chenza@campus.edu.cn", "2023"},
                {"stu003", "苏雨桐", "女", "计算机2301", "计算机科学与技术", "13800000003", "suyt@campus.edu.cn", "2023"},
                {"stu004", "周亦辰", "男", "计算机2301", "计算机科学与技术", "13800000004", "zhouyc@campus.edu.cn", "2023"},
                {"stu005", "许安然", "女", "软件2301", "软件工程", "13800000005", "xuar@campus.edu.cn", "2023"},
                {"stu006", "赵一鸣", "男", "软件2301", "软件工程", "13800000006", "zhaoym@campus.edu.cn", "2023"},
                {"stu007", "沈思远", "男", "软件2301", "软件工程", "13800000007", "shensy@campus.edu.cn", "2023"},
                {"stu008", "顾清和", "女", "软件2301", "软件工程", "13800000008", "guqh@campus.edu.cn", "2023"},
                {"stu009", "唐可欣", "女", "数据2301", "数据科学与大数据技术", "13800000009", "tangkx@campus.edu.cn", "2023"},
                {"stu010", "何俊宇", "男", "数据2301", "数据科学与大数据技术", "13800000010", "hejy@campus.edu.cn", "2023"},
                {"stu011", "吴瑾言", "女", "数据2301", "数据科学与大数据技术", "13800000011", "wujy@campus.edu.cn", "2023"},
                {"stu012", "郑夏", "男", "数据2301", "数据科学与大数据技术", "13800000012", "zhengx@campus.edu.cn", "2023"}
        };

        List<Student> students = new ArrayList<>();
        for (String[] row : rows) {
            Student student = new Student();
            student.setStudentNo(row[0]);
            student.setName(row[1]);
            student.setGender(row[2]);
            student.setClassName(row[3]);
            student.setMajor(row[4]);
            student.setPhone(row[5]);
            student.setEmail(row[6]);
            student.setEnrollYear(Integer.parseInt(row[7]));
            student.setPassword(DEMO_PASSWORD);
            students.add(student);
        }
        studentRepository.saveAll(students);
    }

    private void seedCourses() {
        if (courseRepository.count() > 0) {
            return;
        }
        courseRepository.saveAll(List.of(
                course("C001", "高等数学", "张伟", 4.0, "周一 08:00-09:40", "教学楼 A101"),
                course("C002", "大学英语", "李娜", 3.0, "周二 10:00-11:40", "教学楼 B203"),
                course("C003", "数据结构", "王强", 4.0, "周三 14:00-15:40", "实验楼 302"),
                course("C004", "计算机网络", "赵敏", 3.5, "周四 08:00-09:40", "教学楼 A305"),
                course("C005", "中国近代史纲要", "陈杰", 2.0, "周五 10:00-11:40", "教学楼 B101"),
                course("C006", "体育（篮球）", "刘洋", 1.0, "周三 16:00-17:40", "体育馆")
        ));
    }

    /** 每个学生生成 3~5 条稳定分布的成绩 */
    private void seedScores() {
        if (scoreRepository.count() > 0) {
            return;
        }
        List<Student> students = studentRepository.findAll();
        List<Course> courses = courseRepository.findAll();
        if (students.isEmpty() || courses.isEmpty()) {
            return;
        }

        List<Score> scores = new ArrayList<>();
        for (int i = 0; i < students.size(); i++) {
            int courseCount = 3 + (i % 3);
            for (int j = 0; j < courseCount && j < courses.size(); j++) {
                Score score = new Score();
                score.setStudentId(students.get(i).getId());
                score.setCourseId(courses.get(j).getId());
                score.setScore((double) (60 + ((i * 7 + j * 11) % 41)));
                score.setSemester("2025-2026-1");
                scores.add(score);
            }
        }
        scoreRepository.saveAll(scores);
    }

    private void seedNotices() {
        if (noticeRepository.count() > 0) {
            return;
        }
        LocalDateTime now = LocalDateTime.now();
        List<Notice> notices = List.of(
                notice("关于 2025-2026 学年第一学期期末考试安排的通知",
                        "期末考试将于第 18-19 周进行，请各位同学提前登录教务系统查询考场与座位号，携带学生证及身份证按时参加考试。",
                        true, "教务处", now.minusHours(2)),
                notice("校园网络设备升级维护公告",
                        "本周六 00:00-06:00 将对教学楼核心交换机进行升级，期间宿舍区网络不受影响，如有不便敬请谅解。",
                        false, "信息中心", now.minusDays(1)),
                notice("秋季校园招聘会报名开启",
                        "本次招聘会共有 86 家企业参会，涵盖互联网、金融、智能制造等行业，请在就业平台完成报名并完善简历。",
                        false, "就业指导中心", now.minusDays(3)),
                notice("图书馆延长开放时间",
                        "自本周起，图书馆自习区开放时间延长至 23:00，考研专区 24 小时开放，请同学们合理安排作息。",
                        false, "图书馆", now.minusDays(5)),
                notice("关于开展校园消防安全演练的通知",
                        "本周四下午 15:00 将在 3 号宿舍楼开展消防疏散演练，请相关楼栋同学听从引导有序撤离。",
                        false, "保卫处", now.minusDays(8))
        );
        noticeRepository.saveAll(notices);
    }

    private Teacher teacher(String no, String name, String title, String department) {
        Teacher teacher = new Teacher();
        teacher.setTeacherNo(no);
        teacher.setName(name);
        teacher.setTitle(title);
        teacher.setDepartment(department);
        return teacher;
    }

    private Course course(String no, String name, String teacher, double credit, String schedule, String location) {
        Course course = new Course();
        course.setCourseNo(no);
        course.setName(name);
        course.setTeacher(teacher);
        course.setCredit(credit);
        course.setSchedule(schedule);
        course.setLocation(location);
        return course;
    }

    private Notice notice(String title, String content, boolean important, String publisher,
                          LocalDateTime createdAt) {
        Notice notice = new Notice();
        notice.setTitle(title);
        notice.setContent(content);
        notice.setImportant(important);
        notice.setPublisher(publisher);
        notice.setCreatedAt(createdAt);
        return notice;
    }
}
