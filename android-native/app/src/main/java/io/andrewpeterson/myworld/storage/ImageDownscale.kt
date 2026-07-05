package io.andrewpeterson.myworld.storage

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream

/**
 * Resize a captured photo to ≤1024px long edge and re-encode JPEG q85 —
 * port of `Storage/ImageDownscale.swift`. Re-encoding strips EXIF (and we
 * bake the rotation in first so sideways phone photos land upright).
 */
fun downscaleJpeg(bytes: ByteArray, maxDim: Int = 1024, quality: Int = 85): ByteArray {
    return try {
        var bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.size) ?: return bytes

        // Bake EXIF rotation in before the metadata is stripped.
        val orientation = try {
            ExifInterface(bytes.inputStream())
                .getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } catch (_: Exception) { ExifInterface.ORIENTATION_NORMAL }
        val degrees = when (orientation) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
        }
        if (degrees != 0f) {
            val m = Matrix().apply { postRotate(degrees) }
            bmp = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        }

        val longEdge = maxOf(bmp.width, bmp.height)
        if (longEdge > maxDim) {
            val scale = maxDim.toFloat() / longEdge
            bmp = Bitmap.createScaledBitmap(
                bmp, (bmp.width * scale).toInt().coerceAtLeast(1),
                (bmp.height * scale).toInt().coerceAtLeast(1), true)
        }
        val out = ByteArrayOutputStream()
        bmp.compress(Bitmap.CompressFormat.JPEG, quality, out)
        out.toByteArray()
    } catch (_: Exception) { bytes }
}
