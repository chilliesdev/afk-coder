#!/bin/bash
set -e

# Build the project
echo "Building project..."
npm install --no-audit --no-fund
npm run build

# Create afk-coder user and groups if they don't exist
if ! getent group afk-coder > /dev/null; then
    sudo groupadd afk-coder
fi
if ! getent group afk-coder-users > /dev/null; then
    sudo groupadd afk-coder-users
fi
if ! getent passwd afk-coder > /dev/null; then
    sudo useradd -r -g afk-coder -G afk-coder-users -s /sbin/nologin afk-coder
else
    sudo usermod -aG afk-coder-users afk-coder
fi

# Add afk-coder to docker group so it can run containers
if getent group docker > /dev/null; then
    sudo usermod -aG docker afk-coder
fi

# Add afk-coder to the invoking user's group to allow workspace access
if [ -n "$SUDO_USER" ]; then
    sudo usermod -aG "$SUDO_USER" afk-coder
    echo "Added afk-coder to the $SUDO_USER group for workspace access."
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
