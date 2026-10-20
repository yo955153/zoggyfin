// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

import CryptoKit
import Foundation

/// The cryptography of the Bluetooth LE rendezvous on iOS and iPadOS, with
/// Apple's CryptoKit only (see `src/together/rendezvous-crypto.ts`).
///
/// - Key agreement: X25519 (`Curve25519.KeyAgreement`).
/// - Key derivation: HKDF-SHA256, 32 bytes.
/// - Sealed messages: ChaCha20-Poly1305 (IETF, 12-byte nonce, `ChaChaPoly`).
///
/// The app uses only encryption from the operating system on iOS. For that
/// reason, `ITSAppUsesNonExemptEncryption` stays false. All values go in
/// and out as lower-case hex. Bad input gives an empty string or nil; no
/// function throws. This file has no Expo code, so a small Swift script
/// can test it (`scripts/rendezvous-vectors/main.swift`).
enum RendezvousCrypto {
  /// The X25519 public key of a 32-byte private key.
  static func publicKey(privHex: String) -> String {
    guard let priv = bytes(hex: privHex), priv.count == 32,
          let key = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: priv)
    else { return "" }
    return hex(key.publicKey.rawRepresentation)
  }

  /// HKDF-SHA256 (32 bytes) of the X25519 shared secret. Empty for a bad
  /// key or a low-order point (a zero shared secret).
  static func sharedKey(privHex: String, peerHex: String, saltHex: String, infoHex: String) -> String {
    guard let priv = bytes(hex: privHex), priv.count == 32,
          let peer = bytes(hex: peerHex), peer.count == 32,
          let salt = bytes(hex: saltHex), let info = bytes(hex: infoHex),
          let mine = try? Curve25519.KeyAgreement.PrivateKey(rawRepresentation: priv),
          let theirs = try? Curve25519.KeyAgreement.PublicKey(rawRepresentation: peer),
          let secret = try? mine.sharedSecretFromKeyAgreement(with: theirs)
    else { return "" }
    let zero = secret.withUnsafeBytes { raw in raw.allSatisfy { $0 == 0 } }
    if zero { return "" }
    let key = secret.hkdfDerivedSymmetricKey(using: SHA256.self, salt: salt, sharedInfo: info, outputByteCount: 32)
    return key.withUnsafeBytes { hex(Data($0)) }
  }

  /// ChaCha20-Poly1305 of `plain`: ciphertext || 16-byte tag. Empty on bad input.
  static func seal(keyHex: String, nonceHex: String, plainHex: String) -> String {
    guard let key = bytes(hex: keyHex), key.count == 32,
          let nonceBytes = bytes(hex: nonceHex), nonceBytes.count == 12,
          let plain = bytes(hex: plainHex),
          let nonce = try? ChaChaPoly.Nonce(data: nonceBytes),
          let box = try? ChaChaPoly.seal(plain, using: SymmetricKey(data: key), nonce: nonce)
    else { return "" }
    return hex(box.ciphertext + box.tag)
  }

  /// The plaintext of ciphertext || tag, or nil when the tag does not match.
  static func open(keyHex: String, nonceHex: String, sealedHex: String) -> String? {
    guard let key = bytes(hex: keyHex), key.count == 32,
          let nonceBytes = bytes(hex: nonceHex), nonceBytes.count == 12,
          let sealed = bytes(hex: sealedHex), sealed.count >= 16,
          let nonce = try? ChaChaPoly.Nonce(data: nonceBytes),
          let box = try? ChaChaPoly.SealedBox(nonce: nonce, ciphertext: sealed.prefix(sealed.count - 16), tag: sealed.suffix(16)),
          let plain = try? ChaChaPoly.open(box, using: SymmetricKey(data: key))
    else { return nil }
    return hex(plain)
  }

  // MARK: Hex

  static func hex(_ data: Data) -> String {
    let digits = Array("0123456789abcdef".utf8)
    var out = [UInt8]()
    out.reserveCapacity(data.count * 2)
    for b in data {
      out.append(digits[Int(b >> 4)])
      out.append(digits[Int(b & 15)])
    }
    return String(decoding: out, as: UTF8.self)
  }

  static func bytes(hex text: String) -> Data? {
    let chars = Array(text.utf8)
    guard chars.count % 2 == 0 else { return nil }
    var out = Data(capacity: chars.count / 2)
    var i = 0
    while i < chars.count {
      guard let hi = nibble(chars[i]), let lo = nibble(chars[i + 1]) else { return nil }
      out.append(hi << 4 | lo)
      i += 2
    }
    return out
  }

  private static func nibble(_ c: UInt8) -> UInt8? {
    switch c {
    case 48...57: return c - 48
    case 97...102: return c - 87
    case 65...70: return c - 55
    default: return nil
    }
  }
}
