package com.triplea.iptv

import java.io.ByteArrayInputStream
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URI
import java.net.URL
import java.net.URLDecoder
import java.util.concurrent.Executors

class LocalServer(private val root: File, private val port: Int) : Thread("triplea-http") {
    @Volatile var ready = false
    @Volatile var boundPort = 0
    private val pool = Executors.newFixedThreadPool(12)
    private var socket: ServerSocket? = null

    override fun run() {
        var server: ServerSocket? = null
        for (candidate in port until port + 8) {
            try {
                server = ServerSocket(candidate, 32, InetAddress.getByName("127.0.0.1"))
                boundPort = candidate
                break
            } catch (_: Exception) {
            }
        }
        if (server == null) return
        socket = server
        ready = true
        while (!isInterrupted) {
            val client = try {
                server.accept()
            } catch (_: Exception) {
                break
            }
            pool.execute {
                try {
                    handle(client)
                } catch (_: Exception) {
                    try {
                        client.close()
                    } catch (_: Exception) {
                    }
                }
            }
        }
    }

    fun shutdown() {
        interrupt()
        try {
            socket?.close()
        } catch (_: Exception) {
        }
        pool.shutdownNow()
    }

    private fun handle(client: Socket) {
        client.use { socket ->
            socket.soTimeout = 60_000
            val input = socket.getInputStream()
            val output = socket.getOutputStream()
            val head = readHeaders(input) ?: return
            val request = head.lineSequence().firstOrNull() ?: return
            val parts = request.split(" ")
            if (parts.size < 2) return
            val method = parts[0]
            val target = parts[1]
            val headers = parseHeaders(head)
            if (method == "OPTIONS") {
                val allow = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: *\r\nAccess-Control-Max-Age: 86400\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                output.write(allow.toByteArray())
                output.flush()
                return
            }
            if (method != "GET" && method != "HEAD") {
                writeStatus(output, 405, "text/plain", "Method not allowed".toByteArray(), null, null)
                return
            }
            val path = target.substringBefore("?")
            if (path == "/api/media" || path.startsWith("/api/media/")) {
                proxy(target, headers["range"], method == "HEAD", output)
                return
            }
            serveFile(path, method == "HEAD", output)
        }
    }

    private fun serveFile(path: String, head: Boolean, output: OutputStream) {
        val relative = if (path == "/") "index.html" else path.trimStart('/')
        val file = File(root, relative)
        val safe = file.canonicalFile
        if (!safe.path.startsWith(root.canonicalPath) || !safe.isFile) {
            val index = File(root, "index.html")
            if (index.isFile && !relative.contains('.')) {
                writeFile(index, "text/html", head, output)
            } else {
                writeStatus(output, 404, "text/plain", "Not found".toByteArray(), null, null)
            }
            return
        }
        writeFile(safe, mime(safe.name), head, output)
    }

