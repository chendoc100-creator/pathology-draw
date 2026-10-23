#!/bin/bash
# app on 5055, mock NTU viewer on 5056, mock NTU slide list on 5057
python3 -m http.server 5055 --directory dist >/dev/null 2>&1 &
python3 -m http.server 5056 --directory test/mock >/dev/null 2>&1 &
python3 -m http.server 5057 --directory test/mock >/dev/null 2>&1 &
sleep 1
node test/ui.mjs
