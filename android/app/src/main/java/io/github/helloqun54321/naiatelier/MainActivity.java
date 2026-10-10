package io.github.helloqun54321.naiatelier;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.webkit.WebView;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle state) {
        registerPlugin(AtelierPlugin.class);
        super.onCreate(state);
    }
    /** 后台生成由 WebView 里的任务循环推进；前台服务保活期间显式恢复可能被暂停的调度。 */
    void keepWebViewScheduling() {
        if (!AtelierTaskService.hasGenerationTasks()) return;
        WebView view = getBridge().getWebView();
        if (view != null) view.resumeTimers();
    }
    @Override public void onPause() { super.onPause(); keepWebViewScheduling(); }
    @Override public void onStop() { super.onStop(); keepWebViewScheduling(); }
}
