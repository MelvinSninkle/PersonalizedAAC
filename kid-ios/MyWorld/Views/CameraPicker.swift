import SwiftUI
import UIKit

/// Thin SwiftUI wrapper for `UIImagePickerController` configured for the rear
/// camera. SwiftUI's `PhotosPicker` covers the photo-library path but offers no
/// camera entry point, so the camera side still has to bridge through UIKit.
///
/// Usage — MUST be a fullScreenCover, never a sheet:
///   .fullScreenCover(isPresented: $showCamera) {
///       CameraPicker { jpeg in pickedPhoto = jpeg }.ignoresSafeArea()
///   }
///
/// iPad TRAP: presenting the camera picker in a `.sheet` works on iPhone
/// (sheets are effectively full-screen there) but on iPad a sheet is a
/// centered form-sheet card, and iPadOS refuses to feed camera frames to a
/// non-full-screen camera picker — the capture session bails
/// (FigCaptureSessionRemote err=-12784) and the preview is solid BLACK.
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
        // about permissions). Fall back to the library on the Simulator / a
        // device with no camera so the flow is still testable.
        vc.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        if vc.sourceType == .camera { vc.cameraDevice = .rear }
        vc.allowsEditing = false
        vc.delegate = context.coordinator
        // Belt-and-suspenders for the iPad black-preview trap (see header
        // comment): even though every call site presents via fullScreenCover,
        // pin the picker itself to full-screen too.
        vc.modalPresentationStyle = .fullScreen
        return vc
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    // NOTE: the coordinator does NOT call `picker.dismiss()`. Dismissal is the
    // caller's job via the `.sheet(isPresented:)` binding it flips inside
    // `onCapture`. Self-dismissing here leaves that binding stuck `true`, which
    // silently breaks the *next* "Take a photo" tap — exactly the rapid-fire
    // case this whole flow exists for.
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(_ parent: CameraPicker) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            // Re-encode to JPEG bytes, then run the shared downscale so a camera
            // shot matches the size of a library pick.
            let jpeg = (info[.originalImage] as? UIImage)?.jpegData(compressionQuality: 0.95)
            parent.onCapture(jpeg.flatMap { downscaleJPEG($0) })
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.onCapture(nil)
        }
    }
}
