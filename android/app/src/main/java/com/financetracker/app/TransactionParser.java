package com.financetracker.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.core.app.NotificationCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses bank SMS / notification text.
 * Extracts: amount, type (credit/debit), merchant, bank name.
 * Saves to SharedPreferences so the WebView (React app) can read it.
 * Fires a local notification so the user can tap to open the SMS Inbox.
 */
public class TransactionParser {

    private static final String TAG          = "FinanceTracker.Parser";
    private static final String CHANNEL_ID   = "ft_transactions";
    private static final String PREFS_KEY    = "ft_pending_sms";
    private static final String PREFS_NAME   = "FinanceTrackerPrefs";

    // ── Bank sender keywords ──────────────────────────────────────────────
    private static final String[] BANK_KEYWORDS = {
        "hdfc", "sbi", "icici", "axis", "kotak", "paytm", "phonepe",
        "googlepay", "gpay", "upi", "neft", "imps", "credited", "debited",
        "txn", "transaction", "a/c", "acct", "bank", "rs.", "inr",
        "rupees", "withdraw", "deposit", "transfer", "payment", "spent",
        "sent", "received", "alert", "credit", "debit", "mandate",
        "rapido", "ola", "uber", "zomato", "swiggy", "amazon", "flipkart"
    };

    // ── Amount patterns ───────────────────────────────────────────────────
    // Matches: Rs.3000.00 | Rs 3,000 | INR 3000 | ₹3000 | 3000.00 Rs
    private static final Pattern AMOUNT_PATTERN = Pattern.compile(
        "(?:Rs\\.?|INR|\\u20B9)\\s*([\\d,]+(?:\\.\\d{1,2})?)" +
        "|([\\d,]+(?:\\.\\d{2})?)\\s*(?:Rs\\.?|INR|\\u20B9)",
        Pattern.CASE_INSENSITIVE
    );

    // ── Credit / Debit detection ──────────────────────────────────────────
    private static final Pattern CREDIT_PATTERN = Pattern.compile(
        "\\b(credit|credited|received|refund|cashback|deposited|reversed|added)\\b",
        Pattern.CASE_INSENSITIVE
    );

    // ── Merchant extraction ───────────────────────────────────────────────
    // "To Rapido", "at Ravi Store", "from VPA 9585@axl For <Desc>"
    private static final Pattern MERCHANT_TO   = Pattern.compile("\\bTo\\s+([A-Za-z0-9 &'\\-]+?)(?:\\s+On|\\s+Ref|\\s+UPI|\\s*$)", Pattern.CASE_INSENSITIVE);
    private static final Pattern MERCHANT_AT   = Pattern.compile("\\bat\\s+([A-Za-z0-9 &'\\-]+?)(?:\\s+on|\\s+Rs|,|\\s*$)", Pattern.CASE_INSENSITIVE);
    private static final Pattern MERCHANT_FOR  = Pattern.compile("\\bFor\\s+([A-Za-z0-9 &'\\-]+?)(?:\\s*$|\\s+Ref)", Pattern.CASE_INSENSITIVE);

    // ── Bank name ─────────────────────────────────────────────────────────
    private static final Pattern BANK_PATTERN  = Pattern.compile(
        "\\b(HDFC|SBI|ICICI|Axis|Kotak|YES|PNB|BOI|BOB|Canara|Union|IndusInd|Federal|IDBI|RBL)\\s*Bank\\b",
        Pattern.CASE_INSENSITIVE
    );

    // ── Date ──────────────────────────────────────────────────────────────
    private static final Pattern DATE_PATTERN  = Pattern.compile(
        "(\\d{2}[-/]\\d{2}[-/]\\d{2,4})"
    );

    // ─────────────────────────────────────────────────────────────────────
    // PUBLIC ENTRY POINTS
    // ─────────────────────────────────────────────────────────────────────

    /** Returns true if sender/body looks like a bank/UPI message */
    public static boolean isBankMessage(String sender, String body) {
        String combined = (sender + " " + body).toLowerCase(Locale.ROOT);
        for (String kw : BANK_KEYWORDS) {
            if (combined.contains(kw)) return true;
        }
        return false;
    }

