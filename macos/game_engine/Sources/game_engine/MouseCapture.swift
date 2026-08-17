import AppKit
import FlutterMacOS

/// Locked-mouse look: the pointer is hidden and unpinned from the display, and
/// raw `deltaX/deltaY` from an event monitor drive the camera. Flutter's own
/// pointer stream reports absolute positions, which stop moving once the cursor
/// is disassociated, so the deltas have to come from AppKit.
final class MouseCapture: NSObject, FlutterStreamHandler {
  private var sink: FlutterEventSink?
  private var monitor: Any?

  var isCaptured: Bool { monitor != nil }

  func setCaptured(_ captured: Bool) {
    guard captured != isCaptured else { return }
    captured ? start() : stop()
  }

  private func start() {
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
