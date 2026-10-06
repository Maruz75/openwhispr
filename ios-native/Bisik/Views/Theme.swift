import SwiftUI

// The OpenAI-inspired system is adapted to native touch targets and Dynamic Type.
enum BisikTheme {
    static let ink = Color(red: 33 / 255, green: 33 / 255, blue: 33 / 255)
    static let secondary = Color(red: 105 / 255, green: 105 / 255, blue: 105 / 255)
    static let panel = Color(white: 0.975)
    static let line = Color(white: 0.85)
    static let accent = ink
    static let focus = ink
    static let danger = Color(red: 163 / 255, green: 38 / 255, blue: 38 / 255)

    static func font(_ size: CGFloat = 14, semibold: Bool = false, relativeTo style: Font.TextStyle = .body) -> Font {
        .custom(semibold ? "Inter-SemiBold" : "Inter-Regular", size: size, relativeTo: style)
    }

    static func duration(_ seconds: Double) -> String {
        let value = max(0, Int(seconds))
        return String(format: "%02d:%02d", value / 60, value % 60)
    }

    static func minutes(_ seconds: Int) -> String {
        let value = max(0, seconds)
        if value < 60 { return value == 1 ? L10n.text("1 detik") : L10n.format("%@ detik", value) }
        let minutes = Int(ceil(Double(value) / 60))
        return minutes == 1 ? L10n.text("1 menit") : L10n.format("%@ menit", minutes)
    }
}

struct BisikButtonStyle: ButtonStyle {
    var primary = true
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(BisikTheme.font(14, semibold: true))
            .foregroundStyle(primary ? Color.white : BisikTheme.ink)
            .frame(maxWidth: .infinity, minHeight: 52)
            .background(primary ? BisikTheme.ink : BisikTheme.panel, in: RoundedRectangle(cornerRadius: 18))
            .overlay(RoundedRectangle(cornerRadius: 18).stroke(primary ? Color.clear : BisikTheme.line, lineWidth: 1))
            .opacity(configuration.isPressed ? 0.82 : 1)
            .scaleEffect(configuration.isPressed && !reduceMotion ? 0.98 : 1)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

struct IconControl: View {
    let symbol: String
    let label: String
    var highlighted = false
    var prominent = false
    var disabled = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: prominent ? 22 : 18, weight: prominent ? .semibold : .regular))
                .frame(width: prominent ? 48 : 44, height: prominent ? 48 : 44)
                .foregroundStyle(prominent ? Color.white : highlighted ? BisikTheme.accent : BisikTheme.secondary)
                .background {
                    if prominent { Circle().fill(highlighted ? BisikTheme.accent : BisikTheme.ink) }
                    else { RoundedRectangle(cornerRadius: 16).fill(highlighted ? BisikTheme.panel : Color.clear) }
                }
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(label)
    }
}

struct EmptyState: View {
    let symbol: String
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: symbol)
                .font(.system(size: 28, weight: .light))
                .foregroundStyle(BisikTheme.secondary)
                .frame(width: 72, height: 72)
                .background(BisikTheme.panel, in: RoundedRectangle(cornerRadius: 22))
                .accessibilityHidden(true)
            Text(title).font(BisikTheme.font(20, semibold: true, relativeTo: .title2))
            Text(message)
                .font(BisikTheme.font())
                .foregroundStyle(BisikTheme.secondary)
                .multilineTextAlignment(.center)
                .lineSpacing(4)
                .frame(maxWidth: 280)
        }
        .foregroundStyle(BisikTheme.ink)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

struct PageTitle: View {
    let title: String
    let subtitle: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(BisikTheme.font(24, semibold: true, relativeTo: .title))
            Text(subtitle).font(BisikTheme.font()).foregroundStyle(BisikTheme.secondary)
        }
        .foregroundStyle(BisikTheme.ink)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct LegalLinks: View {
    var body: some View {
        HStack(spacing: 20) {
            if let url = AppConfiguration.privacyURL {
                Link(L10n.text("Privasi"), destination: url)
            }
            if let url = AppConfiguration.termsURL {
                Link(L10n.text("Ketentuan"), destination: url)
            }
        }
        .font(BisikTheme.font(12, relativeTo: .caption))
        .foregroundStyle(BisikTheme.secondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
    }
}