    /** Parse the SMS text, save to SharedPreferences, fire notification */
    public static void parseAndNotify(Context ctx, String sender, String body) {
        try {
            // ── Parse amount ──────────────────────────────────────────
            double amount = 0;
            Matcher amtM = AMOUNT_PATTERN.matcher(body);
            if (amtM.find()) {
                String raw = amtM.group(1) != null ? amtM.group(1) : amtM.group(2);
                if (raw != null) amount = Double.parseDouble(raw.replace(",", ""));
            }
            if (amount <= 0) {
                Log.d(TAG, "No amount found — skipping");
                return;
            }

            // ── Credit or Debit ───────────────────────────────────────
            boolean isCredit = CREDIT_PATTERN.matcher(body).find();
            String txType = isCredit ? "income" : "expense";

            // ── Merchant ──────────────────────────────────────────────
            String merchant = "Unknown";
            Matcher mTo  = MERCHANT_TO.matcher(body);
            Matcher mAt  = MERCHANT_AT.matcher(body);
            Matcher mFor = MERCHANT_FOR.matcher(body);
            if (mTo.find())       merchant = mTo.group(1).trim();
            else if (mAt.find())  merchant = mAt.group(1).trim();
            else if (mFor.find()) merchant = mFor.group(1).trim();

            // ── Bank name ─────────────────────────────────────────────
            String bankName = "Bank";
            Matcher bm = BANK_PATTERN.matcher(body);
            if (bm.find()) bankName = bm.group(0).trim();

            // ── Date ──────────────────────────────────────────────────
            String date = new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date());
            Matcher dm = DATE_PATTERN.matcher(body);
            if (dm.find()) {
                // Keep raw date from SMS for display; React app parses it
                date = dm.group(1);
            }

            // ── Category heuristic ────────────────────────────────────
            String cat = isCredit ? "Income" : inferCategory(body);

            // ── Build JSON record ─────────────────────────────────────
            String smsId = "sms-" + UUID.randomUUID().toString().substring(0, 8);
            JSONObject record = new JSONObject();
            record.put("id",            smsId);
            record.put("sender",        sender);
            record.put("text",          body);
            record.put("timestamp",     new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.ROOT).format(new Date()));
            record.put("status",        "pending");
            record.put("parsedAmount",  amount);
            record.put("parsedType",    txType);
            record.put("parsedMerchant", merchant);
            record.put("parsedBank",    bankName);
            record.put("parsedDate",    date);
            record.put("parsedCategory", cat);

            Log.d(TAG, "Parsed: " + amount + " " + txType + " from " + merchant);

            // ── Save to SharedPreferences (React reads this) ──────────
            saveToPrefs(ctx, record);

            // ── Fire local notification ───────────────────────────────
            fireNotification(ctx, smsId, amount, merchant, txType);

        } catch (Exception e) {
            Log.e(TAG, "Parse error: " + e.getMessage());
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // PRIVATE HELPERS
    // ─────────────────────────────────────────────────────────────────────

    private static String inferCategory(String body) {
        String low = body.toLowerCase(Locale.ROOT);
        if (low.matches(".*\\b(rapido|uber|ola|auto|metro|bus|train|yulu|bounce|bike)\\b.*")) return "Transport";
        if (low.matches(".*\\b(zomato|swiggy|food|restaurant|cafe|eat|kfc|mcdonald|pizza|dominos)\\b.*")) return "Food & Beverages";
        if (low.matches(".*\\b(amazon|flipkart|meesho|myntra|ajio|nykaa|mart)\\b.*")) return "Grocery & Essentials";
        if (low.matches(".*\\b(netflix|hotstar|prime|spotify|movie|cinema|pvr|inox)\\b.*")) return "Movie/Outing";
        if (low.matches(".*\\b(doctor|hospital|pharmacy|med|clinic|apollo|health)\\b.*")) return "Health";
        if (low.matches(".*\\b(rent|electricity|water|gas|jio|airtel|bill|recharge|utility)\\b.*")) return "Rent & Utilities";
        if (low.matches(".*\\b(salary|stipend|payroll)\\b.*")) return "Income";
        return "Grocery & Essentials";
    }

    private static void saveToPrefs(Context ctx, JSONObject record) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String existing = prefs.getString(PREFS_KEY, "[]");
            JSONArray arr = new JSONArray(existing);
            arr.put(record);
            prefs.edit().putString(PREFS_KEY, arr.toString()).apply();
            Log.d(TAG, "Saved to prefs. Total pending: " + arr.length());
        } catch (Exception e) {
            Log.e(TAG, "saveToPrefs error: " + e.getMessage());
        }
    }

    private static void fireNotification(Context ctx, String smsId, double amount, String merchant, String txType) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm == null) return;

            // Create channel (Android 8+)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID,
                    "Finance Tracker Transactions",
                    NotificationManager.IMPORTANCE_HIGH
                );
                ch.setDescription("Bank SMS and UPI transaction alerts");
                ch.enableVibration(true);
                nm.createNotificationChannel(ch);
            }

            // Tap intent → open app at SMS tab
            Intent openIntent = new Intent(ctx, MainActivity.class);
            openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            openIntent.putExtra("openTab", "sms");
            openIntent.putExtra("smsId", smsId);
            PendingIntent pi = PendingIntent.getActivity(
                ctx, smsId.hashCode(), openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            String sign  = txType.equals("income") ? "+" : "-";
            String title = "New Transaction Detected";
            String body  = sign + "Rs." + String.format(Locale.ROOT, "%.0f", amount)
                           + "  |  " + merchant + "\nTap to categorize and save.";

            NotificationCompat.Builder nb = new NotificationCompat.Builder(ctx, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(sign + "Rs." + String.format(Locale.ROOT, "%.0f", amount) + " — " + merchant)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .setVibrate(new long[]{0, 250, 100, 250});

            nm.notify(smsId.hashCode(), nb.build());
            Log.d(TAG, "Notification fired for smsId: " + smsId);

        } catch (Exception e) {
            Log.e(TAG, "fireNotification error: " + e.getMessage());
        }
    }
}
