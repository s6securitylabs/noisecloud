# S6 NoiseCloud Next

S6 NoiseCloud Next is an S6 Security Labs fork of Lucas Ferraz's NoiseCloud project.

Upstream remains the canonical original project:

- Upstream: <https://github.com/unlucas-br/noisecloud>
- S6 fork: <https://github.com/s6securitylabs/noisecloud>

This fork exists to support defensive DLP testing and controlled research. It is not intended to obscure data theft or provide an unattended exfiltration utility. The design goal is to make media-carrier DLP tests realistic enough to be useful while keeping operator intent, provenance, and validation explicit.

## Relationship to upstream

NoiseCloud 2.0 already provides the core transport idea:

- compress an input file;
- split it into WEV1 frames;
- render data into high-contrast video macropixels;
- package the result as MP4 with FFmpeg;
- decode by extracting frames and reconstructing the payload.

S6 NoiseCloud Next keeps that lineage visible and preserves the original upstream remote. Changes in this fork should be documented as S6 additions, not quietly represented as upstream behavior.

## Next-generation additions

Planned S6 additions are grouped into four layers.

### 1. S6 payload envelope

Before handing bytes to the visual carrier, S6 Next should wrap the payload in an explicit envelope:

```text
S6NC1 envelope
- magic/version
- envelope flags
- original filename
- original MIME type
- original byte length
- original SHA-256
- created timestamp
- optional operator/test case metadata
- encryption parameters, if enabled
- payload bytes
```

Purpose:

- distinguish S6 lab artifacts from raw upstream NoiseCloud payloads;
- verify recovered bytes match the original input;
- preserve filename/type safely;
- support deterministic DLP test evidence;
- make future format changes versioned instead of archaeological.

### 2. Optional passphrase encryption

NoiseCloud is not encryption. The upstream README says to encrypt first if secrecy is required. S6 Next should make that workflow explicit and safer.

Target design:

- optional passphrase field;
- client-side or CLI-side encryption before visual encoding;
- AES-256-GCM for authenticated encryption;
- Argon2id preferred for KDF, PBKDF2 acceptable where browser compatibility is the priority;
- random salt and nonce per payload;
- KDF parameters stored in the envelope;
- authentication failure must stop decode and clearly report wrong passphrase or tamper.

Operational note: encrypted payloads are high entropy and will not compress well. A 2 MiB encrypted payload is effectively random 2 MiB data, so carriers will be much larger and slower than compressible canaries.

### 3. Integrity verification

Existing upstream integrity/resilience mechanisms include:

- WEV1 magic/version checks;
- per-frame CRC32;
- block rescue frames;
- gzip decompression failure on corrupt payloads;
- optional compact trailer CRC32 in the upstream code path.

Those are useful for corruption detection, not cryptographic integrity.

S6 Next should add:

- SHA-256 over the original plaintext payload;
- SHA-256 over the encoded envelope;
- AES-GCM authentication tag when encryption is enabled;
- decode report containing original hash, recovered hash, recovered length, and verification status.

### 4. Visual cover modes

The current default carrier looks like high-contrast visual noise. That is good for proving the concept, but it is easy for humans and platforms to identify as synthetic.

S6 Next should support configurable visual cover modes:

1. `noise`: upstream-like high-contrast data macropixels.
2. `slideshow-visible`: a real image or slideshow is visible, with data encoded into reserved regions such as borders, calibration panels, or QR-like sidebands.
3. `slideshow-overlay`: data macropixels are blended into selected regions over a cover image. This is more fragile after transcoding.
4. `dual-track-test`: visible slideshow frames plus explicit data panels, intended for DLP validation rather than stealth.

Important: this remains a video carrier. The payload is encoded in video frames, not audio. Audio may be added later as a decoy or separate research track, but the current transport is visual.

## YouTube and platform detection considerations

A platform or DLP product does not need to decode NoiseCloud to flag it. Likely indicators include:

- synthetic high-contrast macroblock patterns;
- frames dominated by black/white binary grids;
- repeated calibration bars or fixed sidebands;
- unusual 640x360 or 1080x1920 30 fps generated content;
- FFmpeg/libx264 metadata or encoding profile;
- silent video with no semantic visual content;
- upload by a user/host with no normal media publishing pattern;
- endpoint sequence of compression/encryption followed by video generation and browser upload.

Cover modes should therefore be treated as DLP test variations, not as a promise of invisibility. If a test objective is platform survivability, every generated artifact must be validated by upload/download/decode round trip under authorised conditions.

## MP4 container integrity

MP4 structure can prove a file is a syntactically valid MP4. It does not prove that the hidden payload is intact or authentic.

S6 Next should not rely on MP4 container validity for payload verification. Payload integrity belongs in the S6 envelope and, when encrypted, the AEAD authentication tag.

## Initial implementation milestones

1. Preserve upstream remote and document fork relationship.
2. Add S6 envelope encode/decode package with tests.
3. Add optional encryption support with passphrase tests.
4. Add decode verification report.
5. Add cover-mode abstraction while preserving upstream noise mode.
6. Add slideshow-visible prototype with data in border/sideband regions.
7. Update the S6 DLP web lab to use the forked container image.

## Safety guardrails

- Keep size limits configurable and conservative by default.
- Avoid automatic upload to YouTube, TikTok, or other third-party services.
- Keep visible lab warnings and source attribution.
- Make encryption optional but clearly recommended for realistic tests.
- Do not remove upstream attribution or GPL-3.0 license terms.
