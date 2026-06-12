# VLC PWA "flash" - Todo

## Status: ✅ FONCTIONNEL — validé sur matériel le 2026-06-12

## Fait
- [x] Scaffold Vite + React + TS + Tailwind + PWA + Docker
- [x] Protocole v1 → v2 : auto-synchronisé (autobaud sur préambule), bit stuffing, checksum
- [x] Simulateur offline `npm run test:proto` (64 cas : 4 messages × 10 seeds + stress)
- [x] Émetteur : échéances absolues, overlay plein écran noir/blanc
- [x] Récepteur : rAF + timestamps réels, seuil adaptatif amplitude, crop centre 60%

## Validé (matériel)
- [x] Test réel 2 téléphones : transmission écran→caméra confirmée le 2026-06-12

## Réglages clés (src/lib/vlc-protocol.ts)
- BIT_DURATION_MS = 250 (4 bits/s, "VLC" ≈ 15s)
- RANGE_FRACTION = 0.25 (seuil = 25% de l'amplitude)
- Déploiement : `docker compose up --build -d` sur le serveur
