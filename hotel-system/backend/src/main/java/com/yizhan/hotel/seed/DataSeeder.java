package com.yizhan.hotel.seed;

import com.yizhan.hotel.entity.Guest;
import com.yizhan.hotel.entity.Room;
import com.yizhan.hotel.entity.RoomType;
import com.yizhan.hotel.entity.User;
import com.yizhan.hotel.repo.GuestRepository;
import com.yizhan.hotel.repo.RoomRepository;
import com.yizhan.hotel.repo.RoomTypeRepository;
import com.yizhan.hotel.repo.UserRepository;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;

import java.math.BigDecimal;

@Component
public class DataSeeder implements CommandLineRunner {
    private final UserRepository userRepo;
    private final RoomTypeRepository typeRepo;
    private final RoomRepository roomRepo;
    private final GuestRepository guestRepo;
    private final PasswordEncoder encoder;

    public DataSeeder(UserRepository userRepo, RoomTypeRepository typeRepo, RoomRepository roomRepo,
                      GuestRepository guestRepo, PasswordEncoder encoder) {
        this.userRepo = userRepo;
        this.typeRepo = typeRepo;
        this.roomRepo = roomRepo;
        this.guestRepo = guestRepo;
        this.encoder = encoder;
    }

    @Override
    public void run(String... args) {
        if (userRepo.count() == 0) {
            userRepo.save(user("admin", "系统管理员", "ADMIN"));
            userRepo.save(user("reception", "前台小陈", "RECEPTION"));
        }

        if (typeRepo.count() == 0) {
            typeRepo.save(type("标准间", "199", 2, "1.5m 双床", "经济舒适，适合短期住宿"));
            typeRepo.save(type("双人间", "259", 2, "1.8m 大床", "空间更大，含双早"));
            typeRepo.save(type("豪华间", "399", 3, "2m 大床 + 沙发", "高层景观房，配置齐全"));
            typeRepo.save(type("行政套房", "699", 4, "2m 大床 + 客厅", "独立客厅与卫浴，尊享体验"));
        }

        if (roomRepo.count() == 0) {
            createRooms();
        }

        if (guestRepo.count() == 0) {
            guestRepo.save(guest("张伟", "13800138001", "110101199001011234", "男", "常客，偏好高层"));
            guestRepo.save(guest("李娜", "13900139002", "110101199202022345", "女", "对早餐有要求"));
            guestRepo.save(guest("王强", "13700137003", "110101198803033456", "男", "商务出行"));
            guestRepo.save(guest("刘洋", "13500135004", "110101199504044567", "男", "首次入住"));
            guestRepo.save(guest("陈静", "13600136005", "110101199605055678", "女", "需要安静房间"));
            guestRepo.save(guest("赵磊", "13300133006", "110101199706066789", "男", "家庭出游"));
        }
    }

    private User user(String username, String name, String role) {
        User u = new User();
        u.setUsername(username);
        u.setName(name);
        u.setRole(role);
        u.setPassword(encoder.encode("123456"));
        return u;
    }

    private RoomType type(String name, String price, int capacity, String bedType, String desc) {
        RoomType t = new RoomType();
        t.setName(name);
        t.setPrice(new BigDecimal(price));
        t.setCapacity(capacity);
        t.setBedType(bedType);
        t.setDescription(desc);
        return t;
    }

    private Guest guest(String name, String phone, String idCard, String gender, String remark) {
        Guest g = new Guest();
        g.setName(name);
        g.setPhone(phone);
        g.setIdCard(idCard);
        g.setGender(gender);
        g.setRemark(remark);
        return g;
    }

    private void createRooms() {
        long standard = typeRepo.findAll().get(0).getId();
        long doubleRoom = typeRepo.findAll().get(1).getId();
        long luxury = typeRepo.findAll().get(2).getId();
        long suite = typeRepo.findAll().get(3).getId();

        for (int i = 1; i <= 5; i++) room("10" + i, 1, standard);
        for (int i = 1; i <= 5; i++) room("20" + i, 2, doubleRoom);
        for (int i = 1; i <= 3; i++) room("30" + i, 3, luxury);
        for (int i = 1; i <= 2; i++) room("40" + i, 4, suite);
    }

    private void room(String no, int floor, long typeId) {
        Room r = new Room();
        r.setNo(no);
        r.setFloor(floor);
        r.setTypeId(typeId);
        r.setStatus("IDLE");
        roomRepo.save(r);
    }
}
