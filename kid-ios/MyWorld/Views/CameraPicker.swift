import SwiftUI
import UIKit

/// Thin SwiftUI wrapper for `UIImagePickerController` configured for the rear
/// camera. SwiftUI's `PhotosPicker` covers the photo-library path but offers no
/// camera entry point, so the camera side still has to bridge through UIKit.
///
/// Usage:
///   .sheet(isPresented: $showCamera) {
///       CameraPicker { jpeg in pickedPhoto = jpeg }
///   }
///
/// The callback hands back JPEG bytes (already compressed to a reasonable
/// dimension for an AAC tile) so the caller doesn't have to think about
/// UIImage at all.
struct CameraPicker: UIViewControllerRepresentable {
    /// Called with JPEG bytes when the user accepts the shot, or nil when they
    /// cancel out. Either way the sheet auto-dismisses.
    var onCapture: (Data?) -> Void

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let vc = UIImagePickerController()
        // .camera is the only mode we want here — the library path is handled
        // separately by PhotosPicker (which is native SwiftUI and pickier
        // about permissions).
        vc.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        vc.cameraDevice = .rear
        vc.allowsEditing = false
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            let image = (info[.originalImage] as? UIImage)
            picker.dismiss(animated: true) {
                self.parent.onCapture(image.flatMap { Self.downscaledJPEG($0) })
            }
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            picker.dismiss(animated: true) { self.parent.onCapture(nil) }
        }

        /// Downscale to at most 1024px on the long edge and re-encode as JPEG
        /// quality 0.85. Matches the web `downscale()` helper so the server
        /// (and the AI cost meter) sees the same payload size from either
        /// surface.
        private static func downscaledJPEG(_ image: UIImage, maxDim: CGFloat = 1024, quality: CGFloat = 0.85) -> Data? {
            let size = image.size
            let longest = max(size.width, size.height)
            let scale = longest > maxDim ? maxDim / longest : 1
            let target = CGSize(width: round(size.width * scale), height: round(size.height * scale))
            let renderer = UIGraphicsImageRenderer(size: target, format: UIGraphicsImageRendererFormat.default())
            let scaled = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: target)) }
            return scaled.jpegData(compressionQuality: quality)
        }
    }
}
