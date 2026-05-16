#!/bin/bash
set -e

# Build the project
echo "Building project..."
npm install --no-audit --no-fund
npm run build

# Check for gemini CLI
if ! command -v gemini &> /dev/null; then
    echo "Warning: 'gemini' CLI not found. It is required for 'afk-coder init'."
    echo "Ensure it is installed and in your PATH (e.g., npm install -g @google/gemini-cli)."
fi

# Create afk-coder user and group if they don't exist
if ! getent group afk-coder > /dev/null; then
    sudo groupadd afk-coder
fi
if ! getent passwd afk-coder > /dev/null; then
    sudo useradd -r -g afk-coder -s /sbin/nologin afk-coder
fi

# Add afk-coder to docker group so it can run containers
if getent group docker > /dev/null; then
    sudo usermod -aG docker afk-coder
fi

# Create directories
sudo mkdir -p /usr/local/lib/afk-coder
sudo cp -r dist /usr/local/lib/afk-coder/
sudo cp -r node_modules /usr/local/lib/afk-coder/
sudo cp package.json /usr/local/lib/afk-coder/

# Install binaries
sudo cp bin/afk-coder /usr/local/bin/afk-coder
sudo cp bin/afk-coder-daemon /usr/local/bin/afk-coder-daemon
sudo chmod +x /usr/local/bin/afk-coder
sudo chmod +x /usr/local/bin/afk-coder-daemon

# Install systemd service
sudo cp afk-coder.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable afk-coder.service

echo "Installation complete."
echo "You can start the daemon with: sudo systemctl start afk-coder"
