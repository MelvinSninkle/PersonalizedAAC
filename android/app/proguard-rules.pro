# Keep the JS bridge — reflection from WebView needs the method names intact.
-keepclassmembers class io.andrewpeterson.myworld.SpeechBridge {
    @android.webkit.JavascriptInterface <methods>;
}
