package com.triplea.iptv

import android.content.ContentUris
import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import org.json.JSONObject
import java.io.File
import java.util.UUID

object Trial {
    private const val DAYS = 3L
    private const val NAME = "triplea-iptv-install.json"
    private const val TRIAL_MS = DAYS * 24 * 60 * 60 * 1000

    class Decision(val allow: Boolean, val message: String, val expiresAt: Long)

    fun claim(context: Context): Decision {
        val localFile = File(context.filesDir, "trial.json")
        val machineText = readMachine(context)
        val localText = readFile(localFile)
        val now = System.currentTimeMillis()
        if (machineText == null && localText == null) {
            val record = JSONObject()
            record.put("id", UUID.randomUUID().toString())
            record.put("startedAt", now)
            record.put("seenAt", now)
            val text = record.toString()
            writeMachine(context, text)
            writeFile(localFile, text)
            return Decision(true, "", now + TRIAL_MS)
        }
        if (machineText == null && localText != null) {
            writeMachine(context, localText)
            return decide(JSONObject(localText), JSONObject(localText), localFile, context, now)
        }
        val machine = JSONObject(machineText)
        val local = if (localText == null) null else JSONObject(localText)
        return decide(machine, local, localFile, context, now)
    }

    private fun decide(machine: JSONObject, local: JSONObject?, localFile: File, context: Context, now: Long): Decision {
        val machineId = machine.optString("id")
        if (local == null || local.optString("id") != machineId || machineId.isEmpty()) {
            return Decision(false, "TripleA was already installed on this device. The trial cannot be installed again.", 0)
        }
        val seenAt = machine.optLong("seenAt", now)
        if (now + 60_000 < seenAt) {
            return Decision(false, "The 3-day TripleA trial on this device has ended.", 0)
        }
        val startedAt = machine.optLong("startedAt", now)
        machine.put("seenAt", now)
        val text = machine.toString()
        writeMachine(context, text)
        writeFile(localFile, text)
        val expiresAt = startedAt + TRIAL_MS
        if (now >= expiresAt) {
            return Decision(false, "The 3-day TripleA trial on this device has ended.", expiresAt)
        }
        return Decision(true, "", expiresAt)
    }

    private fun legacyFile(): File {
        val root = Environment.getExternalStorageDirectory()
        return File(File(root, ".triplea"), "install.json")
    }

    private fun readMachine(context: Context): String? {
        readFile(legacyFile())?.let { return it }
        return readMedia(context)
    }

    private fun writeMachine(context: Context, text: String) {
        try {
            writeFile(legacyFile(), text)
        } catch (_: Exception) {
        }
        try {
            writeMedia(context, text)
        } catch (_: Exception) {
        }
    }

    private fun readFile(file: File): String? {
        return try {
            if (!file.isFile) null else file.readText()
        } catch (_: Exception) {
            null
        }
    }

    private fun writeFile(file: File, text: String) {
        val parent = file.parentFile
        if (parent != null && !parent.exists()) parent.mkdirs()
        file.writeText(text)
    }

    private fun readMedia(context: Context): String? {
        if (Build.VERSION.SDK_INT < 29) return null
        val collection = MediaStore.Files.getContentUri("external")
        val projection = arrayOf(MediaStore.MediaColumns._ID)
        val selection = "${MediaStore.MediaColumns.DISPLAY_NAME}=?"
        context.contentResolver.query(collection, projection, selection, arrayOf(NAME), null)?.use { cursor ->
            if (!cursor.moveToFirst()) return null
            val uri = ContentUris.withAppendedId(collection, cursor.getLong(0))
            context.contentResolver.openInputStream(uri)?.use { input ->
                return input.readBytes().toString(Charsets.UTF_8)
            }
        }
        return null
    }

    private fun writeMedia(context: Context, text: String) {
        if (Build.VERSION.SDK_INT < 29) return
        val existing = readMedia(context)
        if (existing != null) {
            val collection = MediaStore.Files.getContentUri("external")
            val projection = arrayOf(MediaStore.MediaColumns._ID)
            val selection = "${MediaStore.MediaColumns.DISPLAY_NAME}=?"
            context.contentResolver.query(collection, projection, selection, arrayOf(NAME), null)?.use { cursor ->
                if (!cursor.moveToFirst()) return
                val uri = ContentUris.withAppendedId(collection, cursor.getLong(0))
                context.contentResolver.openOutputStream(uri, "wt")?.use { it.write(text.toByteArray()) }
            }
            return
        }
        val values = ContentValues()
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, NAME)
        values.put(MediaStore.MediaColumns.MIME_TYPE, "application/json")
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOCUMENTS)
        val uri = context.contentResolver.insert(MediaStore.Files.getContentUri("external"), values) ?: return
        context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) }
    }
}
