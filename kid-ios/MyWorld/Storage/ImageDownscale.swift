import UIKit

/// Downscale arbitrary image bytes to at most `maxDim` px on the long edge and
/// re-encode as JPEG. Shared by every add-tile entry point (camera capture,
/// single library pick, bulk import) so the server — and the AI cost meter —
/// always sees a consistent, modestly-sized payload instead of a raw 12 MP
/// photo. Mirrors the web `downscale()`/`compressImage()` helpers.
///
/// Returns nil only if the bytes can't be decoded as an image.
func downscaleJPEG(_ data: Data, maxDim: CGFloat = 1024, quality: CGFloat = 0.85) -> Data? {
    guard let image = UIImage(data: data) else { return nil }
    let size = image.size
    let longest = max(size.width, size.height)
    let scale = longest > maxDim ? maxDim / longest : 1
    let target = CGSize(width: (size.width * scale).rounded(),
                        height: (size.height * scale).rounded())
    let format = UIGraphicsImageRendererFormat.default()
    format.opaque = true
    let renderer = UIGraphicsImageRenderer(size: target, format: format)
    let scaled = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
    return scaled.jpegData(compressionQuality: quality)
}
