import AppKit
import FlutterMacOS

/// Locked-mouse look: the pointer is hidden and unpinned from the display, and
/// raw `deltaX/deltaY` from an event monitor drive the camera. Flutter's own
/// pointer stream reports absolute positions, which stop moving once the cursor
/// is disassociated, so the deltas have to come from AppKit.
final class MouseCapture: NSObject, FlutterStreamHandler {
  private var sink: FlutterEventSink?
  private var monitor: Any?
  private var observers: [NSObjectProtocol] = []

  var isCaptured: Bool { monitor != nil }

  func setCaptured(_ captured: Bool) {
    guard captured != isCaptured else { return }
    captured ? start() : stop()
  }

  /// The cursor cannot wander off while it is pinned, so the way out of a
  /// capture is escape or losing focus — the same contract every windowed
  /// game keeps.
  private func observeFocusLoss() {
    guard observers.isEmpty else { return }
    let center = NotificationCenter.default
    for name in [
      NSApplication.didResignActiveNotification,
      NSWindow.didResignKeyNotification,
      NSWindow.didMiniaturizeNotification,
    ] {
      observers.append(
        center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
          self?.setCaptured(false)
        })
    }
  }

  private func start() {
    observeFocusLoss()
    // Without this the app never receives .mouseMoved at all, so the monitor
    // below stays silent and only drags would move the camera.
    NSApp.windows.forEach { $0.acceptsMouseMovedEvents = true }
    NSCursor.hide()
    CGAssociateMouseAndMouseCursorPosition(0)
    monitor = NSEvent.addLocalMonitorForEvents(
      matching: [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
    ) { [weak self] event in
      self?.sink?([event.deltaX, event.deltaY])
      return event
    }
  }

  private func stop() {
    if let monitor { NSEvent.removeMonitor(monitor) }
    monitor = nil
    CGAssociateMouseAndMouseCursorPosition(1)
    NSCursor.unhide()
    NSApp.windows.forEach { $0.acceptsMouseMovedEvents = false }
  }

  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink)
    -> FlutterError?
  {
    sink = events
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    sink = nil
    stop()
    return nil
  }
}
