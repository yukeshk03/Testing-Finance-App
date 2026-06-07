package com.financetracker.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Restarts the NotificationListenerService after device reboot.
 * This keeps SMS detection working even after the phone is restarted.
 */
public class BootReceiver extends BroadcastReceiver {

    private static final String TAG = "FinanceTracker.Boot";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) ||
            "android.intent.action.QUICKBOOT_POWERON".equals(action)) {
            Log.d(TAG, "Boot completed — listener will reconnect automatically");
            // NotificationListenerService reconnects automatically via onListenerDisconnected
            // No explicit restart needed for Android 8+
        }
    }
}
