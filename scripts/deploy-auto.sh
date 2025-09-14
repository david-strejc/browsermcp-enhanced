#!/bin/bash

# Auto-deploy script that automatically bumps patch version
# Usage: ./scripts/deploy-auto.sh [patch|minor|major]

BUMP_TYPE="${1:-patch}"

case "$BUMP_TYPE" in
    patch)
        echo "1" | ./scripts/deploy
        ;;
    minor)
        echo "2" | ./scripts/deploy
        ;;
    major)
        echo "3" | ./scripts/deploy
        ;;
    keep)
        echo "4" | ./scripts/deploy
        ;;
    *)
        echo "Usage: $0 [patch|minor|major|keep]"
        echo "  patch - Bug fixes (default)"
        echo "  minor - New features"
        echo "  major - Breaking changes"
        echo "  keep  - Keep current version"
        exit 1
        ;;
esac