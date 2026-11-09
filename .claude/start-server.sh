#!/bin/bash
export PATH="/Users/marinamonto/.nvm/versions/node/v22.22.1/bin:$PATH"
exec npx serve -l "$1" --no-clipboard -c 0
