import SwiftUI

struct NavigationMenuView: View {
    @EnvironmentObject private var model: AppModel
    let selection: BisikScreen
    let onSelect: (BisikScreen) -> Void
    let onNewDraft: () -> Void
    let onSubscription: () -> Void
    let onClose: () -> Void
    @State private var discardPendingAlert = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Menu").font(BisikTheme.font(24, semibold: true, relativeTo: .title))
                    Spacer()
                    IconControl(symbol: "xmark", label: "Tutup menu", action: onClose)
                        .accessibilityIdentifier("menu.close")
                }
                .padding(.bottom, 8)

                destination(.recorder)
                Button {
                    if model.hasPendingRecording { discardPendingAlert = true } else { onNewDraft() }
                } label: {
                    row("Tulisan baru", symbol: "plus", selected: false)
                }
                .buttonStyle(.plain)
                .disabled(model.phase != .idle)
                .opacity(model.phase == .idle ? 1 : 0.5)
                .accessibilityIdentifier("menu.newDraft")

                separator
                destination(.history)
                destination(.dictionary)
                separator
                destination(.quota)
                Button(action: onSubscription) {
                    row("Langganan", symbol: "sparkles", selected: false)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("menu.subscription")
                separator
                destination(.settings)
            }
            .padding(24)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .foregroundStyle(BisikTheme.ink)
        .background(Color.white)
        .alert("Hapus rekaman yang belum selesai?", isPresented: $discardPendingAlert) {
            Button("Batal", role: .cancel) { }
            Button("Hapus & buat baru", role: .destructive) { onNewDraft() }
        } message: {
            Text("Rekaman yang belum berhasil diproses akan dihapus saat membuat tulisan baru.")
        }
    }

    private func destination(_ screen: BisikScreen) -> some View {
        Button { onSelect(screen) } label: {
            row(screen.title, symbol: screen.symbol, selected: selection == screen)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("menu.\(screen.rawValue)")
        .accessibilityAddTraits(selection == screen ? .isSelected : [])
    }

    private func row(_ title: String, symbol: String, selected: Bool) -> some View {
        HStack(spacing: 16) {
            Image(systemName: symbol)
                .font(.system(size: 18, weight: .regular))
                .frame(width: 24)
                .foregroundStyle(BisikTheme.secondary)
                .accessibilityHidden(true)
            Text(title).font(BisikTheme.font(15, semibold: selected))
            Spacer()
            if selected {
                Image(systemName: "checkmark")
                    .font(.system(size: 14))
                    .foregroundStyle(BisikTheme.accent)
                    .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 16)
        .frame(minHeight: 56)
        .background(selected ? BisikTheme.panel : Color.clear, in: RoundedRectangle(cornerRadius: 18))
        .contentShape(Rectangle())
    }

    private var separator: some View {
        Rectangle().fill(BisikTheme.line).frame(height: 1).padding(.horizontal, 16)
    }
}
