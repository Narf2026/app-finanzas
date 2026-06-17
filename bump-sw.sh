#!/bin/bash
# Actualiza la versión del service worker con el timestamp actual
TS=$(date +%Y%m%d%H%M%S)
sed -i "s/const VERSION = 'v[0-9]*/const VERSION = 'v${TS}/" sw.js
echo "✓ sw.js actualizado a versión v${TS}"
