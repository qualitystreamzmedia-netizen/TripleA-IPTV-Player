package com.triplea.iptv

import android.annotation.SuppressLint
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import java.io.File

class MainActivity : AppCompatActivity() {
    private lateinit var root: FrameLayout
    private lateinit var webView: WebView
    private var server: LocalServer? = null
    private var customView: View? = null
    private var customCallback: WebChromeClient.CustomViewCallback? = null
    private var recovering = false
    private var crashCount = 0
    private var picture: PicturePlayer? = null
    private val stamp = "2.21"
    private var trialExpires = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        root = FrameLayout(this)
        setContentView(root)
        try {
            picture = PicturePlayer(this, root) { if (this::webView.isInitialized) webView else null }
        } catch (_: Throwable) {
            picture = null
        }
        val status = TextView(this).apply {
            text = "Opening TripleA…"
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            textSize = 18f
            setBackgroundColor(Color.parseColor("#10162A"))
        }
        root.addView(status, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        Thread {
            val trial = try {
                Trial.claim(this)
            } catch (_: Throwable) {
                Trial.Decision(true, "", 0)
            }
            if (!trial.allow) {
                runOnUiThread { status.text = trial.message }
                return@Thread
            }
            trialExpires = trial.expiresAt
            val dir = try {
                prepareWeb()
            } catch (error: Throwable) {
                runOnUiThread { status.text = error.message ?: "Could not open the player." }
                return@Thread
            }
            val http = LocalServer(dir, 8765)
            server = http
            http.start()
            val deadline = System.currentTimeMillis() + 8000
            while (!http.ready && System.currentTimeMillis() < deadline) {
                try {
                    Thread.sleep(30)
                } catch (_: InterruptedException) {
                    return@Thread
                }
            }
            if (!http.ready) {
                runOnUiThread { status.text = "Could not start the player." }
                return@Thread
            }
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                try {
                    clearServiceWorkers()
                    mount("http://127.0.0.1:${http.boundPort}/")
                    root.removeView(status)
                } catch (error: Throwable) {
                    status.text = error.message ?: "Could not open the player."
                }
            }
        }.start()
    }

    private fun emulator(): Boolean {
        val blob = listOf(
            Build.FINGERPRINT,
            Build.MODEL,
            Build.MANUFACTURER,
            Build.BRAND,
            Build.DEVICE,
            Build.PRODUCT,
            Build.HARDWARE,
            Build.BOARD,
            Build.HOST,
            Build.USER,
        ).joinToString(" ").lowercase()
        val hints = listOf(
            "memu", "microvirt", "genymotion", "goldfish", "ranchu", "vbox", "ttvm",
            "nox", "bluestack", "andy", "droid4x", "sdk_gphone", "emulator", "generic",
            "android_x86", "x86",
        )
        if (hints.any { blob.contains(it) }) return true
        val abi = Build.SUPPORTED_ABIS.joinToString(" ").lowercase()
        if (abi.contains("x86")) return true
        return File("/system/bin/memu").exists() ||
            File("/system/lib/libmemu.so").exists() ||
            File("/system/bin/microvirt-prop").exists()
    }

    private fun prepareWeb(): File {
        val dest = File(filesDir, "web")
        val marker = File(dest, ".stamp")
        if (marker.isFile && marker.readText() == stamp && File(dest, "index.html").isFile) return dest
        if (dest.exists()) dest.deleteRecursively()
        dest.mkdirs()
        copyAssets("web", dest)
        marker.writeText(stamp)
        return dest
    }

    private fun copyAssets(path: String, dest: File) {
        val children = assets.list(path) ?: emptyArray()
        if (children.isEmpty()) {
            val name = path.substringAfterLast('/')
            if (name.endsWith(".zip") || name.endsWith(".apk") || name.endsWith(".wasm") || name.endsWith(".mp4")) return
            dest.parentFile?.mkdirs()
            assets.open(path).use { input -> dest.outputStream().use { output -> input.copyTo(output) } }
            return
        }
        dest.mkdirs()
        for (child in children) {
            if (child.endsWith(".zip") || child.endsWith(".apk") || child.endsWith(".wasm") || child.endsWith(".mp4")) continue
            copyAssets("$path/$child", File(dest, child))
        }
    }

    private fun clearServiceWorkers() {
        val rootDir = filesDir.parentFile ?: return
        for (relative in arrayOf("app_webview/Service Worker", "app_webview/Default/Service Worker")) {
            val dir = File(rootDir, relative)
            if (dir.exists()) dir.deleteRecursively()
        }
    }

    private fun showReopen(port: Int) {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setBackgroundColor(Color.parseColor("#10162A"))
            setPadding(48, 48, 48, 48)
        }
        val label = TextView(this).apply {
            text = "That player closed the screen. Open TripleA again, stay on Web, then try TS, HLS, or VLC."
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            textSize = 18f
        }
        val button = Button(this).apply {
            text = "Open TripleA"
            setOnClickListener {
                crashCount = 0
                root.removeView(box)
                try {
                    mount("http://127.0.0.1:$port/?safe=1")
                } catch (error: Throwable) {
                    showMessage(error.message ?: "Could not open TripleA.")
                }
            }
        }
        box.addView(label, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))
        box.addView(button, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = 32
        })
        root.addView(box, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    }

    private fun showMessage(text: String) {
        val status = TextView(this).apply {
            this.text = text
            setTextColor(Color.WHITE)
            gravity = Gravity.CENTER
            textSize = 18f
            setBackgroundColor(Color.parseColor("#10162A"))
            setPadding(48, 48, 48, 48)
        }
        root.addView(status, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
    }

    @SuppressLint("SetJavaScriptEnabled", "AddJavascriptInterface")
    private fun mount(url: String) {
        webView = WebView(this)
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        picture?.bridge()?.let { webView.addJavascriptInterface(it, "TripleANative") }
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.textZoom = 100
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        }
        webView.setBackgroundColor(Color.parseColor("#10162A"))
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                if (customView != null) {
                    onHideCustomView()
                    return
                }
                customView = view
                customCallback = callback
                webView.visibility = View.GONE
                root.addView(view, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
            }

            override fun onHideCustomView() {
                val view = customView ?: return
                root.removeView(view)
                customView = null
                customCallback?.onCustomViewHidden()
                customCallback = null
                webView.visibility = View.VISIBLE
                webView.requestFocus()
            }
        }
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, finished: String) {
                view.evaluateJavascript(
                    "(function(){var m=document.querySelector('meta[name=\"viewport\"]');if(!m){m=document.createElement('meta');m.setAttribute('name','viewport');document.head.appendChild(m);}m.setAttribute('content','width=device-width, initial-scale=1');})();",
                    null,
                )
                view.postDelayed({ crashCount = 0 }, 8000)
                if (trialExpires > 0) {
                    view.evaluateJavascript("window.__tripleaTrial={expiresAt:${trialExpires}}", null)
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val host = request.url.host ?: return true
                return host != "127.0.0.1" && host != "localhost"
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && request.isForMainFrame) {
                    view.loadData("<p style='color:#fff;background:#10162A;font-family:sans-serif'>Could not open TripleA.</p>", "text/html", "utf-8")
                }
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                if (!this@MainActivity::webView.isInitialized || view !== webView) return true
                if (recovering) return true
                recovering = true
                crashCount += 1
                val dead = webView
                try {
                    root.removeView(dead)
                } catch (_: Throwable) {
                }
                try {
                    dead.destroy()
                } catch (_: Throwable) {
                }
                val port = server?.boundPort ?: 8765
                root.postDelayed({
                    recovering = false
                    if (isFinishing) return@postDelayed
                    if (crashCount >= 3) {
                        showReopen(port)
                        return@postDelayed
                    }
                    try {
                        mount("http://127.0.0.1:$port/?safe=1")
                    } catch (_: Throwable) {
                        showReopen(port)
                    }
                }, 600)
                return true
            }
        }
        root.addView(webView, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))
        webView.requestFocus()
        webView.loadUrl(url)
    }

    override fun onResume() {
        super.onResume()
        if (this::webView.isInitialized) {
            webView.onResume()
            webView.requestFocus()
        }
    }

    override fun onPause() {
        if (this::webView.isInitialized) webView.onPause()
        super.onPause()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (this::webView.isInitialized && remoteKey(event.keyCode) == "Enter") {
            if ((event.action == KeyEvent.ACTION_DOWN || event.action == KeyEvent.ACTION_UP) && event.repeatCount == 0) {
                webView.post {
                    if (!this::webView.isInitialized) return@post
                    webView.evaluateJavascript("window.tripleaRemote&&window.tripleaRemote('Enter')", null)
                }
            }
            return true
        }
        return super.dispatchKeyEvent(event)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK || keyCode == KeyEvent.KEYCODE_ESCAPE) {
            if (customView != null) {
                webView.webChromeClient?.onHideCustomView()
                return true
            }
            if (this::webView.isInitialized) {
                webView.evaluateJavascript(
                    "(function(){try{return !!(window.tripleaBack&&window.tripleaBack());}catch(e){return false;}})()",
                ) { result ->
                    if (result != "true") runOnUiThread { if (!isFinishing) finish() }
                }
                return true
            }
        }
        val name = remoteKey(keyCode)
        if (name != null && this::webView.isInitialized) {
            val fromPage = name.startsWith("Arrow") || name == "Enter"
            if (!(fromPage && webView.hasFocus())) {
                webView.evaluateJavascript("window.tripleaRemote&&window.tripleaRemote('$name')", null)
                return true
            }
        }
        return super.onKeyDown(keyCode, event)
    }

    private fun remoteKey(keyCode: Int): String? {
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> "ArrowUp"
            KeyEvent.KEYCODE_DPAD_DOWN -> "ArrowDown"
            KeyEvent.KEYCODE_DPAD_LEFT -> "ArrowLeft"
            KeyEvent.KEYCODE_DPAD_RIGHT -> "ArrowRight"
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_NUMPAD_ENTER, KeyEvent.KEYCODE_SPACE, KeyEvent.KEYCODE_BUTTON_A, KeyEvent.KEYCODE_BUTTON_SELECT -> "Enter"
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, KeyEvent.KEYCODE_MEDIA_PLAY, KeyEvent.KEYCODE_MEDIA_PAUSE -> "MediaPlayPause"
            KeyEvent.KEYCODE_CHANNEL_UP, KeyEvent.KEYCODE_PAGE_UP -> "ChannelUp"
            KeyEvent.KEYCODE_CHANNEL_DOWN, KeyEvent.KEYCODE_PAGE_DOWN -> "ChannelDown"
            KeyEvent.KEYCODE_MEDIA_NEXT, KeyEvent.KEYCODE_MEDIA_FAST_FORWARD -> "MediaTrackNext"
            KeyEvent.KEYCODE_MEDIA_PREVIOUS, KeyEvent.KEYCODE_MEDIA_REWIND -> "MediaTrackPrevious"
            KeyEvent.KEYCODE_GUIDE -> "Guide"
            else -> null
        }
    }

    override fun onDestroy() {
        picture?.release()
        server?.shutdown()
        if (this::webView.isInitialized) {
            root.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }
}
