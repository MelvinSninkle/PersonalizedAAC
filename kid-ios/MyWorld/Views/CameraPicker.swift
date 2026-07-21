import SwiftUI
import UIKit
import AVFoundation

/// Camera entry point with a PERMISSION PREFLIGHT — present THIS (not
/// CameraPicker directly) from the four camera fullScreenCovers.
///
/// Why: with camera access denied — or, very common on a child's iPad,
/// blocked by Screen Time's Content & Privacy Restrictions — iOS shows the
/// picker with working controls and a silently BLACK preview. No error,
/// nothing to act on. This wrapper checks authorization first and swaps the
/// black box for an explainer that names the fix.
struct CameraCapture: View {
    var onCapture: (Data?) -> Void

    private enum Phase: Equatable { case checking, allowed, blocked(restricted: Bool) }
    @State private var phase: Phase = .checking

    var body: some View {
        Group {
            switch phase {
            case .checking:
                ZStack {
                    Color.black.ignoresSafeArea()
                    ProgressView("Getting the camera ready…")
                        .tint(.white).foregroundStyle(.white)
                }
            case .allowed:
                CameraPicker(onCapture: onCapture)
            case .blocked(let restricted):
                blockedView(restricted: restricted)
            }
        }
        .task {
            // No camera hardware (Simulator) → CameraPicker's own photo-library
            // fallback needs no camera permission.
            guard UIImagePickerController.isSourceTypeAvailable(.camera) else { phase = .allowed; return }
            switch AVCaptureDevice.authorizationStatus(for: .video) {
            case .authorized:
                phase = .allowed
            case .notDetermined:
                // Ask BEFORE any camera UI, so the first-ever open never
                // renders a black preview either.
                let ok = await AVCaptureDevice.requestAccess(for: .video)
                phase = ok ? .allowed : .blocked(restricted: false)
            case .restricted:
                // Screen Time / parental controls: the app's own Settings page
                // won't even SHOW a Camera toggle — written steps are the fix.
                phase = .blocked(restricted: true)
            default:   // .denied — Open Settings lands exactly on the toggle
                phase = .blocked(restricted: false)
            }
        }
    }

    /// Lead with the fix that matches HOW the camera is blocked: a plain
    /// denial is one toggle away (the button deep-links to it — the only
    /// Settings link Apple allows); a Screen Time restriction can only be
    /// fixed by the written steps, since Apple offers no deep link there.
    private func blockedView(restricted: Bool) -> some View {
        ZStack {
            Color(hex: "#fff7fb").ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                Text("📷").font(.system(size: 44))
                Text(restricted ? "The camera is blocked by Screen Time" : "Camera access is off for My World")
                    .font(.system(size: 22, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color(hex: "#ad1457"))
                VStack(alignment: .leading, spacing: 10) {
                    if restricted {
                        Text("On this iPad, parental controls are blocking the camera for apps. To allow it:")
                        Text("Settings → Screen Time → Content & Privacy Restrictions → Allowed Apps & Features → turn on Camera")
                            .fontWeight(.semibold)
                        Text("(You may need the Screen Time passcode.)")
                    } else {
                        Text("Tap Open Settings below and turn on **Camera**. It's one switch.")
                        Text("Don't see the toggle? Screen Time may be blocking it: Settings → Screen Time → Content & Privacy Restrictions → Allowed Apps & Features → Camera.")
                    }
                    Text("Camera on but the picture is black? Check that the iPad's case isn't covering the camera lens.")
                        .foregroundStyle(Color(hex: "#6b7280"))
                }
                .font(.system(size: 15))
                .foregroundStyle(Color(hex: "#374151"))
                HStack(spacing: 12) {
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            UIApplication.shared.open(url)
                        }
                    } label: {
                        Text(restricted ? "Open Settings anyway" : "Open Settings")
                            .font(.system(size: 16, weight: .bold))
                            .padding(.horizontal, 22).padding(.vertical, 12)
                            .background(Color(hex: restricted ? "#9ca3af" : "#ff1493"), in: Capsule())
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                    Button("Cancel") { onCapture(nil) }   // dismisses via the caller's binding
                        .font(.system(size: 15, weight: .semibold))
                }
                .padding(.top, 6)
            }
            .padding(28)
            .frame(maxWidth: 520)
        }
    }
}

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
