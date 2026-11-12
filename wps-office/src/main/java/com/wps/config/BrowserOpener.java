package com.wps.config;

import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.awt.Desktop;
import java.net.URI;

/** 桌面版双击启动后自动打开浏览器（仅当 -Dwps.openBrowser=true 时） */
@Component
public class BrowserOpener {

    @EventListener(ApplicationReadyEvent.class)
    public void open() {
        if (!Boolean.getBoolean("wps.openBrowser")) return;
        try {
            if (Desktop.isDesktopSupported()) {
                Desktop.getDesktop().browse(URI.create("http://127.0.0.1:8400/"));
            }
        } catch (Exception ignored) {
            // 打开失败不影响服务运行
        }
    }
}
