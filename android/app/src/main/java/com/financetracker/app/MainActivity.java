package com.financetracker.app;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

import org.json.JSONArray;

/**
 * Main Activity — extends Capacitor's BridgeActivity so the React app runs inside.
 *
 * Key responsibilities:
 *  1. Inject a JavaScript bridge ("AndroidBridge") into the WebView so the React
 *     app can read pending SMS records stored by SmsReceiver / NotificationListener.
 *  2. When opened via notification tap (Intent extra "openTab"="sms"), post a
 *     message to the React app telling it to navigate to the SMS Inbox tab.
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG       = "FinanceTracker.Main";
    private static final String PREFS_NAME = "FinanceTrackerPrefs";
    private static final String PREFS_KEY  = "ft_pending_sms";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setupJsBridge();
        handleNotificationTap(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleNotificationTap(intent);
    }

    // ── JavaScript bridge ─────────────────────────────────────────────────
    private void setupJsBridge() {
        WebView webView = getBridge().getWebView();
        webView.addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
        Log.d(TAG, "JS bridge registered");
    }

    /**
     * Called by the React app on startup and after each confirm/skip action.
     * Returns a JSON array of pending SMS records, then clears the queue.
     */
    public class AndroidBridge {

        @JavascriptInterface
        public String getPendingSms() {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
            String json = prefs.getString(PREFS_KEY, "[]");
            // Clear after reading so records aren't duplicated on next load
            prefs.edit().putString(PREFS_KEY, "[]").apply();
            Log.d(TAG, "getPendingSms returned: " + json.substring(0, Math.min(120, json.length())));
            return json;
        }

        @JavascriptInterface
        public void markSmsProcessed(String smsId) {
            // Future: mark specific record processed without clearing all
            Log.d(TAG, "markSmsProcessed: " + smsId);
        }

        @JavascriptInterface
        public boolean isAndroidApp() {
            return true;
        }
    }

    // ── Handle notification tap ───────────────────────────────────────────
    private void handleNotificationTap(Intent intent) {
        if (intent == null) return;
        String openTab = intent.getStringExtra("openTab");
        String smsId   = intent.getStringExtra("smsId");
        if ("sms".equals(openTab)) {
            Log.d(TAG, "Opened via notification — navigating to SMS tab, smsId=" + smsId);
            // Post to React after WebView is ready (slight delay)
            getBridge().getWebView().postDelayed(() -> {
                String js = "window.__openSmsTab && window.__openSmsTab('" + (smsId != null ? smsId : "") + "');";
                getBridge().getWebView().evaluateJavascript(js, null);
            }, 800);
        }
    }
}
