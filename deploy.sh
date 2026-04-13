#!/bin/bash
# Deployment script for finance-manager
# Run this after pulling code from GitHub

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Setting up symlinks for live server..."

# Create db directory if it doesn't exist
if [ ! -d "db" ]; then
    mkdir -p db
    echo "Created db/ directory"
fi

# Create backend/db symlink
if [ ! -L "backend/db" ]; then
    ln -sf ../db backend/db
    echo "Created backend/db symlink"
fi

# Create assets directory if it doesn't exist
if [ ! -d "assets" ]; then
    mkdir -p assets
    echo "Created assets/ directory"
fi

# Create backend/assets symlink
if [ ! -L "backend/assets" ]; then
    ln -sf ../assets backend/assets
    echo "Created backend/assets symlink"
fi

# Remove old public symlink if it exists
if [ -L "public" ]; then
    rm public
    echo "Removed old public symlink"
fi

echo ""
echo "Symlinks ready!"
echo ""
echo "To start the backend server:"
echo "  cd backend && NODE_PATH=../node_modules node index.js"
echo ""
echo "To restart Apache (if needed):"
echo "  sudo systemctl reload apache2"
