#!/bin/bash
set -e

# Build the project
echo "Building project..."
npm install --no-audit --no-fund
npm run build

# Determine target user and group (invoking user under sudo, or current user)
if [ -n "$SUDO_USER" ]; then
    TARGET_USER="$SUDO_USER"
else
    TARGET_USER="$USER"
fi
TARGET_GROUP=$(id -gn "$TARGET_USER")

echo "Installing afk-coder service to run as user: $TARGET_USER, group: $TARGET_GROUP"

# Verify docker group membership for the target user
if getent group docker > /dev/null; then
    if ! id -nG "$TARGET_USER" | grep -qw docker; then
        sudo usermod -aG docker "$TARGET_USER"
        echo "Added $TARGET_USER to the docker group so it can run sandboxed containers."
        echo "Note: You may need to restart your session for group changes to take effect."
    fi
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

# Install systemd service with user templating
sed -e "s/@USER@/$TARGET_USER/g" -e "s/@GROUP@/$TARGET_GROUP/g" afk-coder.service | sudo tee /etc/systemd/system/afk-coder.service > /dev/null
sudo systemctl daemon-reload
sudo systemctl enable afk-coder.service

echo "Installation complete."
echo "You can start the daemon with: sudo systemctl start afk-coder"
