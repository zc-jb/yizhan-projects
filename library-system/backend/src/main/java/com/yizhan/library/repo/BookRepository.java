package com.yizhan.library.repo;

import com.yizhan.library.entity.Book;
import org.springframework.data.jpa.repository.JpaRepository;

public interface BookRepository extends JpaRepository<Book, Long> {
    long countByCategoryId(Long categoryId);
}
