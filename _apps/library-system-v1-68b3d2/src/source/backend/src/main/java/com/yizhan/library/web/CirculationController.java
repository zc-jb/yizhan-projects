package com.yizhan.library.web;

import com.yizhan.library.entity.Book;
import com.yizhan.library.entity.Borrow;
import com.yizhan.library.entity.Reader;
import com.yizhan.library.repo.BookRepository;
import com.yizhan.library.repo.BorrowRepository;
import com.yizhan.library.repo.CategoryRepository;
import com.yizhan.library.repo.ReaderRepository;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

@RestController
@RequestMapping("/api")
public class CirculationController {
    private final BookRepository bookRepo;
    private final ReaderRepository readerRepo;
    private final BorrowRepository borrowRepo;
    private final CategoryRepository categoryRepo;

    public CirculationController(BookRepository bookRepo, ReaderRepository readerRepo,
                                 BorrowRepository borrowRepo, CategoryRepository categoryRepo) {
        this.bookRepo = bookRepo;
        this.readerRepo = readerRepo;
        this.borrowRepo = borrowRepo;
        this.categoryRepo = categoryRepo;
    }

    @GetMapping("/readers")
    public List<Reader> readers(@RequestParam(required = false) String keyword) {
        String kw = keyword == null ? "" : keyword.trim().toLowerCase();
        return readerRepo.findAll().stream()
                .filter(r -> kw.isEmpty()
                        || r.getName().toLowerCase().contains(kw)
                        || r.getCardNo().toLowerCase().contains(kw)
                        || (r.getPhone() != null && r.getPhone().contains(kw)))
                .sorted(Comparator.comparing(Reader::getId).reversed())
                .toList();
    }

    @PostMapping("/readers")
    public Reader createReader(@RequestBody Reader req) {
        if (req.getName() == null || req.getName().trim().isEmpty()) {
            throw new ApiExceptionHandler.ApiException("读者姓名不能为空");
        }
        Reader r = new Reader();
        r.setName(req.getName().trim());
        r.setGender(req.getGender());
        r.setPhone(req.getPhone());
        r.setCardNo(req.getCardNo() == null || req.getCardNo().trim().isEmpty()
                ? nextCardNo() : req.getCardNo().trim());
        return readerRepo.save(r);
    }

    @PutMapping("/readers/{id}")
    public Reader updateReader(@PathVariable Long id, @RequestBody Reader req) {
        Reader r = readerRepo.findById(id).orElseThrow(() -> new ApiExceptionHandler.ApiException("读者不存在"));
        if (req.getName() == null || req.getName().trim().isEmpty()) {
            throw new ApiExceptionHandler.ApiException("读者姓名不能为空");
        }
        r.setName(req.getName().trim());
        r.setGender(req.getGender());
        r.setPhone(req.getPhone());
        if (req.getCardNo() != null && !req.getCardNo().trim().isEmpty()) r.setCardNo(req.getCardNo().trim());
        return readerRepo.save(r);
    }

    @DeleteMapping("/readers/{id}")
    public void deleteReader(@PathVariable Long id) {
        if (borrowRepo.countByReaderIdAndReturnDateIsNull(id) > 0) {
            throw new ApiExceptionHandler.ApiException("该读者还有未归还的图书，不能删除");
        }
        if (borrowRepo.countByReaderId(id) > 0) {
            throw new ApiExceptionHandler.ApiException("该读者存在借阅历史，为保留数据不能删除");
        }
        readerRepo.deleteById(id);
    }

    @GetMapping("/borrows")
    public List<Map<String, Object>> borrows(@RequestParam(defaultValue = "all") String status) {
        Map<Long, Book> books = new HashMap<>();
        for (Book b : bookRepo.findAll()) books.put(b.getId(), b);
        Map<Long, Reader> readers = new HashMap<>();
        for (Reader r : readerRepo.findAll()) readers.put(r.getId(), r);

        LocalDate today = LocalDate.now();
        return borrowRepo.findAllByOrderByIdDesc().stream()
                .filter(b -> {
                    String state = stateOf(b, today);
                    return "all".equals(status) || state.equals(status)
                            || ("active".equals(status) && ("active".equals(state) || "overdue".equals(state)));
                })
                .map(b -> view(b, books.get(b.getBookId()), readers.get(b.getReaderId()), today))
                .toList();
    }

