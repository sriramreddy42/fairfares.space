package com.fairfares.mobile

import androidx.appcompat.app.AppCompatDelegate
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil

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
    }
  }
}
