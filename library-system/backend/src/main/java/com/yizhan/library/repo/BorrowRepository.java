package com.yizhan.library.repo;

import com.yizhan.library.entity.Borrow;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface BorrowRepository extends JpaRepository<Borrow, Long> {
    List<Borrow> findAllByOrderByIdDesc();
    long countByReturnDateIsNull();
    long countByReturnDateIsNullAndDueDateBefore(LocalDate date);
    long countByBookIdAndReturnDateIsNull(Long bookId);
    long countByReaderIdAndReturnDateIsNull(Long readerId);
    long countByBookId(Long bookId);
    long countByReaderId(Long readerId);
}
