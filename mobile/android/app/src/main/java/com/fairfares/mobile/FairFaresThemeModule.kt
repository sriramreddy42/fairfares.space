package com.fairfares.mobile

import androidx.appcompat.app.AppCompatDelegate
import android.content.res.Configuration
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.modules.core.DeviceEventManagerModule

class FairFaresThemeModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName() = "FairFaresTheme"

  @ReactMethod
  fun setMode(mode: String) {
    val nightMode = when (mode) {
      "light" -> AppCompatDelegate.MODE_NIGHT_NO
      "dark" -> AppCompatDelegate.MODE_NIGHT_YES
      else -> AppCompatDelegate.MODE_NIGHT_FOLLOW_SYSTEM
    }
    UiThreadUtil.runOnUiThread {
      if (AppCompatDelegate.getDefaultNightMode() != nightMode) {
        AppCompatDelegate.setDefaultNightMode(nightMode)
        // MainActivity handles uiMode as a configuration change. Recreating it
        // here invalidates Expo ActivityResult launchers that may already be
        // registered for the photo picker, camera, documents, or contacts.
        // FairFares surfaces react to the selected appearance in JavaScript,
        // so no Activity restart is required.
      }
      // AppCompat can update the resources without emitting React Native's
      // appearance event when uiMode is handled as a configuration change.
      // Without this event, screens using useColorScheme can retain dark text
      // colours while the account selector says Light (or the reverse).
      val colorScheme = when (mode) {
        "light" -> "light"
        "dark" -> "dark"
        else -> if (
          reactContext.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK ==
          Configuration.UI_MODE_NIGHT_YES
        ) "dark" else "light"
      }
      val payload = Arguments.createMap().apply { putString("colorScheme", colorScheme) }
      reactContext
        .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("appearanceChanged", payload)
    }
  }
}