    @PostMapping("/borrows")
    @Transactional
    public Map<String, Object> borrow(@RequestBody Map<String, Long> req) {
        Long bookId = req.get("bookId");
        Long readerId = req.get("readerId");
        if (bookId == null || readerId == null) throw new ApiExceptionHandler.ApiException("请选择图书和读者");
        Book book = bookRepo.findById(bookId).orElseThrow(() -> new ApiExceptionHandler.ApiException("图书不存在"));
        Reader reader = readerRepo.findById(readerId).orElseThrow(() -> new ApiExceptionHandler.ApiException("读者不存在"));
        if (book.getAvailable() == null || book.getAvailable() < 1) {
            throw new ApiExceptionHandler.ApiException("《" + book.getTitle() + "》已全部借出");
        }
        book.setAvailable(book.getAvailable() - 1);
        bookRepo.save(book);

        LocalDate today = LocalDate.now();
        Borrow b = new Borrow();
        b.setBookId(bookId);
        b.setReaderId(readerId);
        b.setBorrowDate(today);
        b.setDueDate(today.plusDays(30));
        borrowRepo.save(b);
        return view(b, book, reader, today);
    }

    @PostMapping("/borrows/{id}/return")
    @Transactional
    public Map<String, Object> giveBack(@PathVariable Long id) {
        Borrow b = borrowRepo.findById(id).orElseThrow(() -> new ApiExceptionHandler.ApiException("借阅记录不存在"));
        if (b.getReturnDate() != null) throw new ApiExceptionHandler.ApiException("该记录已归还");
        LocalDate today = LocalDate.now();
        b.setReturnDate(today);
        borrowRepo.save(b);
        bookRepo.findById(b.getBookId()).ifPresent(book -> {
            book.setAvailable((book.getAvailable() == null ? 0 : book.getAvailable()) + 1);
            bookRepo.save(book);
        });
        Book book = bookRepo.findById(b.getBookId()).orElse(null);
        Reader reader = readerRepo.findById(b.getReaderId()).orElse(null);
        return view(b, book, reader, today);
    }

    @GetMapping("/stats")
    public Map<String, Object> stats() {
        long bookTitles = bookRepo.count();
        int totalCopies = bookRepo.findAll().stream().mapToInt(b -> b.getTotal() == null ? 0 : b.getTotal()).sum();
        int availableCopies = bookRepo.findAll().stream().mapToInt(b -> b.getAvailable() == null ? 0 : b.getAvailable()).sum();
        LocalDate today = LocalDate.now();
        long active = borrowRepo.countByReturnDateIsNull();
        long overdue = borrowRepo.countByReturnDateIsNullAndDueDateBefore(today);
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("bookTitles", bookTitles);
        m.put("totalCopies", totalCopies);
        m.put("availableCopies", availableCopies);
        m.put("borrowedCopies", totalCopies - availableCopies);
        m.put("readerCount", readerRepo.count());
        m.put("categoryCount", categoryRepo.count());
        m.put("activeBorrows", active);
        m.put("overdue", overdue);
        m.put("today", today.toString());
        return m;
    }

    private String nextCardNo() {
        String prefix = "R" + LocalDate.now().format(DateTimeFormatter.ofPattern("yyyy"));
        java.util.Set<String> existing = readerRepo.findAll().stream()
                .map(Reader::getCardNo)
                .collect(java.util.stream.Collectors.toSet());
        int seq = (int) readerRepo.count() + 1;
        String card = prefix + String.format("%03d", seq);
        while (existing.contains(card)) {
            seq++;
            card = prefix + String.format("%03d", seq);
        }
        return card;
    }

    private String stateOf(Borrow b, LocalDate today) {
        if (b.getReturnDate() != null) return "returned";
        return b.getDueDate() != null && b.getDueDate().isBefore(today) ? "overdue" : "active";
    }

    private Map<String, Object> view(Borrow b, Book book, Reader reader, LocalDate today) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", b.getId());
        m.put("bookId", b.getBookId());
        m.put("bookTitle", book == null ? "已删除图书" : book.getTitle());
        m.put("readerId", b.getReaderId());
        m.put("readerName", reader == null ? "已删除读者" : reader.getName());
        m.put("readerCardNo", reader == null ? "" : reader.getCardNo());
        m.put("borrowDate", b.getBorrowDate().toString());
        m.put("dueDate", b.getDueDate().toString());
        m.put("returnDate", b.getReturnDate() == null ? "" : b.getReturnDate().toString());
        m.put("status", stateOf(b, today));
        return m;
    }
}
