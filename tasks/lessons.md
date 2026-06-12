# Lessons Learned

## Format: [date] | ce qui a mal tourné | règle pour l'éviter

- [2026-06-12] | 5 itérations de patchs à l'aveugle sur le décodeur VLC, testées uniquement sur matériel physique (2 téléphones), sans jamais isoler le bug | Pour tout traitement de signal/protocole : écrire D'ABORD un simulateur offline (encode → canal bruité simulé → decode) et le faire passer avant de tester sur matériel. `npm run test:proto`.

- [2026-06-12] | L'émetteur utilisait des `sleep(BIT_MS)` relatifs : chaque bit durait 250ms + temps d'applyConstraints + re-render → dérive cumulative, récepteur désynchronisé dès le 10e bit | Toute boucle temps-réel doit planifier en échéances absolues (`deadline = t0 + i*period`), jamais en délais relatifs.

- [2026-06-12] | Le récepteur comptait en "samples par bit" fixes alors que setInterval/rAF ont un débit variable | Décoder en durées réelles (timestamps `performance.now()`), jamais en nombre d'échantillons. L'autobaud sur préambule alternant absorbe le reste.

- [2026-06-12] | Seuil de binarisation basé sur le bruit de calibration (≈7 lux) : la décroissance d'auto-exposition caméra (~8 lux/frame sur un niveau constant) déclenchait de faux fronts descendants | L'auto-exposition d'une caméra mobile tue tout seuil absolu ET tout seuil basé bruit. Seuil = max(bruit×4, 25% de l'amplitude min-max récente) : un vrai front = ~90% d'amplitude en 1 frame, la dérive expo = ~4%/frame.

- [2026-06-12] | Bytes de framing avec runs longs (START=0xFF = 2s de lumière fixe) laissaient l'auto-exposition s'adapter et effacer le signal | Sur canal optique : bit stuffing (max 3 bits identiques) + bytes de framing équilibrés. Garantir une transition régulière.
