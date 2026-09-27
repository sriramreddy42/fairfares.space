package com.fairfares.mobile

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import java.net.HttpURLConnection
import java.net.URL
import kotlin.math.max
import org.json.JSONObject

/**
 * Chitthi is delivered as a data-only FCM message on Android. Firebase otherwise
 * renders a remote image as a BigPicture notification while the app is
 * backgrounded, which is appropriate for a photo post but not for a letter.
 */
class FairFaresFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val chitthiData = extractChitthiData(remoteMessage)
    if (chitthiData != null) {
      showChitthiNotification(remoteMessage, chitthiData)
      return
    }
    super.onMessageReceived(remoteMessage)
  }

  /**
   * Expo's FCM transport puts our application data in a JSON `body` value.
   * Direct FCM sends use the map as-is, so support both transports.
   */
  private fun extractChitthiData(remoteMessage: RemoteMessage): Map<String, String>? {
    val directData = remoteMessage.data
    if (directData["notificationRenderer"] == "chitthi-v1") return directData
    val encodedBody = directData["body"] ?: return null
    return try {
      val body = JSONObject(encodedBody)
      if (body.optString("notificationRenderer") != "chitthi-v1") return null
      val parsed = mutableMapOf<String, String>()
      val keys = body.keys()
      while (keys.hasNext()) {
        val key = keys.next()
        parsed[key] = body.opt(key)?.toString().orEmpty()
      }
      parsed
    } catch (_: Exception) {
      null
    }
  }

  private fun showChitthiNotification(remoteMessage: RemoteMessage, data: Map<String, String>) {
    val senderName = data["senderName"].orEmpty().ifBlank {
      data["notificationTitle"].orEmpty().ifBlank { "FairFares member" }
    }
    val conversationName = data["conversationName"].orEmpty().trim()
    val isGroup = data["isGroup"].equals("true", ignoreCase = true) || conversationName.isNotBlank()
    val letter = data["notificationBody"].orEmpty().ifBlank { "New Chitthi letter" }
    val conversationId = data["conversationId"].orEmpty()
    val messageId = data["messageId"].orEmpty()
    val channelId = data["notificationChannelId"].orEmpty().ifBlank { CHITTHI_CHANNEL_ID }
    ensureChannel(channelId)

    val identityName = if (isGroup) conversationName.ifBlank { "Chitthi group" } else senderName
    val avatar = downloadAvatar(data["notificationImage"].orEmpty()) ?: initialsAvatar(identityName)
    // Match the native messaging treatment people recognize from iOS: keep
    // the sender as the main photo and place the actual FairFares app mark on
    // its lower edge. The small notification icon is intentionally
    // monochrome on Android, so this badge is where the full-color mark is
    // visible in a Chitthi alert.
    val avatarWithAppBadge = avatar?.let(::addFairFaresBadge)
    val sender = Person.Builder().setName(senderName)
      .apply { data["senderId"]?.takeIf { it.isNotBlank() }?.let { setKey("fairfares-user-$it") } }
      .apply { avatarWithAppBadge?.let { setIcon(IconCompat.createWithBitmap(it)) } }
      .build()
    val style = NotificationCompat.MessagingStyle(
      Person.Builder().setName("You").setKey("fairfares-current-user").build()
    )
      .setGroupConversation(isGroup)
      .addMessage(letter, remoteMessage.sentTime.takeIf { it > 0 } ?: System.currentTimeMillis(), sender)
    if (isGroup) style.setConversationTitle(conversationName.ifBlank { "Chitthi group" })

    val route = Uri.Builder()
      .scheme("fairfares")
      .authority("chitthi")
      .appendQueryParameter("conversationId", conversationId)
      .appendQueryParameter("messageId", messageId)
      .build()
    val intent = Intent(this, MainActivity::class.java).apply {
      action = Intent.ACTION_VIEW
      this.data = route
      flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
    }
    val requestCode = max(1, conversationId.hashCode())
    val tapIntent = PendingIntent.getActivity(
      this,
      requestCode,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notification = NotificationCompat.Builder(this, channelId)
      // Android notification small icons must be a transparent, monochrome
      // drawable. Using the adaptive launcher icon made Android crop it into
      // the blue ring seen in the notification shade.
      .setSmallIcon(R.drawable.notification_fairfares_road)
      .setColor(ContextCompat.getColor(this, R.color.notification_icon_color))
      .setContentTitle(senderName)
      .setContentText(letter)
      .setStyle(style)
      .setCategory(NotificationCompat.CATEGORY_MESSAGE)
      .setLargeIcon(avatarWithAppBadge)
      .setContentIntent(tapIntent)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .build()

    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU ||
      ActivityCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
    ) {
      NotificationManagerCompat.from(this).notify("chitthi:$conversationId", requestCode, notification)
    }
  }

  private fun ensureChannel(channelId: String) {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val channel = NotificationChannel(
      channelId,
      "Chitthi messages",
      NotificationManager.IMPORTANCE_HIGH,
    ).apply {
      description = "New Chitthi letters and replies"
      enableVibration(true)
    }
    (getSystemService(NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(channel)
  }

  private fun downloadAvatar(url: String): Bitmap? {
    if (!url.startsWith("https://")) return null
    return try {
      val connection = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 4_000
        readTimeout = 4_000
        instanceFollowRedirects = true
      }
      connection.inputStream.use { stream ->
        BitmapFactory.decodeStream(stream)?.let { bitmap ->
          Bitmap.createScaledBitmap(bitmap, 192, 192, true).also {
            if (it !== bitmap) bitmap.recycle()
          }
        }
      }.also { connection.disconnect() }
    } catch (_: Exception) {
      null
    }
  }

  private fun initialsAvatar(name: String): Bitmap? {
    val initials = name.trim().split(Regex("\\s+"))
      .filter { it.isNotBlank() }
      .take(2)
      .mapNotNull { word -> word.firstOrNull { it.isLetterOrDigit() }?.uppercaseChar() }
      .joinToString("")
      .ifBlank { return null }
    val size = 192
    return Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888).also { bitmap ->
      val canvas = Canvas(bitmap)
      canvas.drawColor(Color.rgb(26, 64, 140))
      val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = Color.WHITE
        textAlign = Paint.Align.CENTER
        textSize = 70f
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
      }
      val baseline = size / 2f - (paint.ascent() + paint.descent()) / 2f
      canvas.drawText(initials, size / 2f, baseline, paint)
    }
  }

  private fun addFairFaresBadge(source: Bitmap): Bitmap {
    val size = 192
    val output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(output)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    val photo = if (source.width == size && source.height == size) source else Bitmap.createScaledBitmap(source, size, size, true)
    val photoPath = android.graphics.Path().apply { addCircle(size / 2f, size / 2f, size / 2f, android.graphics.Path.Direction.CW) }
    canvas.save()
    canvas.clipPath(photoPath)
    canvas.drawBitmap(photo, 0f, 0f, paint)
    canvas.restore()
    if (photo !== source) photo.recycle()

    val badgeRadius = 36f
    val centerX = size - badgeRadius - 2f
    val centerY = size - badgeRadius - 2f
    // The launcher is an adaptive drawable, which cannot be decoded through
    // BitmapFactory in Firebase's background service. Draw it directly so we
    // use the existing full-color app mark without shipping a duplicate PNG.
    val mark = ContextCompat.getDrawable(this, R.mipmap.ic_launcher) ?: return output
    paint.color = Color.WHITE
    canvas.drawCircle(centerX, centerY, badgeRadius + 3f, paint)
    val badgePath = android.graphics.Path().apply { addCircle(centerX, centerY, badgeRadius, android.graphics.Path.Direction.CW) }
    canvas.save()
    canvas.clipPath(badgePath)
    mark.setBounds(
      (centerX - badgeRadius).toInt(),
      (centerY - badgeRadius).toInt(),
      (centerX + badgeRadius).toInt(),
      (centerY + badgeRadius).toInt(),
    )
    mark.draw(canvas)
    canvas.restore()
    return output
  }

  private companion object {
    const val CHITTHI_CHANNEL_ID = "chitthi-messages-v2"
  }
}
