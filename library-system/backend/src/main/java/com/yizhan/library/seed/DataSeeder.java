package com.yizhan.library.seed;

import com.yizhan.library.entity.*;
import com.yizhan.library.repo.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.*;

@Component
public class DataSeeder implements CommandLineRunner {
    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private final BookRepository bookRepo;
    private final CategoryRepository categoryRepo;
    private final ReaderRepository readerRepo;
    private final BorrowRepository borrowRepo;

    public DataSeeder(BookRepository bookRepo, CategoryRepository categoryRepo,
                      ReaderRepository readerRepo, BorrowRepository borrowRepo) {
        this.bookRepo = bookRepo;
        this.categoryRepo = categoryRepo;
        this.readerRepo = readerRepo;
        this.borrowRepo = borrowRepo;
    }

    @Override
    public void run(String... args) {
        if (categoryRepo.count() == 0) seedCategories();
        if (bookRepo.count() == 0) seedBooks();
        if (readerRepo.count() == 0) seedReaders();
        if (borrowRepo.count() == 0) seedBorrows();
        log.info("演示数据就绪：图书 {} 种 / 读者 {} 人 / 借阅 {} 条",
                bookRepo.count(), readerRepo.count(), borrowRepo.count());
    }

    private void seedCategories() {
        String[][] data = {
                {"文学", "小说、散文、诗歌与经典名著"},
                {"科技", "计算机、软件工程与前沿技术"},
                {"历史", "通史、断代史与人物传记"},
                {"艺术", "美术、音乐、设计与摄影"},
                {"经济", "经济学、金融与商业管理"},
                {"教育", "教育学、心理学与学习方法"},
                {"医学", "基础医学与临床实践"},
                {"少儿", "绘本、童话与青少年读物"},
        };
        for (String[] row : data) {
            Category c = new Category();
            c.setName(row[0]);
            c.setDescription(row[1]);
            categoryRepo.save(c);
        }
    }

    private void seedBooks() {
        Random random = new Random(20261108L);
        List<Category> categories = categoryRepo.findAll();
        String[] subjects = {
                "Java 编程", "Spring Boot 实战", "Vue.js 前端", "MySQL 数据库", "算法设计",
                "数据结构", "计算机网络", "操作系统", "人工智能", "机器学习",
                "唐诗鉴赏", "中国通史", "世界美术史", "宏观经济学", "儿童文学",
                "临床医学基础", "教育学原理", "Python 数据分析", "微服务架构", "前端工程化"
        };
        String[] prefixes = {"深入理解", "图解", "实战", "从入门到精通", "现代", "经典案例", "简明教程", "进阶指南"};
        String[] publishers = {"人民邮电出版社", "机械工业出版社", "清华大学出版社", "中信出版社", "商务印书馆", "电子工业出版社"};
        String[] surnames = {"张", "王", "李", "赵", "刘", "陈", "杨", "周", "吴", "徐", "孙", "马", "朱", "胡", "郭"};
        String[] givens = {"伟", "敏", "静", "磊", "洋", "强", "军", "杰", "涛", "明", "超", "芳", "霞", "鹏", "斌"};

        Set<String> usedTitles = new HashSet<>();
        int created = 0;
        while (created < 60) {
            String title = prefixes[random.nextInt(prefixes.length)] + subjects[random.nextInt(subjects.length)];
            if (!usedTitles.add(title)) continue;
            Book b = new Book();
            b.setTitle(title);
            b.setAuthor(surnames[random.nextInt(surnames.length)] + givens[random.nextInt(givens.length)]
                    + (random.nextBoolean() ? givens[random.nextInt(givens.length)] : ""));
            b.setIsbn("978-7-" + (100 + random.nextInt(600)) + "-" + (1000 + random.nextInt(9000)) + "-" + random.nextInt(10));
            b.setPublisher(publishers[random.nextInt(publishers.length)]);
            b.setPublishYear(2008 + random.nextInt(18));
            b.setCategoryId(categories.get(random.nextInt(categories.size())).getId());
            int total = 2 + random.nextInt(5);
            b.setTotal(total);
            b.setAvailable(total);
            bookRepo.save(b);
            created++;
        }
    }

    private void seedReaders() {
        Random random = new Random(20261109L);
        String[] surnames = {"张", "王", "李", "赵", "刘", "陈", "杨", "周", "吴", "徐", "孙", "马"};
        String[] givens = {"小雨", "思远", "子涵", "浩然", "梓萱", "宇航", "雨桐", "俊杰", "欣怡", "文博", "佳琪", "天佑"};
        for (int i = 0; i < 28; i++) {
            Reader r = new Reader();
            r.setCardNo("R2026" + String.format("%03d", i + 1));
            r.setName(surnames[random.nextInt(surnames.length)] + givens[random.nextInt(givens.length)]);
            r.setGender(random.nextBoolean() ? "男" : "女");
            r.setPhone("13" + (random.nextInt(8) + 1) + String.format("%08d", random.nextInt(100000000)));
            r.setCreatedAt(LocalDateTime.now().minusDays(10 + random.nextInt(700)));
            readerRepo.save(r);
        }
    }

    private void seedBorrows() {
        Random random = new Random(20261110L);
        List<Book> books = bookRepo.findAll();
        List<Reader> readers = readerRepo.findAll();
        Map<Long, Integer> remaining = new HashMap<>();
        for (Book b : books) remaining.put(b.getId(), b.getTotal() == null ? 1 : b.getTotal());

        LocalDate today = LocalDate.now();
        int target = 62;
        int made = 0;
        int guard = 0;
        while (made < target && guard++ < target * 20) {
            Book book = books.get(random.nextInt(books.size()));
            Reader reader = readers.get(random.nextInt(readers.size()));
            int left = remaining.getOrDefault(book.getId(), 0);
            if (left <= 0) continue;

            boolean returned = made % 4 == 0;
            boolean overdue = !returned && made % 5 == 1;
            LocalDate borrowDate;
            LocalDate dueDate;
            LocalDate returnDate = null;

            if (returned) {
                borrowDate = today.minusDays(12 + random.nextInt(50));
                dueDate = borrowDate.plusDays(30);
                returnDate = borrowDate.plusDays(3 + random.nextInt(25));
                if (returnDate.isAfter(today)) returnDate = today;
            } else if (overdue) {
                borrowDate = today.minusDays(38 + random.nextInt(22));
                dueDate = borrowDate.plusDays(30);
            } else {
                borrowDate = today.minusDays(1 + random.nextInt(25));
                dueDate = borrowDate.plusDays(30);
            }

            Borrow b = new Borrow();
            b.setBookId(book.getId());
            b.setReaderId(reader.getId());
            b.setBorrowDate(borrowDate);
            b.setDueDate(dueDate);
            b.setReturnDate(returnDate);
            borrowRepo.save(b);

            if (returnDate == null) remaining.put(book.getId(), left - 1);
            made++;
        }
        for (Book book : books) {
            book.setAvailable(remaining.getOrDefault(book.getId(), book.getTotal()));
            bookRepo.save(book);
        }
    }
}
