package expo.modules.zoggyfinshare

import android.content.Intent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Text that another app shares to Zoggyfin (Intent.ACTION_SEND with
 * text/plain, for example a video link). The app's intent filter is in
 * app.json. JS reads the text of the start intent once, and gets an
 * "onShare" event for a share while the app runs.
 */
class ZoggyfinShareModule : Module() {
  private var consumed: Intent? = null

  private fun sharedText(intent: Intent?): String? {
    if (intent == null || intent.action != Intent.ACTION_SEND) return null
    if (intent.type?.startsWith("text/") != true) return null
    val text = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return null
    return text.take(4000)
  }

  override fun definition() = ModuleDefinition {
    Name("ZoggyfinShare")

    Events("onShare")

    // The text of the intent that started the app, once.
    Function("takeInitialShare") {
      val intent = appContext.currentActivity?.intent
      if (intent == null || intent === consumed) return@Function null
      consumed = intent
      sharedText(intent)
    }

    OnNewIntent { intent ->
      val text = sharedText(intent) ?: return@OnNewIntent
      consumed = intent
      sendEvent("onShare", mapOf("text" to text))
    }
  }
}
