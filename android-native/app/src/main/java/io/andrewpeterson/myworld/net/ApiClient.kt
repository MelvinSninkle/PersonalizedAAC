package io.andrewpeterson.myworld.net

import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * The Android twin of kid-ios `Network/APIClient.swift` — a thin typed wrapper
 * over OkHttp against the same origin. Auth is the `mw_session` cookie carried
 * by [PersistentCookieJar]; a 401 anywhere surfaces as [ApiError.NotAuthenticated]
 * so AuthManager can flip the app to signed-out globally.
 */
class ApiClient(
    val cookieJar: PersistentCookieJar,
    private val onUnauthorized: () -> Unit = {},
) {
    companion object {
        const val ORIGIN = "https://aac.andrewpeterson.io"
        val json = Json {
            ignoreUnknownKeys = true
            explicitNulls = false
            encodeDefaults = false
            coerceInputValues = true
        }
        private val JSON_TYPE = "application/json".toMediaType()
        private val JPEG_TYPE = "image/jpeg".toMediaType()
    }

    val http: OkHttpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)      // image generation can be slow
        .writeTimeout(120, TimeUnit.SECONDS)
        .build()

    /** Long-timeout client for generate-image style calls (iOS uses 320s). */
    val httpLong: OkHttpClient = http.newBuilder()
        .readTimeout(320, TimeUnit.SECONDS)
        .build()

    sealed class ApiError(message: String) : Exception(message) {
        class BadStatus(val code: Int, val body: String) :
            ApiError("Server error $code: ${body.take(200)}")
        class NotAuthenticated : ApiError("Not signed in")
        class Transport(cause: Throwable) : ApiError("Network problem: ${cause.message}")
        class Decoding(cause: Throwable) : ApiError("Unexpected server reply: ${cause.message}")
    }

    fun esc(s: String): String = URLEncoder.encode(s, "UTF-8")

    // ── Core plumbing ────────────────────────────────────────────────────────

    private suspend fun OkHttpClient.await(request: Request): Response =
        suspendCancellableCoroutine { cont ->
            val call = newCall(request)
            cont.invokeOnCancellation { call.cancel() }
            call.enqueue(object : Callback {
                override fun onFailure(call: Call, e: IOException) {
                    if (cont.isActive) cont.resumeWithException(ApiError.Transport(e))
                }
                override fun onResponse(call: Call, response: Response) {
                    cont.resume(response)
                }
            })
        }

    /**
     * Perform a request; returns raw body bytes. Throws typed [ApiError].
     * All higher-level helpers funnel through here (mirror of the Swift
     * `request(method:path:body:)`).
     */
    suspend fun raw(
        method: String,
        path: String,
        body: ByteArray? = null,
        contentType: String = "application/json",
        long: Boolean = false,
    ): ByteArray {
        val reqBody: RequestBody? = when {
            body != null -> body.toRequestBody(contentType.toMediaType())
            method == "POST" || method == "PUT" -> ByteArray(0).toRequestBody(null)
            else -> null
        }
        val request = Request.Builder()
            .url(ORIGIN + path)
            .method(method, reqBody)
            .build()
        val client = if (long) httpLong else http
        client.await(request).use { resp ->
            val bytes = resp.body?.bytes() ?: ByteArray(0)
            if (resp.code == 401) {
                onUnauthorized()
                throw ApiError.NotAuthenticated()
            }
            if (!resp.isSuccessful) throw ApiError.BadStatus(resp.code, bytes.decodeToString())
            return bytes
        }
    }

    /** Raw + the response mime type (media streaming needs it). */
    suspend fun rawWithType(method: String, path: String): Pair<ByteArray, String> {
        val request = Request.Builder().url(ORIGIN + path).method(method, null).build()
        http.await(request).use { resp ->
            val bytes = resp.body?.bytes() ?: ByteArray(0)
            if (resp.code == 401) { onUnauthorized(); throw ApiError.NotAuthenticated() }
            if (!resp.isSuccessful) throw ApiError.BadStatus(resp.code, bytes.decodeToString())
            return bytes to (resp.header("Content-Type") ?: "application/octet-stream")
        }
    }

    inline fun <reified T> decode(bytes: ByteArray): T = try {
        json.decodeFromString<T>(bytes.decodeToString())
    } catch (e: Exception) {
        throw ApiError.Decoding(e)
    }

    suspend inline fun <reified T> getJson(path: String): T = decode(raw("GET", path))

    suspend inline fun <reified Req, reified Resp> postJson(path: String, body: Req): Resp =
        decode(raw("POST", path, json.encodeToString(kotlinx.serialization.serializer<Req>(), body).encodeToByteArray()))

    suspend inline fun <reified Resp> postRawJson(path: String, jsonBody: String): Resp =
        decode(raw("POST", path, jsonBody.encodeToByteArray()))

    suspend fun postJpeg(path: String, jpeg: ByteArray, long: Boolean = false): ByteArray =
        raw("POST", path, jpeg, contentType = "image/jpeg", long = long)

    /** Fire-and-forget POST that swallows every failure (event logging etc.). */
    suspend fun postSilently(path: String, jsonBody: String) {
        try { raw("POST", path, jsonBody.encodeToByteArray()) } catch (_: Exception) {}
    }

    // ── Auth (M1) — mirror of APIClient.swift login/me/logout ───────────────

    @Serializable
    data class WireUser(val email: String? = null, val role: String? = null, val slug: String? = null)
    @Serializable
    data class LoginResponse(val ok: Boolean = false, val user: WireUser? = null)
    @Serializable
    data class MeResponse(val user: WireUser? = null)
    @Serializable
    private data class LoginBody(val email: String, val password: String)

    suspend fun login(email: String, password: String): LoginResponse =
        postJson<LoginBody, LoginResponse>("/api/auth/login", LoginBody(email, password))

    suspend fun me(): MeResponse = getJson("/api/auth/me")

    suspend fun logout() {
        try { raw("POST", "/api/auth/logout") } catch (_: Exception) {}
        // Clear local cookies regardless of the server response (iOS parity).
        cookieJar.clear()
    }
}
