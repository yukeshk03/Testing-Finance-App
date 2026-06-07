package com.financetracker.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.telephony.SmsMessage;
import android.util.Log;

public class SmsReceiver extends BroadcastReceiver {

    private static final String TAG = "FinanceTracker.SMS";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!android.provider.Telephony.Sms.Intents.SMS_RECEIVED_ACTION.equals(intent.getAction())) {
            return;
        }

        Bundle bundle = intent.getExtras();
        if (bundle == null) return;

        Object[] pdus = (Object[]) bundle.get("pdus");
        String format = bundle.getString("format");
        if (pdus == null) return;

        StringBuilder fullMessage = new StringBuilder();
        String sender = "";

        for (Object pdu : pdus) {
            SmsMessage sms;
            // Use non-deprecated method for Android 6+
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && format != null) {
                sms = SmsMessage.createFromPdu((byte[]) pdu, format);
            } else {
                sms = SmsMessage.createFromPdu((byte[]) pdu);
            }
            if (sms == null) continue;
            sender = sms.getDisplayOriginatingAddress();
            fullMessage.append(sms.getMessageBody());
        }

        String body = fullMessage.toString().trim();
        if (body.isEmpty()) return;

        Log.d(TAG, "SMS from: " + sender + " | " + body.substring(0, Math.min(60, body.length())));

        if (TransactionParser.isBankMessage(sender, body)) {
            Log.d(TAG, "Bank SMS detected — parsing...");
            TransactionParser.parseAndNotify(context, sender, body);
        }
    }
}