    private fun writeFile(file: File, type: String, head: Boolean, output: OutputStream) {
        val length = file.length()
        val header = "HTTP/1.1 200 OK\r\nContent-Type: $type\r\nContent-Length: $length\r\n" +
            "Cache-Control: no-cache\r\nConnection: close\r\n\r\n"
        output.write(header.toByteArray())
        if (head) {
            output.flush()
            return
        }
        file.inputStream().use { input ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                output.write(buffer, 0, read)
            }
        }
        output.flush()
    }

    private fun proxy(target: String, range: String?, head: Boolean, output: OutputStream) {
        val query = target.substringAfter("?", "")
        val raw = queryValue(query, "url")
        val vlc = queryValue(query, "engine") == "vlc"
        if (raw.isNullOrBlank()) {
            writeStatus(output, 400, "text/plain", "Missing url.".toByteArray(), null, null)
            return
        }
        var pulled: Pulled? = null
        try {
            pulled = pull(raw, range, 0)
            val type = pulled.type
            val playlist = type.contains("mpegurl", true) || type.contains("m3u8", true) || pulled.address.substringBefore("?").endsWith(".m3u8", true)
            if (playlist) {
                val text = pulled.body.toString(Charsets.UTF_8)
                val rewritten = rewritePlaylist(text, pulled.address, vlc)
                writeStatus(
                    output,
                    pulled.code,
                    if (type.isBlank()) "application/vnd.apple.mpegurl" else type,
                    if (head) ByteArray(0) else rewritten.toByteArray(),
                    pulled.range,
                    pulled.acceptRanges,
                )
            } else if (head) {
                writeStatus(output, pulled.code, type.ifBlank { "application/octet-stream" }, ByteArray(0), pulled.range, pulled.acceptRanges)
            } else {
                val streamed = if (
                    pulled.address.substringBefore("?").endsWith(".ts", true) ||
                    type.contains("mp2t", true) ||
                    type.contains("mpegts", true)
                ) {
                    "video/mp2t"
                } else {
                    type
                }
                val advertised = if (range.isNullOrBlank()) -1L else pulled.length
                streamStatus(output, pulled.code, streamed, advertised, pulled.range, pulled.acceptRanges, pulled.stream)
            }
        } catch (error: Exception) {
            val message = error.message ?: "Could not fetch that address."
            writeStatus(output, 400, "text/plain", message.toByteArray(), null, null)
        } finally {
            try {
                pulled?.connection?.disconnect()
            } catch (_: Exception) {
            }
        }
    }

    private data class Pulled(
        val code: Int,
        val type: String,
        val length: Long,
        val address: String,
        val body: ByteArray,
        val stream: InputStream?,
        val range: String?,
        val acceptRanges: String?,
        val connection: HttpURLConnection?,
    )

    private fun pull(raw: String, range: String?, hops: Int): Pulled {
        if (hops > 3) throw IllegalStateException("Too many redirects.")
        val url = publicUrl(raw)
        val connection = (url.openConnection() as HttpURLConnection).apply {
            connectTimeout = 20_000
            readTimeout = 0
            instanceFollowRedirects = false
            setRequestProperty("User-Agent", "VLC/3.0.20 LibVLC/3.0.20")
            setRequestProperty("Accept", "*/*")
            if (!range.isNullOrBlank()) setRequestProperty("Range", range)
        }
        val code = connection.responseCode
        if (code in 300..399) {
            val location = connection.getHeaderField("Location")
            connection.disconnect()
            if (location.isNullOrBlank()) throw IllegalStateException("The server redirected without a location.")
            return pull(URL(url, location).toString(), range, hops + 1)
        }
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val type = connection.contentType ?: ""
        val lengthHeader = connection.getHeaderField("Content-Length")
        val length = lengthHeader?.toLongOrNull() ?: -1L
        val address = connection.url.toString()
        val contentRange = connection.getHeaderField("Content-Range")
        val acceptRanges = connection.getHeaderField("Accept-Ranges")
        val playlist = type.contains("mpegurl", true) || type.contains("m3u8", true) || address.substringBefore("?").endsWith(".m3u8", true)
        val guide = type.contains("xml", true) || address.contains("xmltv", true) || address.substringBefore("?").endsWith(".xml", true)
        if (playlist || guide || code !in 200..299) {
            val bytes = readLimited(stream, if (guide) 14 * 1024 * 1024 else 32 * 1024 * 1024)
            connection.disconnect()
            if (code !in 200..299) throw IllegalStateException("The server answered $code.")
            return Pulled(code, type, bytes.size.toLong(), address, bytes, null, contentRange, acceptRanges, null)
        }
        return Pulled(code, type, length, address, ByteArray(0), stream ?: ByteArrayInputStream(ByteArray(0)), contentRange, acceptRanges, connection)
    }

    private fun readLimited(stream: InputStream?, max: Int): ByteArray {
        if (stream == null) return ByteArray(0)
        val buffer = ByteArray(16 * 1024)
        val out = java.io.ByteArrayOutputStream()
        var left = max
        while (left > 0) {
            val read = stream.read(buffer, 0, minOf(buffer.size, left))
            if (read < 0) break
            out.write(buffer, 0, read)
            left -= read
        }
        return out.toByteArray()
    }

    private fun publicUrl(raw: String): URL {
        if (raw.length > 12000) throw IllegalStateException("URL is too long.")
        val url = try {
            URL(raw)
        } catch (_: Exception) {
            throw IllegalStateException("That address is not a valid URL.")
        }
        val protocol = url.protocol.lowercase()
        if (protocol != "http" && protocol != "https") throw IllegalStateException("Only http and https addresses are allowed.")
        if (blockedHost(url.host)) throw IllegalStateException("That address is not allowed.")
        return url
    }

    private fun blockedHost(hostname: String): Boolean {
        val host = hostname.lowercase().removePrefix("[").removeSuffix("]")
        if (
            host == "localhost" ||
            host.endsWith(".localhost") ||
            host.endsWith(".local") ||
            host == "0.0.0.0" ||
            host == "::" ||
            host == "::1" ||
            host == "metadata.google.internal"
        ) {
            return true
        }
        val parts = host.split(".")
        if (parts.size == 4 && parts.all { it.all { ch -> ch.isDigit() } }) {
            val nums = parts.map { it.toIntOrNull() ?: return true }
            if (nums.any { it > 255 }) return true
            val a = nums[0]
            val b = nums[1]
            if (a == 10 || a == 127 || a == 0) return true
            if (a == 169 && b == 254) return true
            if (a == 172 && b in 16..31) return true
            if (a == 192 && b == 168) return true
            if (a == 100 && b in 64..127) return true
            return false
        }
        if (host.contains(":")) {
            val head = host.split(":").firstOrNull { it.isNotEmpty() } ?: ""
            if (head.startsWith("fc") || head.startsWith("fd") || head.startsWith("fe80")) return true
        }
        return false
    }

    private fun rewritePlaylist(text: String, base: String, proxy: Boolean): String {
        return text.lineSequence().joinToString("\n") { line ->
            val trimmed = line.trim()
            if (trimmed.isEmpty()) line
            else if (trimmed.startsWith("#")) {
                line.replace(Regex("URI=\"([^\"]+)\"", RegexOption.IGNORE_CASE)) { match ->
                    "URI=\"${wrap(match.groupValues[1], base, proxy)}\""
                }
            } else wrap(trimmed, base, proxy)
        }
    }

    private fun wrap(value: String, base: String, proxy: Boolean): String {
        val absolute = try {
            URI(base).resolve(value).toString()
        } catch (_: Exception) {
            value
        }
        val engine = if (proxy) "&engine=vlc" else ""
        return "http://127.0.0.1:$boundPort/api/media?url=${java.net.URLEncoder.encode(absolute, "UTF-8")}$engine"
    }

    private fun queryValue(query: String, key: String): String? {
        for (part in query.split("&")) {
            val name = part.substringBefore("=")
            if (URLDecoder.decode(name, "UTF-8") == key) {
                return URLDecoder.decode(part.substringAfter("=", ""), "UTF-8")
            }
        }
        return null
    }

    private fun readHeaders(input: InputStream): String? {
        val builder = StringBuilder()
        val one = ByteArray(1)
        while (builder.length < 64_000) {
            val count = input.read(one)
            if (count < 0) break
            builder.append(one[0].toInt().toChar())
            if (builder.endsWith("\r\n\r\n")) return builder.toString()
        }
        return null
    }

    private fun parseHeaders(head: String): Map<String, String> {
        val map = HashMap<String, String>()
        head.lineSequence().drop(1).forEach { line ->
            val index = line.indexOf(":")
            if (index > 0) map[line.substring(0, index).trim().lowercase()] = line.substring(index + 1).trim()
        }
        return map
    }

    private fun extraHeaders(range: String?, acceptRanges: String?): String {
        val rangeLine = if (range.isNullOrBlank()) "" else "Content-Range: $range\r\n"
        val acceptLine = if (acceptRanges.isNullOrBlank()) "" else "Accept-Ranges: $acceptRanges\r\n"
        return rangeLine + acceptLine
    }

    private fun reason(code: Int): String {
        return when (code) {
            200 -> "OK"
            204 -> "No Content"
            206 -> "Partial Content"
            404 -> "Not Found"
            405 -> "Method Not Allowed"
            else -> "Error"
        }
    }

    private fun writeStatus(output: OutputStream, code: Int, type: String, body: ByteArray, range: String?, acceptRanges: String?) {
        val header = "HTTP/1.1 $code ${reason(code)}\r\nContent-Type: $type\r\nContent-Length: ${body.size}\r\n" +
            extraHeaders(range, acceptRanges) +
            "Access-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        output.write(header.toByteArray())
        if (body.isNotEmpty()) output.write(body)
        output.flush()
    }

    private fun streamStatus(output: OutputStream, code: Int, type: String, length: Long, range: String?, acceptRanges: String?, stream: InputStream?) {
        val size = if (length >= 0) "Content-Length: $length\r\n" else ""
        val header = "HTTP/1.1 $code ${reason(code)}\r\nContent-Type: ${type.ifBlank { "application/octet-stream" }}\r\n$size" +
            extraHeaders(range, acceptRanges) +
            "Access-Control-Allow-Origin: *\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
        output.write(header.toByteArray())
        stream?.use { input -> input.copyTo(output) }
        output.flush()
    }

    private fun mime(name: String): String {
        val lower = name.lowercase()
        return when {
            lower.endsWith(".html") -> "text/html"
            lower.endsWith(".js") || lower.endsWith(".mjs") -> "text/javascript"
            lower.endsWith(".css") -> "text/css"
            lower.endsWith(".json") -> "application/json"
            lower.endsWith(".wasm") -> "application/wasm"
            lower.endsWith(".png") -> "image/png"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".svg") -> "image/svg+xml"
            lower.endsWith(".woff2") -> "font/woff2"
            lower.endsWith(".ttf") -> "font/ttf"
            lower.endsWith(".mp4") -> "video/mp4"
            else -> "application/octet-stream"
        }
    }
}
