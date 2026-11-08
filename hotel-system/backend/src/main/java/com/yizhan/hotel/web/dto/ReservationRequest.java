package com.yizhan.hotel.web.dto;

import java.time.LocalDate;

public record ReservationRequest(Long guestId, Long roomId, LocalDate checkInDate, LocalDate checkOutDate, String remark) {}
