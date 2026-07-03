import SwiftUI

/// Shared brand palette — kept in lockstep with therapist.html / parent.html
/// CSS custom properties so the iPad + iPhone read the same as the web.
enum Brand {
    // Pink primaries
    static let pink     = "#ff1493"   // --pink
    static let pinkDeep = "#ad1457"   // --pink-deep
    static let pinkMid  = "#c2185b"   // --pink-mid
    // Neutrals
    static let ink   = "#1f2937"      // --ink
    static let muted = "#6b7280"      // --muted
    static let faint = "#9ca3af"      // --faint
    // Surfaces
    static let line = "#fce4ec"       // --line
    static let bg   = "#fdf2f8"       // --bg
    static let card = "#ffffff"       // --card
    // Status
    static let good    = "#16a34a"    // --good
    static let goodBg  = "#ecfdf5"    // --good-bg
    static let goodInk = "#047857"
    static let goodLine = "#bbf7d0"
    // Marks (web therapist console — kept identical so a facilitator who
    // toggles between web and phone never has to relearn the color cues)
    static let tapInk    = "#1d4ed8"
    static let verbalInk = "#047857"
    static let objectInk = "#6d28d9"
    // Controls
    static let skipBg  = "#fff0f6"
    static let nextBg  = "#eef2ff"
    static let nextInk = "#4338ca"
}


/// "people.community.workers" → "People › Community › Workers" — skill slugs
/// are taxonomy artifacts; parents get readable breadcrumbs. Known overflow
/// segments get real names (expr → Expressive).
func prettySkillName(_ slug: String) -> String {
    let special: [String: String] = ["expr": "Expressive", "more": "More", "extra": "Extra"]
    let parts = slug.split(separator: ".").map { seg -> String in
        let s = String(seg)
        if let mapped = special[s] { return mapped }
        return s.prefix(1).uppercased() + s.dropFirst()
    }
    return parts.joined(separator: " › ")
}
