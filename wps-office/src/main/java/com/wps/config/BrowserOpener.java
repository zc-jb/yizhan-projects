package com.wps.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.awt.Desktop;
import java.net.URI;

/** 双击启动后自动打开浏览器（仅当 -Dwps.openBrowser=true 时，桌面绿色版默认开启） */
@Component
public class BrowserOpener {

    private static final Logger log = LoggerFactory.getLogger(BrowserOpener.class);
    private static final String URL = "http://127.0.0.1:8400/";

    @EventListener(ApplicationReadyEvent.class)
    public void open() {
        if (!Boolean.getBoolean("wps.openBrowser")) return;
        Thread t = new Thread(this::doOpen, "open-browser");
        t.setDaemon(true);
        t.start();
    }

    private void doOpen() {
        try {
            Thread.sleep(600);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
        if (tryDesktop()) return;
        if (tryRundll()) return;
        tryCmdStart();
    }

    private boolean tryDesktop() {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(URI.create(URL));
                log.info("已自动打开浏览器：{}", URL);
                return true;
            }
        } catch (Exception e) {
            log.debug("Desktop 打开浏览器失败：{}", e.getMessage());
        }
        return false;
    }

    private boolean tryRundll() {
        try {
            new ProcessBuilder("rundll32", "url.dll,FileProtocolHandler", URL).start();
            log.info("已通过系统默认浏览器打开：{}", URL);
            return true;
        } catch (Exception e) {
            log.debug("rundll32 打开浏览器失败：{}", e.getMessage());
            return false;
        }
    }

    private void tryCmdStart() {
        try {
            new ProcessBuilder("cmd", "/c", "start", "", URL).start();
            log.info("已通过 cmd start 打开：{}", URL);
        } catch (Exception e) {
            log.warn("未能自动打开浏览器，请手动访问 {}", URL);
        }
    }
}
