// This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

// Checks the CryptoKit rendezvous code (modules/zoggyfin-native/ios/RendezvousCrypto.swift)
// against the test vectors of the JS code (src/together/__tests__/rendezvous-vectors.json).
// Run: bash scripts/rendezvous-vectors/run.sh

import Foundation

struct Message: Decodable { let nonce: String; let plain: String; let sealed: String }
struct Vectors: Decodable {
  let a: String; let aPub: String; let b: String; let bPub: String
  let session: String; let info: String; let key: String
  let messages: [Message]
}

var failures = 0
func check(_ ok: Bool, _ what: String) {
  print((ok ? "ok   " : "FAIL ") + what)
  if !ok { failures += 1 }
}
func hexOf(_ s: String) -> String { RendezvousCrypto.hex(Data(s.utf8)) }

let path = CommandLine.arguments.dropFirst().first ?? "src/together/__tests__/rendezvous-vectors.json"
let v = try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: URL(fileURLWithPath: path)))

check(RendezvousCrypto.publicKey(privHex: v.a) == v.aPub, "X25519 public key A")
check(RendezvousCrypto.publicKey(privHex: v.b) == v.bPub, "X25519 public key B")
let kab = RendezvousCrypto.sharedKey(privHex: v.a, peerHex: v.bPub, saltHex: hexOf(v.session), infoHex: hexOf(v.info))
let kba = RendezvousCrypto.sharedKey(privHex: v.b, peerHex: v.aPub, saltHex: hexOf(v.session), infoHex: hexOf(v.info))
check(kab == v.key && kba == v.key, "HKDF-SHA256 key, both sides")
check(RendezvousCrypto.sharedKey(privHex: v.a, peerHex: String(repeating: "0", count: 64), saltHex: "", infoHex: "") == "", "zero point is refused")

for (i, m) in v.messages.enumerated() {
  check(RendezvousCrypto.seal(keyHex: v.key, nonceHex: m.nonce, plainHex: m.plain) == m.sealed, "seal message \(i)")
  check(RendezvousCrypto.open(keyHex: v.key, nonceHex: m.nonce, sealedHex: m.sealed) == m.plain, "open message \(i)")
  var bad = Array(m.sealed)
  bad[0] = bad[0] == "0" ? "1" : "0"
  check(RendezvousCrypto.open(keyHex: v.key, nonceHex: m.nonce, sealedHex: String(bad)) == nil, "tampered message \(i) is refused")
}

print(failures == 0 ? "All rendezvous vectors match." : "\(failures) failures.")
exit(failures == 0 ? 0 : 1)
