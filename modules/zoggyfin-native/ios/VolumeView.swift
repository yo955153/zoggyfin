// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import ExpoModulesCore
import MediaPlayer
import UIKit

/// The system volume slider (MPVolumeView). It moves the device volume, so
/// it has no value of its own. The simulator shows no slider.
class VolumeView: ExpoView {
  private let volume = MPVolumeView(frame: .zero)

  var tint: UIColor = .white {
    didSet { style() }
  }

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    addSubview(volume)
    style()
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    volume.frame = bounds
    style()
  }

  private func style() {
    for case let slider as UISlider in volume.subviews {
      slider.minimumTrackTintColor = tint
      slider.maximumTrackTintColor = tint.withAlphaComponent(0.25)
      slider.thumbTintColor = tint
    }
  }
}

public class ZoggyfinVolumeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ZoggyfinVolume")

    View(VolumeView.self) {
      Prop("color") { (view: VolumeView, color: UIColor) in
        view.tint = color
      }
    }
  }
}
