package com.halloweenwhammy.game;

import android.app.Activity;
import android.annotation.SuppressLint;
import android.os.Build;
import android.os.Bundle;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import java.io.ByteArrayInputStream;

/** A small offline shell; the game and artwork ship inside the APK. */
public class MainActivity extends Activity {
    private static final String GAME_URL = "https://app.halloweenwhammy.local/index.html";
    private WebView webView;
    private Esp32Bluetooth bluetooth;
    private boolean reloadOnResume;

    @Override
    @SuppressLint("SetJavaScriptEnabled") // Only packaged, CSP-restricted assets can load.
    public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        webView.setBackgroundColor(0xFF140923);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        webView.addJavascriptInterface(new Haptics(), "AndroidHaptics");
        bluetooth = new Esp32Bluetooth(this, webView);
        webView.addJavascriptInterface(bluetooth, "AndroidBluetooth");
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                bluetooth.sync();
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true; // The game never navigates away or opens external content.
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                // Serve only bundled assets from a private HTTPS origin, with no network permission.
                android.net.Uri uri = request.getUrl();
                if ("https".equals(uri.getScheme()) && "app.halloweenwhammy.local".equals(uri.getHost())) {
                    String file = uri.getPath().substring(1);
                    if (file.isEmpty()) file = "index.html";
                    if (file.matches("[a-zA-Z0-9_-]+\\.(html|css|js|jpg|mp3)")) {
                        String mime = file.endsWith(".html") ? "text/html"
                            : file.endsWith(".css") ? "text/css"
                            : file.endsWith(".js") ? "application/javascript"
                            : file.endsWith(".mp3") ? "audio/mpeg" : "image/jpeg";
                        try {
                            return new WebResourceResponse(mime, "UTF-8", getAssets().open(file));
                        } catch (java.io.IOException ignored) { }
                    }
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    java.util.Collections.emptyMap(), new ByteArrayInputStream(new byte[0]));
            }
        });
        FrameLayout root = new FrameLayout(this);
        root.addView(webView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        hideSystemBars();
        webView.loadUrl(GAME_URL);
    }

    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams attributes = getWindow().getAttributes();
            attributes.layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attributes);
        }
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(
                    WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }

    private class Haptics {
        @JavascriptInterface
        public void pulse(boolean whammy) {
            Vibrator vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                vibrator.vibrate(VibrationEffect.createOneShot(whammy ? 180 : 45,
                    VibrationEffect.DEFAULT_AMPLITUDE));
            }
        }
    }

    @Override
    protected void onPause() {
        bluetooth.setForeground(false);
        webView.evaluateJavascript("window.pauseGame && window.pauseGame()", null);
        webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        hideSystemBars();
        if (webView != null) {
            bluetooth.setForeground(true);
            webView.onResume();
            if (reloadOnResume) {
                reloadOnResume = false;
                webView.loadUrl(GAME_URL);
            }
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    @Override
    protected void onStop() {
        bluetooth.disconnect();
        reloadOnResume = true;
        super.onStop();
    }

    @Override
    protected void onDestroy() {
        bluetooth.destroy();
        webView.removeJavascriptInterface("AndroidBluetooth");
        webView.removeJavascriptInterface("AndroidHaptics");
        webView.destroy();
        super.onDestroy();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        bluetooth.onPermissionsResult(requestCode);
    }
}
