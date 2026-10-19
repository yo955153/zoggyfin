// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import ExpoModulesCore
import UIKit

/// A view that becomes first responder while it is in a window and sends
/// hardware key presses to JavaScript. Touches pass through to its children.
class KeyInputView: ExpoView {
  let onHardwareKey = EventDispatcher()
  var isEnabled = true {
    didSet { updateResponder() }
  }

  override var canBecomeFirstResponder: Bool { isEnabled }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    updateResponder()
  }

  private func updateResponder() {
    DispatchQueue.main.async { [weak self] in
      guard let self else { return }
      if self.window != nil && self.isEnabled {
        if !self.isFirstResponder { self.becomeFirstResponder() }
      } else if self.isFirstResponder {
        self.resignFirstResponder()
      }
    }
  }

  override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
    var handled = false
    for press in presses {
      guard let key = press.key, isEnabled else { continue }
      let name = Self.keyName(key)
      guard !name.isEmpty else { continue }
      handled = true
      onHardwareKey([
        "key": name,
        "shift": key.modifierFlags.contains(.shift),
        "meta": key.modifierFlags.contains(.command),
        "alt": key.modifierFlags.contains(.alternate),
      ])
    }
    if !handled { super.pressesBegan(presses, with: event) }
  }

  /// Names follow the web `KeyboardEvent.key` values, so one handler serves both.
  private static func keyName(_ key: UIKey) -> String {
    switch key.keyCode {
    case .keyboardSpacebar: return " "
    case .keyboardLeftArrow: return "ArrowLeft"
    case .keyboardRightArrow: return "ArrowRight"
    case .keyboardUpArrow: return "ArrowUp"
    case .keyboardDownArrow: return "ArrowDown"
    case .keyboardEscape: return "Escape"
    case .keyboardReturnOrEnter: return "Enter"
    case .keyboardDeleteOrBackspace: return "Backspace"
    case .keyboardDeleteForward: return "Delete"
    default:
      let chars = key.charactersIgnoringModifiers.lowercased()
      return chars.count == 1 ? chars : ""
    }
  }
}
