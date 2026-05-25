# S6 NoiseCloud Next lab service

This directory contains the S6 v2 web/API wrapper used by the DLP test site.

It intentionally runs beside the original NoiseCloud lab rather than replacing it.

## Features

- S6NC1 envelope around every payload.
- SHA-256 verification of plaintext and envelope payload.
- Optional passphrase encryption with AES-256-GCM and PBKDF2-SHA256.
- NoiseCloud MP4 generation using the forked CLI.
- `noise` cover mode: original visual carrier.
- `slideshow-sideband` cover mode: generated slideshow/test-pattern video with the carrier preserved as a right-side video sideband.

The payload is still carried by video frames, not audio.

## API

- `GET /api/noisecloud-v2/healthz`
- `POST /api/noisecloud-v2/encode`
  - multipart field `file`
  - optional text field `passphrase`
  - optional text field `coverMode`: `noise` or `slideshow-sideband`
- `POST /api/noisecloud-v2/decode`
  - multipart field `file`
  - optional text field `passphrase`
  - optional text field `coverMode`: `auto`, `noise`, or `slideshow-sideband`

## Limits

Defaults in Dockerfile:

- upload plaintext: 2 MiB
- generated/downloaded MP4: 50 MiB
- decode video upload: 50 MiB

Encrypted payloads are high entropy and produce larger carriers than compressible canaries.
