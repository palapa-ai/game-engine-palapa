import Foundation

/// Apple's Metal Performance HUD, on by default for anything embedding the
/// engine — frame interval, GPU time and memory come from the OS rather than
/// from a readout we draw ourselves.
///
/// Both switches are set because Metal reads them at different moments: the
/// environment variable applies to this launch if Metal has not started yet,
/// and the registration-domain default applies from the next one. Neither
/// overwrites an explicit choice, so a host app can still turn it off.
enum MetalHUD {
  static func enableByDefault() {
    setenv("MTL_HUD_ENABLED", "1", 0)
    UserDefaults.standard.register(defaults: ["MetalForceHudEnabled": true])
  }
}
