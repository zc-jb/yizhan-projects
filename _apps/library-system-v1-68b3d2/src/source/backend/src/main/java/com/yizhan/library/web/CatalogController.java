package com.yizhan.library.web;

import com.yizhan.library.entity.Book;
import com.yizhan.library.entity.Category;
import com.yizhan.library.repo.BookRepository;
import com.yizhan.library.repo.BorrowRepository;
import com.yizhan.library.repo.CategoryRepository;
import org.springframework.web.bind.annotation.*;

import java.util.Comparator;
import java.util.List;

@RestController
@RequestMapping("/api")
public class CatalogController {
    private final BookRepository bookRepo;
    private final CategoryRepository categoryRepo;
    private final BorrowRepository borrowRepo;

    public CatalogController(BookRepository bookRepo, CategoryRepository categoryRepo, BorrowRepository borrowRepo) {
        this.bookRepo = bookRepo;
        this.categoryRepo = categoryRepo;
        this.borrowRepo = borrowRepo;
    }

    @GetMapping("/books")
    public List<Book> books(@RequestParam(required = false) String keyword,
                            @RequestParam(required = false) Long categoryId) {
        List<Book> all = bookRepo.findAll();
        String kw = keyword == null ? "" : keyword.trim().toLowerCase();
        return all.stream()
                .filter(b -> categoryId == null || categoryId.equals(b.getCategoryId()))
                .filter(b -> kw.isEmpty()
                        || b.getTitle().toLowerCase().contains(kw)
                        || b.getAuthor().toLowerCase().contains(kw)
                        || (b.getIsbn() != null && b.getIsbn().toLowerCase().contains(kw)))
                .sorted(Comparator.comparing(Book::getId).reversed())
                .toList();
    }

    @PostMapping("/books")
    public Book createBook(@RequestBody Book req) {
        validateBook(req, null);
        Book book = new Book();
        copy(req, book);
        book.setId(null);
        if (book.getTotal() == null || book.getTotal() < 1) book.setTotal(1);
        book.setAvailable(book.getTotal());
        return bookRepo.save(book);
    }

    @PutMapping("/books/{id}")
    public Book updateBook(@PathVariable Long id, @RequestBody Book req) {
        Book book = bookRepo.findById(id).orElseThrow(() -> new ApiExceptionHandler.ApiException("图书不存在"));
        validateBook(req, book);
        int borrowed = book.getTotal() - book.getAvailable();
        copy(req, book);
        if (book.getTotal() != null && book.getTotal() < borrowed) {
            throw new ApiExceptionHandler.ApiException("馆藏数量不能小于已借出数量（已借出 " + borrowed + " 本）");
        }
        book.setAvailable(book.getTotal() - borrowed);
        return bookRepo.save(book);
    }

    @DeleteMapping("/books/{id}")
    public void deleteBook(@PathVariable Long id) {
        if (borrowRepo.countByBookIdAndReturnDateIsNull(id) > 0) {
            throw new ApiExceptionHandler.ApiException("该图书还有未归还的借阅记录，不能删除");
        }
        if (borrowRepo.countByBookId(id) > 0) {
            throw new ApiExceptionHandler.ApiException("该图书存在借阅历史，为保留数据不能删除");
        }
        bookRepo.deleteById(id);
    }

    @GetMapping("/categories")
    public List<Category> categories() {
        return categoryRepo.findAll().stream()
                .sorted(Comparator.comparing(Category::getId))
                .toList();
    }

    @PostMapping("/categories")
    public Category createCategory(@RequestBody Category req) {
        String name = req.getName() == null ? "" : req.getName().trim();
        if (name.isEmpty()) throw new ApiExceptionHandler.ApiException("分类名称不能为空");
        if (categoryRepo.existsByName(name)) throw new ApiExceptionHandler.ApiException("分类已存在");
        Category c = new Category();
        c.setName(name);
        c.setDescription(req.getDescription());
        return categoryRepo.save(c);
    }

    @PutMapping("/categories/{id}")
    public Category updateCategory(@PathVariable Long id, @RequestBody Category req) {
        Category c = categoryRepo.findById(id).orElseThrow(() -> new ApiExceptionHandler.ApiException("分类不存在"));
        String name = req.getName() == null ? "" : req.getName().trim();
        if (name.isEmpty()) throw new ApiExceptionHandler.ApiException("分类名称不能为空");
        if (!c.getName().equals(name) && categoryRepo.existsByName(name)) {
            throw new ApiExceptionHandler.ApiException("分类已存在");
        }
        c.setName(name);
        c.setDescription(req.getDescription());
        return categoryRepo.save(c);
    }

    @DeleteMapping("/categories/{id}")
    public void deleteCategory(@PathVariable Long id) {
        if (bookRepo.countByCategoryId(id) > 0) {
            throw new ApiExceptionHandler.ApiException("该分类下还有图书，不能删除");
        }
        categoryRepo.deleteById(id);
    }

    private void validateBook(Book req, Book current) {
        if (req.getTitle() == null || req.getTitle().trim().isEmpty()) {
            throw new ApiExceptionHandler.ApiException("书名不能为空");
        }
        if (req.getAuthor() == null || req.getAuthor().trim().isEmpty()) {
            throw new ApiExceptionHandler.ApiException("作者不能为空");
        }
    }

    private void copy(Book req, Book book) {
        book.setTitle(req.getTitle().trim());
        book.setAuthor(req.getAuthor().trim());
        book.setIsbn(req.getIsbn());
        book.setPublisher(req.getPublisher());
        book.setPublishYear(req.getPublishYear());
        book.setCategoryId(req.getCategoryId());
        book.setTotal(req.getTotal());
    }
}
