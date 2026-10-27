package com.triplea.iptv

import android.view.TextureView
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.appcompat.app.AppCompatActivity
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import kotlin.math.max
import kotlin.math.min

@OptIn(UnstableApi::class)
class PicturePlayer(
    private val activity: AppCompatActivity,
    private val root: FrameLayout,
    private val web: () -> WebView?,
) {
    private val texture = TextureView(activity)
    private var player: ExoPlayer? = null
    private var direct = ""
    private var proxied = ""
    private var mode = "live"
    private var usedProxy = false
    private var tries = 0
    private val bridge = Bridge()

    init {
        texture.isClickable = true
        texture.visibility = View.GONE
        texture.setOnClickListener {
            web()?.evaluateJavascript("window.__tripleaNativeToggle&&window.__tripleaNativeToggle()", null)
        }
        root.addView(texture, FrameLayout.LayoutParams(1, 1))
    }

    fun bridge(): Bridge = bridge

    fun release() {
        try {
            player?.release()
        } catch (_: Throwable) {
        }
        player = null
        texture.visibility = View.GONE
    }

    private fun signal(state: String) {
        val view = web() ?: return
        view.post {
            view.evaluateJavascript("window.__tripleaNative&&window.__tripleaNative('$state')", null)
        }
    }

    private fun ensure() {
        if (player != null) return
        val source = DefaultHttpDataSource.Factory()
            .setUserAgent("VLC/3.0.20 LibVLC/3.0.20")
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(20_000)
            .setReadTimeoutMs(30_000)
        val created = ExoPlayer.Builder(activity)
            .setMediaSourceFactory(DefaultMediaSourceFactory(source))
            .build()
        created.setVideoTextureView(texture)
        created.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) signal("playing")
                if (state == Player.STATE_ENDED) {
                    if (mode != "vod" && tries < 1) {
                        tries += 1
                        try {
                            created.seekToDefaultPosition()
                            created.prepare()
                            created.play()
                        } catch (_: Throwable) {
                            signal("web")
                        }
                    } else {
                        signal("ended")
                    }
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                if (!usedProxy && proxied.isNotBlank() && proxied != direct) {
                    usedProxy = true
                    try {
                        play(proxied)
                    } catch (_: Throwable) {
                        signal("web")
                    }
                    return
                }
                if (tries < 1) {
                    tries += 1
                    try {
                        created.prepare()
                        created.play()
                    } catch (_: Throwable) {
                        signal("web")
                    }
                    return
                }
                signal("error")
            }
        })
        player = created
    }

    private fun mimeFor(url: String, kind: String): String? {
        if (kind == "hls") return MimeTypes.APPLICATION_M3U8
        if (kind == "ts") return MimeTypes.VIDEO_MP2T
        if (kind == "vlc") return null
        val lower = url.lowercase()
        return when {
            ".m3u8" in lower -> MimeTypes.APPLICATION_M3U8
            ".mpd" in lower -> MimeTypes.APPLICATION_MPD
            ".mp4" in lower || ".m4v" in lower -> MimeTypes.VIDEO_MP4
            ".webm" in lower -> MimeTypes.VIDEO_WEBM
            ".ts" in lower -> MimeTypes.VIDEO_MP2T
            else -> null
        }
    }

    private fun play(url: String) {
        val current = player ?: return
        val item = MediaItem.Builder().setUri(url)
        mimeFor(url, mode)?.let { item.setMimeType(it) }
        current.repeatMode = Player.REPEAT_MODE_OFF
        current.setMediaItem(item.build())
        current.prepare()
        current.playWhenReady = true
    }

    private fun show() {
        texture.bringToFront()
        texture.visibility = View.VISIBLE
    }

    inner class Bridge {
        @JavascriptInterface
        fun open(nextDirect: String, nextProxy: String, nextMode: String) {
            activity.runOnUiThread {
                try {
                    direct = nextDirect
                    proxied = nextProxy
                    mode = nextMode
                    usedProxy = false
                    tries = 0
                    ensure()
                    show()
                    play(nextDirect.ifBlank { nextProxy })
                } catch (_: Throwable) {
                    texture.visibility = View.GONE
                    signal("web")
                }
            }
        }

        @JavascriptInterface
        fun place(left: Double, top: Double, width: Double, height: Double, cssW: Double, cssH: Double) {
            activity.runOnUiThread {
                val view = web() ?: return@runOnUiThread
                val sx = if (cssW > 0) view.width / cssW else 1.0
                val sy = if (cssH > 0) view.height / cssH else 1.0
                val widthPx = max(1, (width * sx).toInt())
                val heightPx = max(1, (height * sy).toInt())
                val leftPx = (left * sx).toInt().coerceIn(0, max(0, view.width - 1))
                val topPx = (top * sy).toInt().coerceIn(0, max(0, view.height - 1))
                val params = FrameLayout.LayoutParams(
                    min(widthPx, max(1, view.width - leftPx)),
                    min(heightPx, max(1, view.height - topPx)),
                )
                params.leftMargin = leftPx
                params.topMargin = topPx
                texture.layoutParams = params
                if (width > 2 && height > 2) show()
            }
        }

        @JavascriptInterface
        fun volume(value: Double) {
            activity.runOnUiThread {
                player?.volume = (value / 100.0).toFloat().coerceIn(0f, 1f)
            }
        }

        @JavascriptInterface
        fun play() {
            activity.runOnUiThread {
                try {
                    player?.play()
                } catch (_: Throwable) {
                }
            }
        }

        @JavascriptInterface
        fun pause() {
            activity.runOnUiThread {
                try {
                    player?.pause()
                } catch (_: Throwable) {
                }
            }
        }

        @JavascriptInterface
        fun close() {
            activity.runOnUiThread {
                try {
                    player?.stop()
                    player?.clearMediaItems()
                } catch (_: Throwable) {
                }
                direct = ""
                texture.visibility = View.GONE
            }
        }
    }
}
