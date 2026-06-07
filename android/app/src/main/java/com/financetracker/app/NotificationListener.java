package com.financetracker.app;

import android.app.Notification;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.util.Log;

public class NotificationListener extends NotificationListenerService {

    private static final String TAG = "FinanceTracker.NL";

    private static final String[] WATCHED_PACKAGES = {
        "com.snapwork.hdfc",
        "com.mobikwik_new",
        "net.one97.paytm",
        "com.google.android.apps.nbu.paisa.user",
        "com.phonepe.app",
        "com.icici.iMobile",
        "com.csam.icici.bank.imobile",
        "com.sbi.lotusintouch",
        "com.axis.mobile",
        "com.kotak.mahindra.kotak",
        "com.indusind.bank",
        "com.android.mms",
        "com.google.android.apps.messaging",
    };

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null) return;

        String pkg = sbn.getPackageName();

        boolean isWatched = false;
        for (String watchedPkg : WATCHED_PACKAGES) {
            if (watchedPkg.equals(pkg)) { isWatched = true; break; }
        }

        if (!isWatched) {
            try {
                String defaultSmsApp = android.provider.Telephony.Sms.getDefaultSmsPackage(this);
                if (pkg.equals(defaultSmsApp)) isWatched = true;
            } catch (Exception e) {
                Log.d(TAG, "Could not get default SMS app: " + e.getMessage());
            }
        }

        if (!isWatched) return;

        Notification notif = sbn.getNotification();
        if (notif == null) return;

        Bundle extras = notif.extras;
        if (extras == null) return;

        String title = extras.getString(Notification.EXTRA_TITLE, "");
        CharSequence textSeq = extras.getCharSequence(Notification.EXTRA_TEXT);
        String body = textSeq != null ? textSeq.toString() : "";

        CharSequence bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT);
        if (bigText != null && bigText.length() > body.length()) {
            body = bigText.toString();
        }

        String fullText = (title + " " + body).trim();
        Log.d(TAG, "Notification from " + pkg + ": " + fullText.substring(0, Math.min(80, fullText.length())));

        if (TransactionParser.isBankMessage(pkg, fullText)) {
            Log.d(TAG, "Bank notification detected — parsing...");
            TransactionParser.parseAndNotify(this, pkg, fullText);
        }
    }

    @Override
    public void onNotificationRemoved(StatusBarNotification sbn) {}

    @Override
    public void onListenerConnected() {
        Log.d(TAG, "NotificationListenerService connected");
    }

    @Override
    public void onListenerDisconnected() {
        Log.d(TAG, "NotificationListenerService disconnected");
        // Request rebind using static method (works on all Android versions)
        try {
            ComponentName cn = new ComponentName(this, NotificationListener.class);
            NotificationListenerService.requestRebind(cn);
        } catch (Exception e) {
            Log.e(TAG, "requestRebind failed: " + e.getMessage());
        }
    }
}
