package com.cinemax.tv;

import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebChromeClient;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private JSInterface jsInterface = new JSInterface();

    public class JSInterface {
        public boolean isModalActive = false;

        @JavascriptInterface
        public void setModalActive(boolean active) {
            this.isModalActive = active;
        }

        /**
         * Simulates a real native Android touch tap at the exact center of the WebView.
         * This bypasses cross-origin iframe security restrictions because Chromium
         * receives it as a genuine hardware touch event.
         */
        @JavascriptInterface
        public void simulateNativeClick() {
            if (bridge != null && bridge.getWebView() != null) {
                final WebView webView = bridge.getWebView();
                webView.post(new Runnable() {
                    @Override
                    public void run() {
                        int x = webView.getWidth() / 2;
                        int y = webView.getHeight() / 2;
                        long downTime = SystemClock.uptimeMillis();
                        long eventTime = SystemClock.uptimeMillis();

                        MotionEvent downEvent = MotionEvent.obtain(downTime, eventTime, MotionEvent.ACTION_DOWN, x, y, 0);
                        MotionEvent upEvent = MotionEvent.obtain(downTime, eventTime + 80, MotionEvent.ACTION_UP, x, y, 0);

                        webView.dispatchTouchEvent(downEvent);
                        webView.dispatchTouchEvent(upEvent);

                        downEvent.recycle();
                        upEvent.recycle();
                    }
                });
            }
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Access the WebView and configure settings after bridge is initialized
        if (this.bridge != null) {
            WebView webView = this.bridge.getWebView();
            if (webView != null) {
                webView.post(new Runnable() {
                    @Override
                    public void run() {
                        // Register Javascript interface
                        webView.addJavascriptInterface(jsInterface, "AndroidBridge");

                        // WebView Settings
                        webView.getSettings().setSupportMultipleWindows(true);
                        webView.getSettings().setJavaScriptCanOpenWindowsAutomatically(false);
                        webView.getSettings().setMediaPlaybackRequiresUserGesture(false);

                        // Block popups and ad window opening
                        webView.setWebChromeClient(new WebChromeClient() {
                            @Override
                            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, android.os.Message resultMsg) {
                                // Block all ad popup window requests
                                return false;
                            }
                        });
                    }
                });
            }
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int keyCode = event.getKeyCode();
        int action = event.getAction();

        if (action == KeyEvent.ACTION_DOWN) {
            String keyString = null;
            switch (keyCode) {
                case KeyEvent.KEYCODE_DPAD_UP:
                    keyString = "ArrowUp";
                    break;
                case KeyEvent.KEYCODE_DPAD_DOWN:
                    keyString = "ArrowDown";
                    break;
                case KeyEvent.KEYCODE_DPAD_LEFT:
                    keyString = "ArrowLeft";
                    break;
                case KeyEvent.KEYCODE_DPAD_RIGHT:
                    keyString = "ArrowRight";
                    break;
                case KeyEvent.KEYCODE_DPAD_CENTER:
                case KeyEvent.KEYCODE_ENTER:
                    keyString = "Enter";
                    break;
                case KeyEvent.KEYCODE_BACK:
                    keyString = "Escape";
                    break;
            }

            if (keyString != null) {
                WebView webView = this.bridge != null ? this.bridge.getWebView() : null;
                if (webView != null) {
                    final String js = "window.dispatchEvent(new KeyboardEvent('keydown', { 'key': '" + keyString + "', 'bubbles': true }));";
                    webView.post(new Runnable() {
                        @Override
                        public void run() {
                            webView.evaluateJavascript(js, null);
                        }
                    });
                }

                // Handle Back button interception
                if (keyCode == KeyEvent.KEYCODE_BACK) {
                    if (jsInterface.isModalActive) {
                        return true;
                    }
                } else {
                    // Always consume D-Pad navigation keys
                    return true;
                }
            }
        }

        return super.dispatchKeyEvent(event);
    }
}
